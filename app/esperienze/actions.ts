"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

export async function createExperience(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const supplier_id_raw = String(formData.get("supplier_id") || "").trim();
  const supplier_unit_cost = Number(formData.get("supplier_unit_cost") || 0);
  const base_price = Number(formData.get("base_price") || 0);
  const notes = String(formData.get("notes") || "").trim();

  const supplier_id = supplier_id_raw ? Number(supplier_id_raw) : null;

  if (!name) {
    throw new Error("Il nome esperienza è obbligatorio");
  }

  const { error } = await supabase.from("experiences").insert({
    name,
    supplier_id,
    supplier_unit_cost,
    base_price,
    notes: notes || null,
    active: true,
  });

  if (error) {
    throw new Error(`Errore nel salvataggio esperienza: ${error.message}`);
  }

  redirect("/esperienze");
}

export async function updateExperience(id: number, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const supplier_id_raw = String(formData.get("supplier_id") || "").trim();
  const supplier_unit_cost = Number(formData.get("supplier_unit_cost") || 0);
  const base_price = Number(formData.get("base_price") || 0);
  const notes = String(formData.get("notes") || "").trim();
  const active = String(formData.get("active") || "true") === "true";

  const supplier_id = supplier_id_raw ? Number(supplier_id_raw) : null;

  if (!name) {
    throw new Error("Il nome esperienza è obbligatorio");
  }

  const { error } = await supabase
    .from("experiences")
    .update({
      name,
      supplier_id,
      supplier_unit_cost,
      base_price,
      notes: notes || null,
      active,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Errore nell'aggiornamento esperienza: ${error.message}`);
  }

  redirect("/esperienze");
}

export async function deleteExperience(formData: FormData) {
  const id = Number(formData.get("id") || 0);

  if (!id) {
    throw new Error("ID esperienza non valido");
  }

  const { error } = await supabase.from("experiences").delete().eq("id", id);

  if (error) {
    throw new Error(`Errore nell'eliminazione esperienza: ${error.message}`);
  }

  redirect("/esperienze");
}