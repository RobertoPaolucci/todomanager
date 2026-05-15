"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

function parseNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return 0;

  const normalized = Number(value.replace(",", "."));
  return Number.isNaN(normalized) ? 0 : normalized;
}

function parseNullableNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return null;

  const normalized = Number(value.replace(",", "."));
  return Number.isNaN(normalized) ? null : normalized;
}

function normalizeCurrency(value: FormDataEntryValue | null) {
  const text = String(value || "EUR").trim().toUpperCase();
  return text || "EUR";
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text === "" ? null : text;
}

export async function saveExperienceChannelPrices(formData: FormData) {
  const experienceId = Number(formData.get("experience_id") || 0);

  if (!experienceId || Number.isNaN(experienceId)) {
    throw new Error("ID esperienza non valido");
  }

  const { data: channels, error: channelsError } = await supabaseServer
    .from("channels")
    .select("id")
    .order("name", { ascending: true });

  if (channelsError) {
    throw new Error(`Errore caricamento canali: ${channelsError.message}`);
  }

  for (const channel of channels ?? []) {
    const channelId = Number(channel.id);

    if (!channelId) continue;

    const your_unit_price = parseNumber(
      formData.get(`your_unit_price_${channelId}`)
    );

    const your_child_unit_price = parseNullableNumber(
      formData.get(`your_child_unit_price_${channelId}`)
    );

    const public_unit_price = parseNumber(
      formData.get(`public_unit_price_${channelId}`)
    );

    const public_child_unit_price = parseNullableNumber(
      formData.get(`public_child_unit_price_${channelId}`)
    );

    const supplier_child_unit_cost = parseNullableNumber(
      formData.get(`supplier_child_unit_cost_${channelId}`)
    );

    const currency = normalizeCurrency(formData.get(`currency_${channelId}`));
    const notes = normalizeText(formData.get(`notes_${channelId}`));

    const row = {
      experience_id: experienceId,
      channel_id: channelId,
      your_unit_price,
      your_child_unit_price,
      public_unit_price,
      public_child_unit_price,
      supplier_child_unit_cost,
      currency,
      notes,
    };

    const { data: existing, error: existingError } = await supabaseServer
      .from("experience_channel_prices")
      .select("id")
      .eq("experience_id", experienceId)
      .eq("channel_id", channelId)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Errore controllo prezzo canale ${channelId}: ${existingError.message}`
      );
    }

    if (existing?.id) {
      const { error: updateError } = await supabaseServer
        .from("experience_channel_prices")
        .update(row)
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(
          `Errore aggiornamento prezzo canale ${channelId}: ${updateError.message}`
        );
      }
    } else {
      const { error: insertError } = await supabaseServer
        .from("experience_channel_prices")
        .insert(row);

      if (insertError) {
        throw new Error(
          `Errore inserimento prezzo canale ${channelId}: ${insertError.message}`
        );
      }
    }
  }

  revalidatePath("/esperienze");
  revalidatePath(`/esperienze/${experienceId}/prezzi`);
  revalidatePath("/prenotazioni");
  revalidatePath("/prenotazioni/nuova");
  revalidatePath("/pagamenti");
  revalidatePath("/");

  redirect(`/esperienze/${experienceId}/prezzi`);
}