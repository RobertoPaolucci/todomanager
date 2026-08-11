"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

type StagingRow = {
  id: number;
  booking_date: string;
  booking_time: string | null;
  booking_reference: string;
  customer_name: string | null;
  adults: number;
  children: number;
  infants: number | null;
  experience_id: number;
  channel_id: number;
  booking_source: string | null;
  notes: string | null;
  gcal_uid: string;
  original_title: string | null;
  import_status: string;
};

type ExperienceRow = {
  id: number;
  name: string;
  supplier_id: number | null;
  supplier_unit_cost: number | string | null;
  is_group_pricing: boolean | null;
};

type ChannelRow = {
  id: number;
  name: string;
};

type PriceRow = {
  your_unit_price: number | string | null;
  public_unit_price: number | string | null;
};

const FMDQ_BUSINESS_UNIT_ID = 1;

function getSelectedIds(formData: FormData) {
  return formData
    .getAll("row_ids")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function getReturnDate(formData: FormData) {
  return String(formData.get("return_date") ?? "").trim();
}

function getExcludeHorseback(formData: FormData) {
  const value = String(formData.get("exclude_horseback") ?? "")
    .trim()
    .toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function shouldForceImport(formData: FormData) {
  return String(formData.get("force_import") ?? "").trim() === "true";
}

function redirectBack(date: string, excludeHorseback: boolean) {
  revalidatePath("/import/google-calendar");
  revalidatePath("/prenotazioni");
  revalidatePath("/");

  const params = new URLSearchParams();

  if (date) {
    params.set("date", date);
  }

  if (excludeHorseback) {
    params.set("excludeHorseback", "1");
  }

  const query = params.toString();
  redirect(`/import/google-calendar${query ? `?${query}` : ""}`);
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanNote(row: StagingRow) {
  return String(row.notes || row.original_title || "").trim();
}

function rowSourceText(row: StagingRow) {
  return [row.booking_source, row.notes, row.original_title]
    .filter(Boolean)
    .join(" ");
}

function isItalyOnABudgetRow(row: StagingRow) {
  const text = rowSourceText(row);
  return /italy\s+on\s+a\s+budget/i.test(text) || /italy\s+budget\s+tour/i.test(text);
}

function getTuscanEscapeTotal(row: StagingRow) {
  const text = String(row.notes || row.original_title || "").trim();
  const match = text.match(/^\s*(\d+)\s+pranzo\s+tuscan\s+escape\b/i);

  if (!match) return null;

  const total = Number(match[1] || 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function isTuscanEscapeGuideRow(row: StagingRow) {
  return getTuscanEscapeTotal(row) !== null;
}

function normalizeCustomerForMatch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_CUSTOMER_NAMES = new Set([
  "ITALY",
  "TUSCAN",
  "DA VERIFICARE",
  "SENZA NOME",
]);

function customerMatchKey(value: string | null | undefined) {
  const key = normalizeCustomerForMatch(value);
  if (!key || GENERIC_CUSTOMER_NAMES.has(key)) return "";
  return key;
}

function getResolvedCustomerName(row: StagingRow) {
  if (isItalyOnABudgetRow(row)) return "Italy";
  if (isTuscanEscapeGuideRow(row)) return "Tuscan";
  return String(row.customer_name ?? "").trim() || "Da verificare";
}

function getImportPeople(row: StagingRow) {
  let adults = Number(row.adults ?? 0);
  let children = Number(row.children ?? 0);
  let infants = Number(row.infants ?? 0);
  let nonPayingAdults = 0;

  if (isItalyOnABudgetRow(row)) {
    const text = String(row.notes || row.original_title || "");
    const guideMatch = text.match(
      /\+\s*(?:(\d+)\s*)?(?:guida|guide|driver|autista)\b/i
    );

    if (guideMatch) {
      nonPayingAdults = Math.max(1, Number(guideMatch[1] || 1));
    }
  }

  const tuscanEscapeTotal = getTuscanEscapeTotal(row);

  if (tuscanEscapeTotal !== null) {
    adults = Math.max(tuscanEscapeTotal - 1, 0);
    children = 0;
    infants = 0;
    nonPayingAdults = 1;
  }

  return {
    adults,
    children,
    infants,
    nonPayingAdults,
  };
}

async function markRow(
  rowId: number,
  importStatus: string,
  importedBookingId?: number | null
) {
  await supabaseServer
    .from("google_calendar_import_staging")
    .update({
      import_status: importStatus,
      imported_booking_id: importedBookingId ?? null,
    })
    .eq("id", rowId);
}

async function findExistingByReference(bookingReference: string) {
  const { data } = await supabaseServer
    .from("bookings")
    .select("id")
    .eq("booking_reference", bookingReference)
    .limit(1);

  return data?.[0] ?? null;
}

async function findPossibleDuplicate(row: StagingRow) {
  const rowTime = normalizeTime(row.booking_time);
  const people = getImportPeople(row);
  const rowCustomerKey = customerMatchKey(getResolvedCustomerName(row));

  // Senza un nome cliente affidabile non dichiariamo un doppione
  // solo perché data, ora, esperienza, canale e persone coincidono.
  if (!rowCustomerKey) return null;

  const { data } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_time, experience_id, channel_id, adults, children, infants, customer_name, is_cancelled"
    )
    .eq("booking_date", row.booking_date)
    .eq("experience_id", row.experience_id)
    .eq("channel_id", row.channel_id)
    .eq("adults", people.adults)
    .eq("children", people.children)
    .eq("infants", people.infants);

  const possibleDuplicate = (data ?? []).find(
    (booking) =>
      booking.is_cancelled !== true &&
      normalizeTime(booking.booking_time) === rowTime &&
      customerMatchKey(booking.customer_name) === rowCustomerKey
  );

  return possibleDuplicate ?? null;
}

async function getExperience(experienceId: number) {
  const { data, error } = await supabaseServer
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
    .eq("id", experienceId)
    .single();

  if (error || !data) return null;

  return data as ExperienceRow;
}

async function getChannel(channelId: number) {
  const { data, error } = await supabaseServer
    .from("channels")
    .select("id, name")
    .eq("id", channelId)
    .single();

  if (error || !data) return null;

  return data as ChannelRow;
}

async function getPrice(experienceId: number, channelId: number) {
  const { data, error } = await supabaseServer
    .from("experience_channel_prices")
    .select("your_unit_price, public_unit_price")
    .eq("experience_id", experienceId)
    .eq("channel_id", channelId)
    .limit(1);

  if (error || !data?.[0]) return null;

  return data[0] as PriceRow;
}

export async function importSelectedGoogleCalendarRows(formData: FormData) {
  const selectedIds = getSelectedIds(formData);
  const returnDate = getReturnDate(formData);
  const excludeHorseback = getExcludeHorseback(formData);
  const forceImport = shouldForceImport(formData);

  if (selectedIds.length === 0) {
    redirectBack(returnDate, excludeHorseback);
  }

  const { data: rowsData } = await supabaseServer
    .from("google_calendar_import_staging")
    .select(
      "id, booking_date, booking_time, booking_reference, customer_name, adults, children, infants, experience_id, channel_id, booking_source, notes, gcal_uid, original_title, import_status"
    )
    .in("id", selectedIds);

  const rows = (rowsData ?? []) as StagingRow[];

  for (const row of rows) {
    if (row.import_status === "gcal_cancelled") {
      continue;
    }

    const canProcessNormally =
      row.import_status === "pending" || row.import_status === "rolled_back";

    // Serve per rivalutare i vecchi "possible_duplicate" creati con la
    // precedente regola che non confrontava il nome cliente.
    const canReevaluatePossibleDuplicate =
      row.import_status === "possible_duplicate";

    const canProcessWithForce =
      canProcessNormally ||
      canReevaluatePossibleDuplicate ||
      row.import_status === "probable_match";

    if (
      forceImport
        ? !canProcessWithForce
        : !(canProcessNormally || canReevaluatePossibleDuplicate)
    ) {
      continue;
    }

    const existingByReference = await findExistingByReference(
      row.booking_reference
    );

    if (existingByReference) {
      await markRow(row.id, "already_exists", existingByReference.id);
      continue;
    }

    const possibleDuplicate = await findPossibleDuplicate(row);

    if (possibleDuplicate && !forceImport) {
      await markRow(row.id, "possible_duplicate", possibleDuplicate.id);
      continue;
    }

    const experience = await getExperience(row.experience_id);
    const channel = await getChannel(row.channel_id);
    const price = await getPrice(row.experience_id, row.channel_id);

    if (!experience || !channel || !price) {
      await markRow(row.id, "needs_review", null);
      continue;
    }

    const {
      adults,
      children,
      infants,
      nonPayingAdults,
    } = getImportPeople(row);

    const payingPax = Math.max(adults + children, 1);
    const totalPeople = Math.max(
      adults + children + infants + nonPayingAdults,
      1
    );

    const yourUnitPrice = toNumber(price.your_unit_price);
    const publicUnitPrice = toNumber(price.public_unit_price);
    const supplierUnitCost = toNumber(experience.supplier_unit_cost);
    const isGroupPricing = Boolean(experience.is_group_pricing);

    const totalToYou = isGroupPricing
      ? yourUnitPrice
      : yourUnitPrice * payingPax;

    const totalCustomer = isGroupPricing
      ? publicUnitPrice
      : publicUnitPrice * payingPax;

    const totalSupplierCost = isGroupPricing
      ? supplierUnitCost
      : supplierUnitCost * payingPax;

    const marginTotal = totalToYou - totalSupplierCost;

    const customerName = getResolvedCustomerName(row);

    const notes = cleanNote(row);

    const { data: insertedBooking, error: insertError } = await supabaseServer
      .from("bookings")
      .insert({
        customer_name: customerName,
        experience_name: experience.name,
        booking_date: row.booking_date,
        pax: payingPax,
        total_amount: totalCustomer,
        customer_payment_status: "pending",
        supplier_payment_status: "pending",
        booking_source: channel.name,
        booking_reference: row.booking_reference,
        booking_created_at: new Date().toISOString().slice(0, 10),
        booking_time: normalizeTime(row.booking_time),
        adults,
        children,
        total_people: totalPeople,
        notes,
        channel_id: row.channel_id,
        experience_id: row.experience_id,
        supplier_id: experience.supplier_id,
        your_unit_price: yourUnitPrice,
        public_unit_price: publicUnitPrice,
        supplier_unit_cost: supplierUnitCost,
        total_to_you: totalToYou,
        total_customer: totalCustomer,
        total_supplier_cost: totalSupplierCost,
        margin_total: marginTotal,
        is_cancelled: false,
        supplier_amount_paid: 0,
        infants,
        was_modified: false,
        business_unit_id: FMDQ_BUSINESS_UNIT_ID,
        non_paying_adults: nonPayingAdults,
      })
      .select("id")
      .single();

    if (insertError || !insertedBooking) {
      await markRow(row.id, "needs_review", null);
      continue;
    }

    await markRow(row.id, "imported", insertedBooking.id);
  }

  redirectBack(returnDate, excludeHorseback);
}

export async function ignoreSelectedGoogleCalendarRows(formData: FormData) {
  const selectedIds = getSelectedIds(formData);
  const returnDate = getReturnDate(formData);
  const excludeHorseback = getExcludeHorseback(formData);

  if (selectedIds.length > 0) {
    await supabaseServer
      .from("google_calendar_import_staging")
      .update({
        import_status: "ignored",
        imported_booking_id: null,
      })
      .in("id", selectedIds)
      .in("import_status", [
        "pending",
        "rolled_back",
        "needs_review",
        "possible_duplicate",
        "probable_match",
        "gcal_cancelled",
      ]);
  }

  redirectBack(returnDate, excludeHorseback);
}

export async function resetSelectedGoogleCalendarRows(formData: FormData) {
  const selectedIds = getSelectedIds(formData);
  const returnDate = getReturnDate(formData);
  const excludeHorseback = getExcludeHorseback(formData);

  if (selectedIds.length > 0) {
    await supabaseServer
      .from("google_calendar_import_staging")
      .update({
        import_status: "pending",
        imported_booking_id: null,
      })
      .in("id", selectedIds)
      .in("import_status", [
        "rolled_back",
        "ignored",
        "needs_review",
        "possible_duplicate",
        "probable_match",
        "gcal_cancelled",
      ]);
  }

  redirectBack(returnDate, excludeHorseback);
}

export async function restoreBookingFromImport(formData: FormData) {
  const bookingId = Number(formData.get("id"));
  const returnDate = getReturnDate(formData);
  const excludeHorseback = getExcludeHorseback(formData);

  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    redirectBack(returnDate, excludeHorseback);
  }

  await supabaseServer
    .from("bookings")
    .update({
      is_cancelled: false,
    })
    .eq("id", bookingId);

  redirectBack(returnDate, excludeHorseback);
}

export async function deleteBookingFromImport(formData: FormData) {
  const bookingId = Number(formData.get("id"));
  const returnDate = getReturnDate(formData);
  const excludeHorseback = getExcludeHorseback(formData);

  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    redirectBack(returnDate, excludeHorseback);
  }

  await supabaseServer
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("is_cancelled", true);

  redirectBack(returnDate, excludeHorseback);
}
