"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

export async function createExperience(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  // Aggiunto recupero bokun_id
  const bokun_id = String(formData.get("bokun_id") || "").trim() || null; 
  const supplier_id = parseNullableNumber(formData.get("supplier_id"));
  const supplier_unit_cost = parseNumber(formData.get("supplier_unit_cost"));
  const notes = String(formData.get("notes") || "").trim();
  const active = formData.get("active") === "on";
  const is_group_pricing = formData.get("is_group_pricing") === "on";

  if (!name) {
    throw new Error("Il nome esperienza è obbligatorio");
  }

  const { error } = await supabase.from("experiences").insert({
    name,
    bokun_id, // Salviamo il dato nel database
    supplier_id,
    supplier_unit_cost,
    notes: notes || null,
    active,
    is_group_pricing,
  });

  if (error) {
    throw new Error(`Errore creazione esperienza: ${error.message}`);
  }

  revalidatePath("/esperienze");
  redirect("/esperienze");
}

export async function updateExperience(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  // Aggiunto recupero bokun_id
  const bokun_id = String(formData.get("bokun_id") || "").trim() || null;
  const supplier_id = parseNullableNumber(formData.get("supplier_id"));
  const supplier_unit_cost = parseNumber(formData.get("supplier_unit_cost"));
  const notes = String(formData.get("notes") || "").trim();
  const active = formData.get("active") === "on";
  const is_group_pricing = formData.get("is_group_pricing") === "on";

  if (!id) {
    throw new Error("ID esperienza non valido");
  }

  if (!name) {
    throw new Error("Il nome esperienza è obbligatorio");
  }

  const { error } = await supabase
    .from("experiences")
    .update({
      name,
      bokun_id, // Aggiorniamo il dato nel database
      supplier_id,
      supplier_unit_cost,
      notes: notes || null,
      active,
      is_group_pricing,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Errore aggiornamento esperienza: ${error.message}`);
  }

  revalidatePath("/esperienze");
  revalidatePath(`/esperienze/${id}/modifica`);
  redirect("/esperienze");
}

export async function deleteExperience(formData: FormData) {
  const id = Number(formData.get("id"));

  if (!id) {
    throw new Error("ID esperienza non valido");
  }

  const { error } = await supabase
    .from("experiences")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Errore eliminazione esperienza: ${error.message}`);
  }

  revalidatePath("/esperienze");
}