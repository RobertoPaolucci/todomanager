import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// IL TUO CODICE SEGRETO PER IL WEBHOOK
const WEBHOOK_SECRET = "TuscanyTours-Webhook-Secret-2026";

export async function POST(req: Request) {
  try {
    // 1. CONTROLLO DI SICUREZZA
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json(
        { error: "Accesso negato. Token mancante o non valido." },
        { status: 401 }
      );
    }

    // 2. RICEZIONE DATI
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
      status, // Ricevuto da Make.com (CONFIRMED o CANCELLED)
    } = body;

    // --- LOGICA CANCELLAZIONE ---
    // Se lo status è CANCELLED, aggiorniamo solo la riga esistente
    if (status === "CANCELLED" && booking_reference) {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ 
          is_cancelled: true,
          customer_payment_status: "cancelled",
          notes: "Cancellata automaticamente tramite Bokun/Make" 
        })
        .eq("booking_reference", booking_reference);

      if (updateError) {
        throw new Error(`Errore durante la cancellazione: ${updateError.message}`);
      }

      return NextResponse.json({ 
        success: true, 
        message: "Prenotazione segnata come cancellata con successo!" 
      });
    }

    // --- LOGICA CREAZIONE ---
    // Controlli di base sui dati obbligatori per la creazione
    if (!channel_id || !experience_id || !booking_date || !customer_name) {
      return NextResponse.json(
        { error: "Dati obbligatori mancanti nel payload (channel, experience, date o name)." },
        { status: 400 }
      );
    }

    const total_people = adults + children + infants;
    const pricing_pax = adults + children;

    if (total_people <= 0) {
      return NextResponse.json(
        { error: "Il numero di partecipanti deve essere maggiore di 0." },
        { status: 400 }
      );
    }

    // 4. RECUPERO DATI ESPERIENZA DAL DB
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("id", experience_id)
      .single();

    if (expError || !experience) {
      return NextResponse.json({ error: "Esperienza non trovata nel DB." }, { status: 404 });
    }

    // RECUPERO DATI CANALE
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name")
      .eq("id", channel_id)
      .single();

    if (channelError || !channel) {
      return NextResponse.json({ error: "Canale non trovato nel DB." }, { status: 404 });
    }

    // RECUPERO PREZZI CONFIGURATI
    const { data: priceRow } = await supabase
      .from("experience_channel_prices")
      .select("your_unit_price, public_unit_price")
      .eq("experience_id", experience_id)
      .eq("channel_id", channel_id)
      .single();

    const your_unit_price = Number(priceRow?.your_unit_price || 0);
    const public_unit_price = Number(priceRow?.public_unit_price || 0);
    const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);

    // 5. CALCOLO MARGINI
    const isGroupPricing = experience.is_group_pricing === true;
    const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
    const total_customer = total_amount > 0 ? total_amount : (isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax));
    const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);
    const margin_total = total_to_you - total_supplier_cost;

    // 6. SALVATAGGIO NEL DATABASE (Tabella bookings)
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
        name: experience.name, // Colonna "name" della tabella bookings
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

    return NextResponse.json(
      { 
        success: true, 
        message: "Operazione completata con successo!",
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