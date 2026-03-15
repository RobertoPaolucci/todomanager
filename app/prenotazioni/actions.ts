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

function yourUnitPriceFix(unitPrice: number, people: number) {
  return unitPrice * people;
}

function yourPublicPriceFix(unitPrice: number, people: number) {
  return unitPrice * people;
}

function yourSupplierCostFix(unitCost: number, people: number) {
  return unitCost * people;
}

export async function createBooking(formData: FormData) {
  const returnTo = String(formData.get("returnTo") || "/prenotazioni").trim();

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
  const total_people = adults + children;

  const total_amount = Number(formData.get("total_amount") || 0);

  const customer_payment_status = String(formData.get("customer_payment_status") || "pending").trim();
  const supplier_payment_status = String(formData.get("supplier_payment_status") || "pending").trim();
  
  // Estrazione del nuovo campo
  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);

  const notes = String(formData.get("notes") || "").trim();

  if (!channel_id || !experience_id || !experience_name || !booking_date || !customer_name || !booking_created_at) {
    throw new Error("Compila i campi obbligatori");
  }

  if (total_people <= 0) {
    throw new Error("Inserisci almeno 1 persona");
  }

  const { data: experience, error: experienceError } = await supabase
    .from("experiences").select("id, name, supplier_id, supplier_unit_cost").eq("id", experience_id).single();
  if (experienceError || !experience) throw new Error("Esperienza non trovata");

  const { data: channel, error: channelError } = await supabase
    .from("channels").select("id, name").eq("id", channel_id).single();
  if (channelError || !channel) throw new Error("Canale non trovato");

  const { data: priceRow, error: priceError } = await supabase
    .from("experience_channel_prices").select("your_unit_price, public_unit_price").eq("experience_id", experience_id).eq("channel_id", channel_id).single();
  if (priceError || !priceRow) throw new Error("Prezzo canale/esperienza non trovato");

  const your_unit_price = Number(priceRow.your_unit_price || 0);
  const public_unit_price = Number(priceRow.public_unit_price || 0);
  const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

  const total_to_you = yourUnitPriceFix(your_unit_price, total_people);
  const total_customer = total_amount > 0 ? total_amount : yourPublicPriceFix(public_unit_price, total_people);
  const total_supplier_cost = yourSupplierCostFix(supplier_unit_cost, total_people);
  const margin_total = total_to_you - total_supplier_cost;

  const { error } = await supabase.from("bookings").insert({
    channel_id,
    booking_source: channel.name,
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
    supplier_amount_paid, // Salvataggio del nuovo campo
    notes: notes || null,
    is_cancelled: false,
  });

  if (error) throw new Error(`Errore nel salvataggio prenotazione: ${error.message}`);

  revalidatePath("/prenotazioni");
  if (returnTo !== "/prenotazioni") revalidatePath(returnTo);
  redirect(returnTo);
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
  const total_people = adults + children;

  const total_amount = parseNumber(formData.get("total_amount"), 0);

  const customer_payment_status = String(formData.get("customer_payment_status") || "pending").trim();
  const supplier_payment_status = String(formData.get("supplier_payment_status") || "pending").trim();
  
  // Estrazione del nuovo campo
  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);

  const notes = normalizeText(formData.get("notes"));

  if (!id) throw new Error("ID prenotazione non valido");
  if (!channel_id || !experience_id || !booking_date || !customer_name || !booking_created_at) {
    throw new Error("Compila i campi obbligatori");
  }
  if (total_people <= 0) throw new Error("Inserisci almeno 1 persona");

  const { data: experience, error: experienceError } = await supabase
    .from("experiences").select("id, name, supplier_id, supplier_unit_cost").eq("id", experience_id).single();
  if (experienceError || !experience) throw new Error("Esperienza non trovata");

  const { data: channel, error: channelError } = await supabase
    .from("channels").select("id, name").eq("id", channel_id).single();
  if (channelError || !channel) throw new Error("Canale non trovato");

  const { data: priceRow, error: priceError } = await supabase
    .from("experience_channel_prices").select("your_unit_price, public_unit_price").eq("experience_id", experience_id).eq("channel_id", channel_id).single();
  if (priceError || !priceRow) throw new Error("Prezzo canale/esperienza non trovato");

  const your_unit_price = Number(priceRow.your_unit_price || 0);
  const public_unit_price = Number(priceRow.public_unit_price || 0);
  const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

  const total_to_you = yourUnitPriceFix(your_unit_price, total_people);
  const total_customer = total_amount > 0 ? total_amount : yourPublicPriceFix(public_unit_price, total_people);
  const total_supplier_cost = yourSupplierCostFix(supplier_unit_cost, total_people);
  const margin_total = total_to_you - total_supplier_cost;

  const { error } = await supabase.from("bookings").update({
      channel_id,
      booking_source: channel.name,
      experience_id,
      supplier_id: experience.supplier_id,
      booking_reference,
      booking_created_at,
      customer_name,
      customer_phone,
      customer_email,
      experience_name: experience.name,
      booking_date,
      booking_time,
      adults,
      children,
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
      supplier_amount_paid, // Salvataggio del nuovo campo
      notes,
    }).eq("id", id);

  if (error) throw new Error(`Errore aggiornamento prenotazione: ${error.message}`);

  revalidatePath("/prenotazioni");
  revalidatePath(`/prenotazioni/${id}/modifica`);
  if (returnTo !== "/prenotazioni") revalidatePath(returnTo);
  redirect(returnTo);
}

export async function cancelBooking(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  if (!id) throw new Error("ID prenotazione non valido");

  const { error } = await supabase.from("bookings").update({
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
    }).eq("id", id);

  if (error) throw new Error(`Errore cancellazione prenotazione: ${error.message}`);
  revalidatePath("/prenotazioni");
}