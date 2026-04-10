"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text === "" ? null : text;
}

function revalidateSupplierPages() {
  revalidatePath("/fornitori");
  revalidatePath("/fornitori/nuovo");
  revalidatePath("/esperienze");
  revalidatePath("/esperienze/nuova");
}

export async function createSupplier(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const contact_person = normalizeText(formData.get("contact_person"));
  const email = normalizeText(formData.get("email"));
  const phone = normalizeText(formData.get("phone"));
  const website = normalizeText(formData.get("website"));
  const notes = normalizeText(formData.get("notes"));
  const active = formData.get("active") === "on";

  if (!name) {
    throw new Error("Il nome fornitore è obbligatorio");
  }

  const { error } = await supabaseServer.from("suppliers").insert({
    name,
    contact_person,
    email,
    phone,
    website,
    notes,
    active,
  });

  if (error) {
    throw new Error(`Errore creazione fornitore: ${error.message}`);
  }

  revalidateSupplierPages();
  redirect("/fornitori");
}

export async function updateSupplier(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const contact_person = normalizeText(formData.get("contact_person"));
  const email = normalizeText(formData.get("email"));
  const phone = normalizeText(formData.get("phone"));
  const website = normalizeText(formData.get("website"));
  const notes = normalizeText(formData.get("notes"));
  const active = formData.get("active") === "on";

  if (!id) {
    throw new Error("ID fornitore non valido");
  }

  if (!name) {
    throw new Error("Il nome fornitore è obbligatorio");
  }

  const { error } = await supabaseServer
    .from("suppliers")
    .update({
      name,
      contact_person,
      email,
      phone,
      website,
      notes,
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Errore aggiornamento fornitore: ${error.message}`);
  }

  revalidateSupplierPages();
  revalidatePath(`/fornitori/${id}/modifica`);
  redirect("/fornitori");
}

export async function deleteSupplier(formData: FormData) {
  const id = Number(formData.get("id"));

  if (!id) {
    throw new Error("ID fornitore non valido");
  }

  const { error } = await supabaseServer
    .from("suppliers")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Errore eliminazione fornitore: ${error.message}`);
  }

  revalidateSupplierPages();
}