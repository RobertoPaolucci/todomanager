"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

function getCurrentPaidAmount(booking: any) {
  const costo = Number(booking.total_supplier_cost || 0);

  if (booking.is_cancelled) return 0;
  if (booking.supplier_payment_status === "paid") return costo;

  const rawPaid = Number(booking.supplier_amount_paid || 0);
  return Math.max(0, Math.min(rawPaid, costo));
}

export async function addSupplierPayment(formData: FormData) {
  const supplier_id = Number(formData.get("supplier_id"));
  const amount = Number(formData.get("amount"));
  const payment_date = String(formData.get("payment_date") || "").trim();
  const payment_method = String(formData.get("payment_method") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!supplier_id || !amount || !payment_date || !payment_method) {
    throw new Error("Compila tutti i campi obbligatori del pagamento");
  }

  if (amount <= 0) {
    throw new Error("L'importo del pagamento deve essere maggiore di zero");
  }

  const { error: insertPaymentError } = await supabaseServer
    .from("supplier_payments")
    .insert({
      supplier_id,
      amount,
      payment_date,
      payment_method,
      notes: notes || null,
    });

  if (insertPaymentError) {
    throw new Error(`Errore registrazione pagamento: ${insertPaymentError.message}`);
  }

  const { data: bookings, error: bookingsError } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_date, total_supplier_cost, supplier_amount_paid, supplier_payment_status, is_cancelled"
    )
    .eq("supplier_id", supplier_id)
    .order("booking_date", { ascending: true });

  if (bookingsError) {
    throw new Error(`Errore lettura prenotazioni fornitore: ${bookingsError.message}`);
  }

  const activeBookings = (bookings || []).filter((b) => !b.is_cancelled);

  let remainingAmount = amount;

  for (const booking of activeBookings) {
    if (remainingAmount <= 0) break;

    const costo = Number(booking.total_supplier_cost || 0);
    const currentPaid = getCurrentPaidAmount(booking);
    const remainingForBooking = Math.max(0, costo - currentPaid);

    if (remainingForBooking <= 0) continue;

    const amountForBooking = Math.min(remainingAmount, remainingForBooking);
    const newPaidAmount = currentPaid + amountForBooking;

    let newStatus: string | null = null;
    if (newPaidAmount >= costo) {
      newStatus = "paid";
    } else if (newPaidAmount > 0) {
      newStatus = "partial";
    }

    const { error: updateError } = await supabaseServer
      .from("bookings")
      .update({
        supplier_amount_paid: newPaidAmount,
        supplier_payment_status: newStatus,
      })
      .eq("id", booking.id);

    if (updateError) {
      throw new Error(`Errore aggiornamento prenotazione ${booking.id}: ${updateError.message}`);
    }

    remainingAmount -= amountForBooking;
  }

  revalidatePath(`/pagamenti/${supplier_id}`);
  revalidatePath("/pagamenti");
  revalidatePath("/prenotazioni");

  redirect(`/pagamenti/${supplier_id}`);
}