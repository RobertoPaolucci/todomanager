"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

const ALLOWED_CHANNEL_TYPES = new Set([
  "ota",
  "direct",
  "agency",
  "internal",
]);

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text === "" ? null : text;
}

function normalizeChannelType(value: FormDataEntryValue | null) {
  return String(value || "").trim().toLowerCase();
}

export async function createChannel(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const type = normalizeChannelType(formData.get("type"));
  const notes = normalizeText(formData.get("notes"));

  if (!name) {
    throw new Error("Il nome del canale è obbligatorio");
  }

  if (!ALLOWED_CHANNEL_TYPES.has(type)) {
    throw new Error("Tipo canale non valido");
  }

  const { error } = await supabaseServer.from("channels").insert({
    name,
    type,
    notes,
  });

  if (error) {
    throw new Error(`Errore creazione: ${error.message}`);
  }

  revalidatePath("/canali");
  revalidatePath("/canali/nuovo");
  redirect("/canali");
}

export async function updateChannel(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const name = String(formData.get("name") || "").trim();
  const type = normalizeChannelType(formData.get("type"));
  const notes = normalizeText(formData.get("notes"));

  if (!id || !name) {
    throw new Error("Dati mancanti");
  }

  if (!ALLOWED_CHANNEL_TYPES.has(type)) {
    throw new Error("Tipo canale non valido");
  }

  const { error } = await supabaseServer
    .from("channels")
    .update({ name, type, notes })
    .eq("id", id);

  if (error) {
    throw new Error(`Errore aggiornamento: ${error.message}`);
  }

  revalidatePath("/canali");
  redirect("/canali");
}

export async function deleteChannel(formData: FormData) {
  const id = Number(formData.get("id") || 0);

  if (!id) {
    throw new Error("ID canale non valido");
  }

  const { error } = await supabaseServer
    .from("channels")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Errore eliminazione: ${error.message}`);
  }

  revalidatePath("/canali");
}