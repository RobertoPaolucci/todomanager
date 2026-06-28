"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

type ExtractedReferenceItem = {
  booking_reference: string;
  booking_date: string;
};

type ReconciledBookingItem = {
  id: number;
  booking_reference: string;
  booking_date: string | null;
  customer_name: string | null;
  experience_name: string | null;
};

type NotFoundReferenceItem = {
  booking_reference: string;
  booking_date: string;
};

type ReconcilePaymentsResult = {
  parsed: number;
  foundInDb: number;
  updated: number;
  alreadyPaid: number;
  notFound: number;
  notFoundReferences: string[];
  notFoundItems: NotFoundReferenceItem[];
  updatedBookings: ReconciledBookingItem[];
  alreadyPaidBookings: ReconciledBookingItem[];
};

type ReconciliationImportItem = {
  id: number;
  created_at: string;
  file_name: string | null;
  file_type: string | null;
  reference_month: string | null;
  reference_start_date: string | null;
  reference_end_date: string | null;
  parsed: number;
  found_in_db: number;
  updated: number;
  already_paid: number;
  not_found: number;
};

function normalizeBookingReference(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function isLikelyBookingReference(value: unknown) {
  const ref = normalizeBookingReference(value);

  if (!ref) return false;
  if (ref === "UNDEFINED" || ref === "NULL" || ref === "N/A") return false;
  if (ref.length < 6 || ref.length > 40) return false;
  if (ref.includes(":")) return false;
  if (!/^[A-Z0-9/_-]+$/.test(ref)) return false;
  if (!/\d/.test(ref)) return false;

  return true;
}

function isValidDateString(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function toSerializableBooking(booking: {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  customer_name: string | null;
  experience_name: string | null;
}): ReconciledBookingItem {
  return {
    id: booking.id,
    booking_reference: normalizeBookingReference(booking.booking_reference),
    booking_date: booking.booking_date ?? null,
    customer_name: booking.customer_name ?? null,
    experience_name: booking.experience_name ?? null,
  };
}

function sortByDateAndReference<T extends { booking_date: string; booking_reference: string }>(
  items: T[]
) {
  return [...items].sort((a, b) => {
    if (a.booking_date !== b.booking_date) {
      return a.booking_date.localeCompare(b.booking_date);
    }
    return a.booking_reference.localeCompare(b.booking_reference);
  });
}

function sortReconciledBookings(items: ReconciledBookingItem[]) {
  return [...items].sort((a, b) => {
    const dateA = a.booking_date || "";
    const dateB = b.booking_date || "";

    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.booking_reference.localeCompare(b.booking_reference);
  });
}

export async function getReconciledPaymentsHistory(
  limit = 300
): Promise<ReconciledBookingItem[]> {
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 500);

  const { data, error } = await supabaseServer
    .from("bookings")
    .select("id, booking_reference, booking_date, customer_name, experience_name")
    .eq("customer_payment_status", "paid")
    .order("booking_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((booking) =>
    toSerializableBooking({
      id: booking.id,
      booking_reference: booking.booking_reference,
      booking_date: booking.booking_date,
      customer_name: booking.customer_name,
      experience_name: booking.experience_name,
    })
  );
}

export async function getPaymentReconciliationImportHistory(
  limit = 50
): Promise<ReconciliationImportItem[]> {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const { data, error } = await supabaseServer
    .from("payment_reconciliation_imports")
    .select(
      "id, created_at, file_name, file_type, reference_month, reference_start_date, reference_end_date, parsed, found_in_db, updated, already_paid, not_found"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((item) => ({
    id: Number(item.id),
    created_at: String(item.created_at),
    file_name: item.file_name ?? null,
    file_type: item.file_type ?? null,
    reference_month: item.reference_month ?? null,
    reference_start_date: item.reference_start_date ?? null,
    reference_end_date: item.reference_end_date ?? null,
    parsed: Number(item.parsed || 0),
    found_in_db: Number(item.found_in_db || 0),
    updated: Number(item.updated || 0),
    already_paid: Number(item.already_paid || 0),
    not_found: Number(item.not_found || 0),
  }));
}

export async function reconcilePayments(
  items: ExtractedReferenceItem[],
  fileMeta?: {
    file_name?: string | null;
    file_type?: string | null;
    reference_month?: string | null;
    reference_start_date?: string | null;
    reference_end_date?: string | null;
  }
): Promise<ReconcilePaymentsResult> {
  const dedupeMap = new Map<string, ExtractedReferenceItem>();

  for (const item of items || []) {
    const booking_reference = normalizeBookingReference(item?.booking_reference);
    const booking_date = String(item?.booking_date || "").trim();

    if (!isLikelyBookingReference(booking_reference)) continue;
    if (!isValidDateString(booking_date)) continue;

    if (!dedupeMap.has(booking_reference)) {
      dedupeMap.set(booking_reference, {
        booking_reference,
        booking_date,
      });
    }
  }

  const cleanedItems = Array.from(dedupeMap.values());

  if (cleanedItems.length === 0) {
    throw new Error("Nessun codice di riferimento valido trovato nel file.");
  }

  const cleanedReferences = cleanedItems.map((item) => item.booking_reference);

  const { data: bookings, error } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_reference, booking_date, customer_name, experience_name, customer_payment_status"
    )
    .in("booking_reference", cleanedReferences);

  if (error) {
    throw new Error(error.message);
  }

  const foundBookings = bookings || [];

  const foundReferenceSet = new Set(
    foundBookings.map((b) => normalizeBookingReference(b.booking_reference))
  );

  const notFoundItems = sortByDateAndReference(
    cleanedItems.filter(
      (item) => !foundReferenceSet.has(normalizeBookingReference(item.booking_reference))
    )
  );

  const alreadyPaidRows = foundBookings.filter(
    (b) => b.customer_payment_status === "paid"
  );

  const toUpdateRows = foundBookings.filter(
    (b) => b.customer_payment_status !== "paid"
  );

  const updatedBookings: ReconciledBookingItem[] = [];

  for (const booking of toUpdateRows) {
    const { error: updateError } = await supabaseServer
      .from("bookings")
      .update({ customer_payment_status: "paid" })
      .eq("id", booking.id);

    if (!updateError) {
      updatedBookings.push(
        toSerializableBooking({
          id: booking.id,
          booking_reference: booking.booking_reference,
          booking_date: booking.booking_date,
          customer_name: booking.customer_name,
          experience_name: booking.experience_name,
        })
      );
    }
  }

  const alreadyPaidBookings = sortReconciledBookings(
    alreadyPaidRows.map((booking) =>
      toSerializableBooking({
        id: booking.id,
        booking_reference: booking.booking_reference,
        booking_date: booking.booking_date,
        customer_name: booking.customer_name,
        experience_name: booking.experience_name,
      })
    )
  );

  updatedBookings.sort((a, b) => {
    const dateA = a.booking_date || "";
    const dateB = b.booking_date || "";

    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.booking_reference.localeCompare(b.booking_reference);
  });

  revalidatePath("/");
  revalidatePath("/prenotazioni");
  revalidatePath("/prenotazioni/riconciliazione");

  const result = {
    parsed: cleanedItems.length,
    foundInDb: foundBookings.length,
    updated: updatedBookings.length,
    alreadyPaid: alreadyPaidBookings.length,
    notFound: notFoundItems.length,
    notFoundReferences: notFoundItems.map((item) => item.booking_reference),
    notFoundItems,
    updatedBookings,
    alreadyPaidBookings,
  };

  const { error: importLogError } = await supabaseServer
    .from("payment_reconciliation_imports")
    .insert({
      file_name: fileMeta?.file_name || null,
      file_type: fileMeta?.file_type || null,
      reference_month: fileMeta?.reference_month || null,
      reference_start_date: fileMeta?.reference_start_date || null,
      reference_end_date: fileMeta?.reference_end_date || null,
      parsed: result.parsed,
      found_in_db: result.foundInDb,
      updated: result.updated,
      already_paid: result.alreadyPaid,
      not_found: result.notFound,
    });

  if (importLogError) {
    console.error(
      "Errore salvataggio storico riconciliazione:",
      importLogError.message
    );
  }

  return result;
}
