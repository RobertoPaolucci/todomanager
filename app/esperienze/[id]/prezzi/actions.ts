"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

function parseMoney(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return 0;
  const normalized = value.replace(",", ".").trim();
  if (normalized === "") return 0;
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function saveExperienceChannelPrices(formData: FormData) {
  const experienceId = Number(formData.get("experience_id"));

  if (!experienceId) {
    throw new Error("ID esperienza non valido");
  }

  const { data: channels, error: channelsError } = await supabaseServer
    .from("channels")
    .select("id")
    .order("id", { ascending: true });

  if (channelsError) {
    throw new Error(`Errore caricamento canali: ${channelsError.message}`);
  }

  const rows = (channels ?? []).map((channel) => {
    const your_unit_price = parseMoney(formData.get(`your_unit_price_${channel.id}`));
    const public_unit_price = parseMoney(formData.get(`public_unit_price_${channel.id}`));
    const currency =
      String(formData.get(`currency_${channel.id}`) || "EUR").trim() || "EUR";
    const notes = String(formData.get(`notes_${channel.id}`) || "").trim();

    return {
      experience_id: experienceId,
      channel_id: channel.id,
      your_unit_price,
      public_unit_price,
      currency,
      notes: notes || null,
    };
  });

  const { error: deleteError } = await supabaseServer
    .from("experience_channel_prices")
    .delete()
    .eq("experience_id", experienceId);

  if (deleteError) {
    throw new Error(`Errore pulizia prezzi canale: ${deleteError.message}`);
  }

  const { error: insertError } = await supabaseServer
    .from("experience_channel_prices")
    .insert(rows);

  if (insertError) {
    throw new Error(`Errore salvataggio prezzi canale: ${insertError.message}`);
  }

  revalidatePath("/esperienze");
  revalidatePath(`/esperienze/${experienceId}/prezzi`);
}