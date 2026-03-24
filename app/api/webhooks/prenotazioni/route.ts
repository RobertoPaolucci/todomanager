import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    // 1. Controllo di Sicurezza (Token)
    const authHeader = req.headers.get("authorization");
    if (authHeader !== "Bearer TuscanyTours-Webhook-Secret-2026") {
      return NextResponse.json({ error: "Accesso Negato: Token non valido" }, { status: 401 });
    }

    const body = await req.json();

    // 2. Estrazione dati in totale sicurezza (con paracadute per i campi vuoti)
    const action = String(body.action || "").toUpperCase();
    const status = String(body.status || "").toUpperCase();
    const booking_reference = String(body.booking_reference || "").trim();
    const bokun_id = String(body.bokun_id || "").trim();
    const channel_id = Number(body.channel_id || 0);

    if (!booking_reference) {
      return NextResponse.json({ error: "booking_reference mancante" }, { status: 400 });
    }

    // 3. Cerchiamo l'Esperienza tramite il bokun_id
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("bokun_id", bokun_id)
      .single();

    if (expError || !experience) {
      return NextResponse.json({ 
        error: `Esperienza non trovata per bokun_id: ${bokun_id}. Assicurati di aver inserito questo ID nella tabella experiences in Supabase.` 
      }, { status: 404 });
    }

    const experience_id = experience.id;
    const isGroupPricing = experience.is_group_pricing === true;

    // 4. Cerchiamo il Canale
    const { data: channel } = await supabase
      .from("channels")
      .select("id, name")
      .eq("id", channel_id)
      .single();

    // 5. Estraiamo il listino prezzi per questa coppia (Canale + Esperienza)
    const { data: priceRow } = await supabase
      .from("experience_channel_prices")
      .select("your_unit_price, public_unit_price")
      .eq("experience_id", experience_id)
      .eq("channel_id", channel_id)
      .single();

    // 6. Calcolo della Matematica (Pax e Margini)
    const adults = Number(body.adults || 0);
    const children = Number(body.children || 0);
    const infants = Number(body.infants || 0);
    const total_people = adults + children + infants;
    const pricing_pax = adults + children; // Gli infanti non pagano

    const your_unit_price = Number(priceRow?.your_unit_price || 0);
    const public_unit_price = Number(priceRow?.public_unit_price || 0);
    const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

    const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
    const total_customer = isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax);
    const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);
    const margin_total = total_to_you - total_supplier_cost;

    // Gestione Cancellazioni (Se Bokun o Viator annullano)
    const is_cancelled = status === "CANCELLED" || status === "REJECTED" || action === "BOOKING_CANCELLED";

    // 7. Prepariamo il pacchetto dati pulito
    const bookingData = {
      channel_id,
      booking_source: channel?.name || "Webhook/API",
      experience_id,
      supplier_id: experience.supplier_id,
      experience_name: experience.name,
      customer_name: String(body.customer_name || "").trim(),
      customer_email: String(body.customer_email || "").trim(),
      customer_phone: String(body.customer_phone || "").trim(),
      booking_date: String(body.booking_date || "").trim(),
      booking_time: String(body.booking_time || "").trim(),
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
      is_cancelled,
      cancelled_at: is_cancelled ? new Date().toISOString() : null,
    };

    // 8. LOGICA INTELLIGENTE: Inserimento o Aggiornamento?
    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id")
      .eq("booking_reference", booking_reference)
      .single();

    if (existingBooking) {
      // ESISTE: Facciamo un Update, MA non tocchiamo i pagamenti per non cancellare la contabilità!
      const { error: updateError } = await supabase
        .from("bookings")
        .update(bookingData)
        .eq("id", existingBooking.id);

      if (updateError) throw updateError;
    } else {
      // NON ESISTE: La creiamo da zero aggiungendo i campi di default
      const { error: insertError } = await supabase
        .from("bookings")
        .insert({
          ...bookingData,
          booking_reference,
          booking_created_at: new Date().toISOString().split("T")[0],
          customer_payment_status: "pending",
          supplier_payment_status: "pending",
          supplier_amount_paid: 0,
        });

      if (insertError) throw insertError;
    }

    return NextResponse.json({ success: true, message: "Webhook elaborato con successo" }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ error: "Errore fatale del Webhook", details: error.message }, { status: 500 });
  }
}