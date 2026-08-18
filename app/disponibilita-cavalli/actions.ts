"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

export async function confirmCognanelloAvailability(formData: FormData) {
  const notificationId = Number(formData.get("notification_id") || 0);

  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    throw new Error("Comunicazione Cognanello non valida");
  }

  const { error } = await supabaseServer
    .from("horseback_availability_history")
    .update({ requested_by: "Cognanello (gestita)" })
    .eq("id", notificationId)
    .eq("requested_by", "Cognanello");

  if (error) {
    throw new Error(`Errore conferma comunicazione: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/disponibilita-cavalli");
}
