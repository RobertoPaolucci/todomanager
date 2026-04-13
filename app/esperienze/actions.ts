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

function parseRequiredInt(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function ensureBusinessUnitExists(businessUnitId: number) {
  const { data, error } = await supabaseServer
    .from("business_units")
    .select("id, name, is_active")
    .eq("id", businessUnitId)
    .single();

  if (error || !data) {
    throw new Error("Business unit non trovata");
  }

  if (!data.is_active) {
    throw new Error("La business unit selezionata non è attiva");
  }

  return data;
}

async function ensureSupplierAllowedForBusinessUnit(params: {
  businessUnitId: number;
  supplierId: number | null;
}) {
  if (!params.supplierId) return;

  const { data, error } = await supabaseServer
    .from("business_unit_internal_suppliers")
    .select("business_unit_id")
    .eq("supplier_id", params.supplierId);

  if (error) {
    throw new Error(
      `Errore controllo fornitore/business unit: ${error.message}`
    );
  }

  if (!data || data.length === 0) {
    return;
  }

  const allowed = data.some(
    (row) => Number(row.business_unit_id) === params.businessUnitId
  );

  if (!allowed) {
    throw new Error(
      "Questo fornitore interno è collegato a un'altra business unit. Seleziona la business unit corretta oppure usa un fornitore condiviso."
    );
  }
}

export async function createExperience(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const business_unit_id = parseRequiredInt(formData.get("business_unit_id"));
  const bokun_id = String(formData.get("bokun_id") || "").trim() || null;
  const supplier_id = parseNullableNumber(formData.get("supplier_id"));
  const supplier_unit_cost = parseNumber(formData.get("supplier_unit_cost"));
  const notes = String(formData.get("notes") || "").trim();
  const active = formData.get("active") === "on";
  const is_group_pricing = formData.get("is_group_pricing") === "on";

  if (!name) {
    throw new Error("Il nome esperienza è obbligatorio");
  }

  if (!business_unit_id) {
    throw new Error("La business unit è obbligatoria");
  }

  await ensureBusinessUnitExists(business_unit_id);
  await ensureSupplierAllowedForBusinessUnit({
    businessUnitId: business_unit_id,
    supplierId: supplier_id,
  });

  const { error } = await supabaseServer.from("experiences").insert({
    name,
    business_unit_id,
    bokun_id,
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
  revalidatePath("/esperienze/nuova");
  redirect("/esperienze");
}

export async function updateExperience(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const business_unit_id = parseRequiredInt(formData.get("business_unit_id"));
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

  if (!business_unit_id) {
    throw new Error("La business unit è obbligatoria");
  }

  await ensureBusinessUnitExists(business_unit_id);
  await ensureSupplierAllowedForBusinessUnit({
    businessUnitId: business_unit_id,
    supplierId: supplier_id,
  });

  const { error } = await supabaseServer
    .from("experiences")
    .update({
      name,
      business_unit_id,
      bokun_id,
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

  const { error } = await supabaseServer
    .from("experiences")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Errore eliminazione esperienza: ${error.message}`);
  }

  revalidatePath("/esperienze");
}