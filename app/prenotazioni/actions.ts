"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

function parseNumber(value: FormDataEntryValue | null, fallback = 0) {
  const raw = String(value ?? "").replace(",", ".").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text === "" ? null : text;
}

export async function createBooking(formData: FormData) {
  const returnTo = String(formData.get("returnTo") || "/prenotazioni").trim();
  const intent = formData.get("intent"); 

  const channel_id = Number(formData.get("channel_id") || 0);
  const experience_id = Number(formData.get("experience_id") || 0);

  const booking_reference = String(formData.get("booking_reference") || "").trim();
  const booking_created_at = String(formData.get("booking_created_at") || "").trim();

  const customer_name = String(formData.get("customer_name") || "").trim();
  const customer_phone = String(formData.get("customer_phone") || "").trim();
  const customer_email = String(formData.get("customer_email") || "").trim();

  const experience_name = String(formData.get("experience_name") || "").trim();
  const booking_date = String(formData.get("booking_date") || "").trim();
  const booking_time = String(formData.get("booking_time") || "").trim();

  const adults = Number(formData.get("adults") || 0);
  const children = Number(formData.get("children") || 0);
  const infants = Number(formData.get("infants") || 0);
  
  const total_people = adults + children + infants;
  const pricing_pax = adults + children;

  const customer_payment_status = String(formData.get("customer_payment_status") || "pending").trim();
  const supplier_payment_status = String(formData.get("supplier_payment_status") || "pending").trim();
  
  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);
  const notes = String(formData.get("notes") || "").trim();

  if (!channel_id || !experience_id || !experience_name || !booking_date || !customer_name || !booking_created_at) {
    return { error: "Compila tutti i campi obbligatori." };
  }

  const { data: experience, error: experienceError } = await supabase
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
    .eq("id", experience_id)
    .single();
  
  if (experienceError || !experience) return { error: "Esperienza non trovata." };

  const isGroupPricing = experience.is_group_pricing === true;

  const { data: channel } = await supabase.from("channels").select("id, name").eq("id", channel_id).single();
  const { data: priceRowData } = await supabase.from("experience_channel_prices").select("your_unit_price, public_unit_price").eq("experience_id", experience_id).eq("channel_id", channel_id).single();

  let your_unit_price = 0;
  let public_unit_price = 0;

  if (priceRowData) {
    your_unit_price = Number(priceRowData.your_unit_price || 0);
    public_unit_price = Number(priceRowData.public_unit_price || 0);
  } else {
    your_unit_price = parseNumber(formData.get("new_your_unit_price"), 0);
    public_unit_price = parseNumber(formData.get("new_public_unit_price"), 0);
    
    if (your_unit_price > 0) {
      await supabase.from("experience_channel_prices").insert({
        experience_id, channel_id, your_unit_price, public_unit_price
      });
    } else {
      return { error: "⚠️ Prezzo mancante. Inserisci i prezzi per procedere." };
    }
  }

  const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);
  
  const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
  const total_customer = isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax);
  const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);
  const margin_total = total_to_you - total_supplier_cost;

  const { error } = await supabase.from("bookings").insert({
    channel_id,
    booking_source: channel?.name,
    experience_id,
    supplier_id: experience.supplier_id,
    booking_reference: booking_reference || null,
    booking_created_at,
    customer_name,
    customer_phone: customer_phone || null,
    customer_email: customer_email || null,
    experience_name,
    booking_date,
    booking_time: booking_time || null,
    adults,
    children,
    infants,
    total_people,
    pax: total_people,
    total_amount: total_customer,
    your_unit_price,
    public_unit_price,
    supplier_unit_cost,
    total_to_you,
    total_customer,
    total_supplier_cost,
    margin_total,
    customer_payment_status,
    supplier_payment_status,
    supplier_amount_paid,
    notes: notes || null,
    is_cancelled: false,
  });

  // GESTIONE ERRORE DOPPIONE (Codice Postgres 23505)
  if (error) {
    if (error.code === '23505' || error.message.includes('unique_booking_ref') || error.message.includes('duplicate')) {
      return { error: "⚠️ Attenzione: Questo Numero di Riferimento esiste già. Usa un codice diverso." };
    }
    return { error: `Errore durante il salvataggio: ${error.message}` };
  }

  revalidatePath("/prenotazioni");
  if (intent === "save_and_new") redirect("/prenotazioni/nuova");
  else redirect(returnTo);
}

