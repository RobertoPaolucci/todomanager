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

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

function getEffectiveSupplierPaid(input: {
  is_cancelled?: boolean | null;
  supplier_payment_status?: string | null;
  supplier_amount_paid?: number | string | null;
  total_supplier_cost?: number | string | null;
}) {
  const costo = Number(input.total_supplier_cost || 0);
  const rawPaid = Number(input.supplier_amount_paid || 0);
  const status = String(input.supplier_payment_status || "").trim().toLowerCase();

  if (input.is_cancelled) return 0;
  if (status === "paid") return round2(costo);

  return round2(Math.max(0, Math.min(rawPaid, costo)));
}

async function insertSupplierPaymentMovement(params: {
  supplier_id: number;
  amount: number;
  payment_date: string;
  note: string;
}) {
  const roundedAmount = round2(params.amount);

  if (!params.supplier_id || Math.abs(roundedAmount) < 0.01) {
    return;
  }

  const { error } = await supabase.from("supplier_payments").insert({
    supplier_id: params.supplier_id,
    amount: roundedAmount,
    payment_date: params.payment_date,
    payment_method: "Altro",
    notes: params.note,
  });

  if (error) {
    console.error("Errore sync supplier_payments:", error.message, params);
  }
}

async function syncSupplierPaymentsFromBookingChange(params: {
  bookingId: number;
  bookingReference: string | null;
  customerName: string | null;
  oldSupplierId: number;
  newSupplierId: number;
  oldPaidAmount: number;
  newPaidAmount: number;
  paymentDate: string;
}) {
  const refPart = params.bookingReference ? ` - ${params.bookingReference}` : "";
  const namePart = params.customerName ? ` - ${params.customerName}` : "";
  const label = `prenotazione #${params.bookingId}${refPart}${namePart}`;

  if (params.oldSupplierId === params.newSupplierId) {
    const delta = round2(params.newPaidAmount - params.oldPaidAmount);

    if (Math.abs(delta) < 0.01) return;

    const note =
      delta > 0
        ? `Registrazione pagamento da Modifica Prenotazione - ${label}`
        : `Storno pagamento da Modifica Prenotazione - ${label}`;

    await insertSupplierPaymentMovement({
      supplier_id: params.newSupplierId,
      amount: delta,
      payment_date: params.paymentDate,
      note,
    });

    return;
  }

  if (params.oldSupplierId && params.oldPaidAmount > 0) {
    await insertSupplierPaymentMovement({
      supplier_id: params.oldSupplierId,
      amount: -round2(params.oldPaidAmount),
      payment_date: params.paymentDate,
      note: `Storno per cambio fornitore da Modifica Prenotazione - ${label}`,
    });
  }

  if (params.newSupplierId && params.newPaidAmount > 0) {
    await insertSupplierPaymentMovement({
      supplier_id: params.newSupplierId,
      amount: round2(params.newPaidAmount),
      payment_date: params.paymentDate,
      note: `Registrazione pagamento per cambio fornitore da Modifica Prenotazione - ${label}`,
    });
  }
}

