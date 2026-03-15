"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

export async function addSupplierPayment(formData: FormData) {
  const supplier_id = Number(formData.get("supplier_id"));
  const amount = Number(formData.get("amount"));
  const payment_date = String(formData.get("payment_date") || "").trim();
  const payment_method = String(formData.get("payment_method") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!supplier_id || !amount || !payment_date || !payment_method) {
    throw new Error("Compila tutti i campi obbligatori del pagamento");
  }

  const { error } = await supabase.from("supplier_payments").insert({
    supplier_id,
    amount,
    payment_date,
    payment_method,
    notes: notes || null,
  });

  if (error) {
    throw new Error(`Errore registrazione pagamento: ${error.message}`);
  }

  // Ricarichiamo la pagina per mostrare i dati aggiornati
  revalidatePath(`/pagamenti/${supplier_id}`);
  revalidatePath("/pagamenti");
  redirect(`/pagamenti/${supplier_id}`);
}