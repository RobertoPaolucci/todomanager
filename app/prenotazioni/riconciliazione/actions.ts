"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

type ReconcilePaymentsResult = {
  parsed: number;
  foundInDb: number;
  updated: number;
  alreadyPaid: number;
  notFound: number;
  notFoundReferences: string[];
};

function normalizeBookingReference(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export async function reconcilePayments(
  references: string[]
): Promise<ReconcilePaymentsResult> {
  const cleanedReferences = Array.from(
    new Set(
      (references || [])
        .map(normalizeBookingReference)
        .filter((ref) => ref !== "" && ref !== "UNDEFINED" && ref !== "NULL")
    )
  );

  if (cleanedReferences.length === 0) {
    throw new Error("Nessun codice di riferimento trovato nel file.");
  }

  const { data: bookings, error } = await supabaseServer
    .from("bookings")
    .select("id, booking_reference, customer_payment_status")
    .in("booking_reference", cleanedReferences);

  if (error) {
    throw new Error(error.message);
  }

  const foundBookings = bookings || [];

  const foundReferenceSet = new Set(
    foundBookings.map((b) => normalizeBookingReference(b.booking_reference))
  );

  const notFoundReferences = cleanedReferences.filter(
    (ref) => !foundReferenceSet.has(normalizeBookingReference(ref))
  );

  const toUpdate = foundBookings.filter(
    (b) => b.customer_payment_status !== "paid"
  );

  let updatedCount = 0;

  for (const booking of toUpdate) {
    const { error: updateError } = await supabaseServer
      .from("bookings")
      .update({ customer_payment_status: "paid" })
      .eq("id", booking.id);

    if (!updateError) {
      updatedCount++;
    }
  }

  revalidatePath("/prenotazioni");
  revalidatePath("/");

  return {
    parsed: cleanedReferences.length,
    foundInDb: foundBookings.length,
    updated: updatedCount,
    alreadyPaid: foundBookings.length - updatedCount,
    notFound: notFoundReferences.length,
    notFoundReferences,
  };
}