export async function updateBooking(formData: FormData) {
  const returnTo = String(formData.get("returnTo") || "/prenotazioni").trim();
  const id = Number(formData.get("id") || 0);
  const channel_id = Number(formData.get("channel_id") || 0);
  const experience_id = Number(formData.get("experience_id") || 0);

  const booking_reference = normalizeText(formData.get("booking_reference"));
  const booking_created_at = String(formData.get("booking_created_at") || "").trim();
  const customer_name = String(formData.get("customer_name") || "").trim();
  const customer_phone = normalizeText(formData.get("customer_phone"));
  const customer_email = normalizeText(formData.get("customer_email"));
  const booking_date = String(formData.get("booking_date") || "").trim();
  const booking_time = normalizeText(formData.get("booking_time"));

  const adults = parseNumber(formData.get("adults"), 0);
  const children = parseNumber(formData.get("children"), 0);
  const infants = parseNumber(formData.get("infants"), 0);
  
  const total_people = adults + children + infants;
  const pricing_pax = adults + children;

  const customer_payment_status = String(formData.get("customer_payment_status") || "pending").trim();
  const supplier_payment_status = String(formData.get("supplier_payment_status") || "pending").trim();
  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);
  const notes = normalizeText(formData.get("notes"));

  if (!id) return { error: "ID prenotazione non valido." };

  const { data: experience } = await supabase
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
    .eq("id", experience_id)
    .single();

  const isGroupPricing = experience?.is_group_pricing === true;

  const { data: channel } = await supabase.from("channels").select("id, name").eq("id", channel_id).single();
  const { data: priceRow } = await supabase.from("experience_channel_prices").select("your_unit_price, public_unit_price").eq("experience_id", experience_id).eq("channel_id", channel_id).single();

  const your_unit_price = Number(priceRow?.your_unit_price || 0);
  const public_unit_price = Number(priceRow?.public_unit_price || 0);
  const supplier_unit_cost = Number(experience?.supplier_unit_cost || 0);

  const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
  const total_customer = isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax);
  const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);
  const margin_total = total_to_you - total_supplier_cost;

  const { error } = await supabase.from("bookings").update({
    channel_id,
    booking_source: channel?.name,
    experience_id,
    supplier_id: experience?.supplier_id,
    booking_reference,
    booking_created_at,
    customer_name,
    customer_phone,
    customer_email,
    experience_name: experience?.name,
    booking_date,
    booking_time,
    adults,
    children,
    infants,
    total_people,
    pax: total_people,
    total_amount: total_customer,
    your_unit_price,
    public_unit_price,
    supplier_unit_cost,
    total_to_you,
    total_customer,
    total_supplier_cost,
    margin_total,
    customer_payment_status,
    supplier_payment_status,
    supplier_amount_paid,
    notes,
  }).eq("id", id);

  // GESTIONE ERRORE DOPPIONE IN MODIFICA
  if (error) {
    if (error.code === '23505' || error.message.includes('unique_booking_ref') || error.message.includes('duplicate')) {
      return { error: "⚠️ Attenzione: Questo Numero di Riferimento è già usato da un'altra prenotazione." };
    }
    return { error: `Errore durante la modifica: ${error.message}` };
  }

  revalidatePath("/prenotazioni");
  revalidatePath(`/prenotazioni/${id}/modifica`);
  revalidatePath("/pagamenti");
  redirect(returnTo);
}

export async function cancelBooking(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const { error } = await supabase.from("bookings").update({
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
    }).eq("id", id);
  if (error) throw new Error(`Errore: ${error.message}`);
  revalidatePath("/prenotazioni");
}

export async function clearAlert(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  if (!id) return;

  const { error } = await supabase
    .from("bookings")
    .update({ notes: null })
    .eq("id", id);

  if (error) throw new Error(`Errore: ${error.message}`);
  
  revalidatePath("/prenotazioni");
  revalidatePath("/"); 
}