export async function createBooking(formData: FormData) {
  const returnTo = String(formData.get("returnTo") || "/prenotazioni").trim();
  const intent = String(formData.get("intent") || "save").trim();

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

  const customer_payment_status = String(
    formData.get("customer_payment_status") || "pending"
  ).trim();
  const supplier_payment_status = String(
    formData.get("supplier_payment_status") || "pending"
  ).trim();

  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);
  const notes = String(formData.get("notes") || "").trim();

  if (
    !channel_id ||
    !experience_id ||
    !experience_name ||
    !booking_date ||
    !customer_name ||
    !booking_created_at
  ) {
    return { error: "Compila tutti i campi obbligatori." };
  }

  const { data: experience, error: experienceError } = await supabase
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
    .eq("id", experience_id)
    .single();

  if (experienceError || !experience) {
    return { error: "Esperienza non trovata." };
  }

  const isGroupPricing = experience.is_group_pricing === true;

  const { data: channel } = await supabase
    .from("channels")
    .select("id, name")
    .eq("id", channel_id)
    .single();

  const { data: priceRowData } = await supabase
    .from("experience_channel_prices")
    .select("your_unit_price, public_unit_price")
    .eq("experience_id", experience_id)
    .eq("channel_id", channel_id)
    .single();

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
        experience_id,
        channel_id,
        your_unit_price,
        public_unit_price,
      });
    } else {
      return { error: "⚠️ Prezzo mancante. Inserisci i prezzi per procedere." };
    }
  }

  const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

  const total_to_you = isGroupPricing ? your_unit_price : your_unit_price * pricing_pax;
  const total_customer = isGroupPricing
    ? public_unit_price
    : public_unit_price * pricing_pax;
  const total_supplier_cost = isGroupPricing
    ? supplier_unit_cost
    : supplier_unit_cost * pricing_pax;
  const margin_total = total_to_you - total_supplier_cost;

  const { data: insertedBooking, error } = await supabase
    .from("bookings")
    .insert({
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
    })
    .select("id")
    .single();

  if (error) {
    if (
      error.code === "23505" ||
      error.message.includes("unique_booking_ref") ||
      error.message.includes("duplicate")
    ) {
      return {
        error: "⚠️ Attenzione: Questo Numero di Riferimento esiste già. Usa un codice diverso.",
      };
    }
    return { error: `Errore durante il salvataggio: ${error.message}` };
  }

  const initialPaidAmount = getEffectiveSupplierPaid({
    is_cancelled: false,
    supplier_payment_status,
    supplier_amount_paid,
    total_supplier_cost,
  });

  if (insertedBooking?.id && experience.supplier_id && initialPaidAmount > 0) {
    await insertSupplierPaymentMovement({
      supplier_id: Number(experience.supplier_id),
      amount: initialPaidAmount,
      payment_date: getTodayDate(),
      note: `Registrazione pagamento da Nuova Prenotazione - prenotazione #${insertedBooking.id}${
        booking_reference ? ` - ${booking_reference}` : ""
      }${customer_name ? ` - ${customer_name}` : ""}`,
    });
  }

  revalidatePath("/prenotazioni");
  revalidatePath("/prenotazioni/nuova");
  revalidatePath("/pagamenti");
  if (experience.supplier_id) {
    revalidatePath(`/pagamenti/${experience.supplier_id}`);
  }
  revalidatePath("/");

  const newBookingId = insertedBooking?.id;

  if (!newBookingId) {
    redirect(returnTo);
  }

  if (intent === "save_and_new") {
    redirect("/prenotazioni/nuova");
  }

  redirect(
    `/prenotazioni/${newBookingId}/modifica?returnTo=${encodeURIComponent(
      returnTo
    )}&justCreated=true`
  );
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

  const customer_payment_status = String(
    formData.get("customer_payment_status") || "pending"
  ).trim();
  const supplier_payment_status = String(
    formData.get("supplier_payment_status") || "pending"
  ).trim();
  const supplier_amount_paid = parseNumber(formData.get("supplier_amount_paid"), 0);
  const notes = normalizeText(formData.get("notes"));

  if (!id) return { error: "ID prenotazione non valido." };

  const { data: currentBooking, error: currentBookingError } = await supabase
    .from("bookings")
    .select(
      "id, supplier_id, booking_reference, customer_name, total_supplier_cost, supplier_payment_status, supplier_amount_paid, is_cancelled"
    )
    .eq("id", id)
    .single();

  if (currentBookingError || !currentBooking) {
    return { error: "Prenotazione non trovata." };
  }

  const { data: experience } = await supabase
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
    .eq("id", experience_id)
    .single();

  const isGroupPricing = experience?.is_group_pricing === true;

  const { data: channel } = await supabase
    .from("channels")
    .select("id, name")
    .eq("id", channel_id)
    .single();

  const { data: priceRow } = await supabase
    .from("experience_channel_prices")
    .select("your_unit_price, public_unit_price")
    .eq("experience_id", experience_id)
    .eq("channel_id", channel_id)
    .single();

  const your_unit_price = Number(priceRow?.your_unit_price || 0);
  const public_unit_price = Number(priceRow?.public_unit_price || 0);
  const supplier_unit_cost = Number(experience?.supplier_unit_cost || 0);

  const total_to_you = isGroupPricing ? your_unit_price : your_unit_price * pricing_pax;
  const total_customer = isGroupPricing
    ? public_unit_price
    : public_unit_price * pricing_pax;
  const total_supplier_cost = isGroupPricing
    ? supplier_unit_cost
    : supplier_unit_cost * pricing_pax;
  const margin_total = total_to_you - total_supplier_cost;

  const oldPaidAmount = getEffectiveSupplierPaid({
    is_cancelled: currentBooking.is_cancelled,
    supplier_payment_status: currentBooking.supplier_payment_status,
    supplier_amount_paid: currentBooking.supplier_amount_paid,
    total_supplier_cost: currentBooking.total_supplier_cost,
  });

  const newPaidAmount = getEffectiveSupplierPaid({
    is_cancelled: currentBooking.is_cancelled,
    supplier_payment_status,
    supplier_amount_paid,
    total_supplier_cost,
  });

  const oldSupplierId = Number(currentBooking.supplier_id || 0);
  const newSupplierId = Number(experience?.supplier_id || 0);

  const { error } = await supabase
    .from("bookings")
    .update({
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
    })
    .eq("id", id);

  if (error) {
    if (
      error.code === "23505" ||
      error.message.includes("unique_booking_ref") ||
      error.message.includes("duplicate")
    ) {
      return {
        error: "⚠️ Attenzione: Questo Numero di Riferimento è già usato da un'altra prenotazione.",
      };
    }
    return { error: `Errore durante la modifica: ${error.message}` };
  }

  await syncSupplierPaymentsFromBookingChange({
    bookingId: id,
    bookingReference: booking_reference || currentBooking.booking_reference || null,
    customerName: customer_name || currentBooking.customer_name || null,
    oldSupplierId,
    newSupplierId,
    oldPaidAmount,
    newPaidAmount,
    paymentDate: getTodayDate(),
  });

  revalidatePath("/prenotazioni");
  revalidatePath(`/prenotazioni/${id}/modifica`);
  revalidatePath("/pagamenti");
  if (oldSupplierId) {
    revalidatePath(`/pagamenti/${oldSupplierId}`);
  }
  if (newSupplierId && newSupplierId !== oldSupplierId) {
    revalidatePath(`/pagamenti/${newSupplierId}`);
  } else if (newSupplierId) {
    revalidatePath(`/pagamenti/${newSupplierId}`);
  }

  redirect(returnTo);
}

export async function cancelBooking(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const { error } = await supabase
    .from("bookings")
    .update({
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id);

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