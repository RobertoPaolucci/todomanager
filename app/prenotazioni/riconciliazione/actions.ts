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

export async function reconcilePayments(
  items: ExtractedReferenceItem[]
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

  const alreadyPaidBookings = alreadyPaidRows
    .map((booking) =>
      toSerializableBooking({
        id: booking.id,
        booking_reference: booking.booking_reference,
        booking_date: booking.booking_date,
        customer_name: booking.customer_name,
        experience_name: booking.experience_name,
      })
    )
    .sort((a, b) => {
      const dateA = a.booking_date || "";
      const dateB = b.booking_date || "";

      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.booking_reference.localeCompare(b.booking_reference);
    });

  updatedBookings.sort((a, b) => {
    const dateA = a.booking_date || "";
    const dateB = b.booking_date || "";

    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.booking_reference.localeCompare(b.booking_reference);
  });

  revalidatePath("/");
  revalidatePath("/prenotazioni");
  revalidatePath("/prenotazioni/riconciliazione");

  return {
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
}