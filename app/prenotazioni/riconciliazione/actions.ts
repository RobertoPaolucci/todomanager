"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function reconcilePayments(references: string[]) {
  if (!references || references.length === 0) {
    throw new Error("Nessun codice di riferimento trovato nel file.");
  }

  // Cerca tutte le prenotazioni che corrispondono a questi codici
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, booking_reference, customer_payment_status")
    .in("booking_reference", references);

  if (error) throw new Error(error.message);

  // Filtra solo quelle che non sono ancora segnate come "paid"
  const toUpdate = bookings?.filter(b => b.customer_payment_status !== "paid") || [];
  
  let updatedCount = 0;

  // Aggiorna lo stato a "paid" (Incassato) per quelle trovate
  for (const b of toUpdate) {
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ customer_payment_status: "paid" })
      .eq("id", b.id);
      
    if (!updateError) updatedCount++;
  }

  revalidatePath("/prenotazioni");
  revalidatePath("/");

  return {
    parsed: references.length,
    foundInDb: bookings?.length || 0,
    updated: updatedCount,
    alreadyPaid: (bookings?.length || 0) - updatedCount
  };
}