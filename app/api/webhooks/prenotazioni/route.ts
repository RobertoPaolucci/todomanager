import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// IL TUO CODICE SEGRETO PER IL WEBHOOK
// Sostituiscilo con una password complessa a tua scelta
const WEBHOOK_SECRET = "TuscanyTours-Webhook-Secret-2026";

export async function POST(req: Request) {
  try {
    // 1. CONTROLLO DI SICUREZZA
    // Verifichiamo che chi bussa alla porta abbia la password corretta
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json(
        { error: "Accesso negato. Token mancante o non valido." },
        { status: 401 }
      );
    }

    // 2. RICEZIONE DATI
    // Leggiamo il pacchetto JSON inviato da Bokun o Make.com
    const body = await req.json();

    const {
      channel_id,
      experience_id,
      booking_reference,
      customer_name,
      customer_email,
      customer_phone,
      booking_date,
      booking_time,
      adults = 0,
      children = 0,
      infants = 0,
      total_amount = 0,
      notes = "Importata tramite Webhook",
    } = body;

    // Controlli di base sui dati obbligatori
    if (!channel_id || !experience_id || !booking_date || !customer_name) {
      return NextResponse.json(
        { error: "Dati obbligatori mancanti nel payload." },
        { status: 400 }
      );
    }

    // 3. LOGICA PAX
    const total_people = adults + children + infants;
    const pricing_pax = adults + children;

    if (total_people <= 0) {
      return NextResponse.json(
        { error: "Il numero di partecipanti deve essere maggiore di 0." },
        { status: 400 }
      );
    }

    // 4. RECUPERO DATI ESPERIENZA E PREZZI DAL DB
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("id", experience_id)
      .single();

    if (expError || !experience) {
      return NextResponse.json({ error: "Esperienza non trovata nel DB." }, { status: 404 });
    }

    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name")
      .eq("id", channel_id)
      .single();

    if (channelError || !channel) {
      return NextResponse.json({ error: "Canale non trovato nel DB." }, { status: 404 });
    }

    const { data: priceRow } = await supabase
      .from("experience_channel_prices")
      .select("your_unit_price, public_unit_price")
      .eq("experience_id", experience_id)
      .eq("channel_id", channel_id)
      .single();

    // Se non abbiamo i prezzi configurati, usiamo 0 (potrai sistemarli in dashboard)
    const your_unit_price = Number(priceRow?.your_unit_price || 0);
    const public_unit_price = Number(priceRow?.public_unit_price || 0);
    const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

    // 5. IL CERVELLO MATEMATICO (Esattamente come nel modulo di modifica)
    const isGroupPricing = experience.is_group_pricing === true;

    const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
    // Se il webhook ci manda un total_amount maggiore di 0 usiamo quello, altrimenti lo calcoliamo
    const total_customer = total_amount > 0 ? total_amount : (isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax));
    const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);
    const margin_total = total_to_you - total_supplier_cost;

    // 6. SALVATAGGIO NEL DATABASE
    // La data di inserimento è oggi
    const booking_created_at = new Date().toISOString().split("T")[0];

    const { data: insertedBooking, error: insertError } = await supabase
      .from("bookings")
      .insert({
        channel_id,
        booking_source: channel.name,
        experience_id,
        supplier_id: experience.supplier_id,
        booking_reference: booking_reference || null,
        booking_created_at,
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        experience_name: experience.name,
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
        customer_payment_status: "pending",
        supplier_payment_status: "pending",
        supplier_amount_paid: 0,
        notes,
        is_cancelled: false,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    // 7. RISPOSTA DI SUCCESSO
    return NextResponse.json(
      { 
        success: true, 
        message: "Prenotazione importata con successo!",
        booking_id: insertedBooking.id
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error("Errore Webhook:", error);
    return NextResponse.json(
      { error: "Errore interno del server", details: error.message },
      { status: 500 }
    );
  }
}