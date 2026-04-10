"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

export async function createChannel(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!name) throw new Error("Il nome del canale è obbligatorio");

  const { error } = await supabaseServer.from("channels").insert({
    name,
    type,
    notes,
  });

  if (error) throw new Error(`Errore creazione: ${error.message}`);

  revalidatePath("/canali");
  redirect("/canali");
}

export async function updateChannel(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!id || !name) throw new Error("Dati mancanti");

  const { error } = await supabaseServer
    .from("channels")
    .update({ name, type, notes })
    .eq("id", id);

  if (error) throw new Error(`Errore aggiornamento: ${error.message}`);

  revalidatePath("/canali");
  redirect("/canali");
}

export async function deleteChannel(formData: FormData) {
  const id = Number(formData.get("id"));

  const { error } = await supabaseServer
    .from("channels")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`Errore eliminazione: ${error.message}`);

  revalidatePath("/canali");
}