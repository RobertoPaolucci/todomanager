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

function shouldForceImport(formData: FormData) {
  return String(formData.get("force_import") ?? "").trim() === "true";
}

function redirectBack(date: string) {
  revalidatePath("/import/google-calendar");
  revalidatePath("/prenotazioni");
  redirect(`/import/google-calendar${date ? `?date=${date}` : ""}`);
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

  const { data } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_time, experience_id, channel_id, adults, children, infants"
    )
    .eq("booking_date", row.booking_date)
    .eq("experience_id", row.experience_id)
    .eq("channel_id", row.channel_id)
    .eq("adults", Number(row.adults ?? 0))
    .eq("children", Number(row.children ?? 0))
    .eq("infants", Number(row.infants ?? 0));

  const possibleDuplicate = (data ?? []).find(
    (booking) => normalizeTime(booking.booking_time) === rowTime
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
  const forceImport = shouldForceImport(formData);

  if (selectedIds.length === 0) {
    redirectBack(returnDate);
  }

  const { data: rowsData } = await supabaseServer
    .from("google_calendar_import_staging")
    .select(
      "id, booking_date, booking_time, booking_reference, customer_name, adults, children, infants, experience_id, channel_id, booking_source, notes, gcal_uid, original_title, import_status"
    )
    .in("id", selectedIds);

  const rows = (rowsData ?? []) as StagingRow[];

  for (const row of rows) {
    const canProcessNormally =
      row.import_status === "pending" || row.import_status === "rolled_back";

    const canProcessWithForce =
      canProcessNormally || row.import_status === "possible_duplicate";

    if (forceImport ? !canProcessWithForce : !canProcessNormally) {
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

    const adults = Number(row.adults ?? 0);
    const children = Number(row.children ?? 0);
    const infants = Number(row.infants ?? 0);

    const payingPax = Math.max(adults + children, 1);
    const totalPeople = Math.max(adults + children + infants, 1);

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

    const customerName =
      String(row.customer_name ?? "").trim() || "Da verificare";

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
        non_paying_adults: 0,
      })
      .select("id")
      .single();

    if (insertError || !insertedBooking) {
      await markRow(row.id, "needs_review", null);
      continue;
    }

    await markRow(row.id, "imported", insertedBooking.id);
  }

  redirectBack(returnDate);
}

export async function ignoreSelectedGoogleCalendarRows(formData: FormData) {
  const selectedIds = getSelectedIds(formData);
  const returnDate = getReturnDate(formData);

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
      ]);
  }

  redirectBack(returnDate);
}

export async function resetSelectedGoogleCalendarRows(formData: FormData) {
  const selectedIds = getSelectedIds(formData);
  const returnDate = getReturnDate(formData);

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
      ]);
  }

  redirectBack(returnDate);
}