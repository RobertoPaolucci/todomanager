import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const WEBHOOK_SECRET = "TuscanyTours-Webhook-Secret-2026";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 401 });
    }

    const body = await req.json();
    
    // Ora catturiamo bokun_id al posto di experience_id, più status e action dinamici
    const { booking_reference, status, action, bokun_id } = body;

    // --- 1. LOGICA CANCELLAZIONE (Semaforo Rosso) ---
    if (status === "CANCELLED" && booking_reference) {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ 
          is_cancelled: true,
          customer_payment_status: "cancelled",
          notes: "🔴 CANCELLATA" 
        })
        .eq("booking_reference", booking_reference);

      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ success: true, message: "Prenotazione cancellata!" });
    }

    // --- 2. LOGICA CREAZIONE O AGGIORNAMENTO ---
    const {
      channel_id,
      customer_name,
      customer_email,
      customer_phone,
      booking_date,
      booking_time,
      adults = 0,
      children = 0,
      infants = 0,
      total_amount = 0,
    } = body;

    // Se manca bokun_id blocchiamo tutto
    if (!channel_id || !bokun_id || !booking_date || !customer_name) {
      return NextResponse.json({ error: "Dati obbligatori mancanti (Bokun ID, Canale, Data o Nome)" }, { status: 400 });
    }

    // IL PONTE: Cerchiamo l'esperienza tramite il bokun_id
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("bokun_id", String(bokun_id))
      .single();

    if (expError || !experience) {
      return NextResponse.json({ error: `Esperienza non trovata per Bokun ID: ${bokun_id}` }, { status: 404 });
    }

    // Da qui in poi, usiamo l'ID interno del tuo Todo Manager
    const experience_id = experience.id;

    const { data: channel } = await supabase.from("channels").select("name").eq("id", channel_id).single();
    
    const { data: priceRow } = await supabase
      .from("experience_channel_prices")
      .select("your_unit_price, public_unit_price")
      .eq("experience_id", experience_id)
      .eq("channel_id", channel_id)
      .single();

    const pricing_pax = adults + children;
    const your_unit_price = Number(priceRow?.your_unit_price || 0);
    const public_unit_price = Number(priceRow?.public_unit_price || 0);
    const supplier_unit_cost = Number(experience.supplier_unit_cost || 0);
    const isGroupPricing = experience.is_group_pricing === true;

    const total_to_you = isGroupPricing ? your_unit_price : (your_unit_price * pricing_pax);
    const total_customer = total_amount > 0 ? total_amount : (isGroupPricing ? public_unit_price : (public_unit_price * pricing_pax));
    const total_supplier_cost = isGroupPricing ? supplier_unit_cost : (supplier_unit_cost * pricing_pax);

    const bookingData = {
      channel_id,
      booking_source: channel?.name || "Bokun",
      experience_id, // Usiamo l'ID interno mappato!
      supplier_id: experience.supplier_id,
      booking_reference,
      customer_name,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      experience_name: experience.name, 
      booking_date,
      booking_time,
      adults,
      children,
      infants,
      total_people: adults + children + infants,
      pax: adults + children + infants,
      total_to_you,
      total_customer,
      total_supplier_cost,
      margin_total: total_to_you - total_supplier_cost,
    };

    // --- MODIFICA (Semaforo Giallo) ---
    if (action === "BOOKING_UPDATED" && booking_reference) {
       const { error: updateError } = await supabase
        .from("bookings")
        .update({
            ...bookingData,
            notes: "🟡 MODIFICATA (Controllare dettagli)"
        })
        .eq("booking_reference", booking_reference);

      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ success: true, message: "Prenotazione aggiornata!" });
    }

    // --- CREAZIONE (Semaforo Verde) ---
    const { error: insertError } = await supabase.from("bookings").insert({
      ...bookingData,
      booking_created_at: new Date().toISOString().split("T")[0],
      customer_payment_status: "pending",
      supplier_payment_status: "pending",
      supplier_amount_paid: 0,
      is_cancelled: false,
      notes: "🟢 NUOVA PRENOTAZIONE"
    });

    if (insertError) throw new Error(insertError.message);
    return NextResponse.json({ success: true, message: "Prenotazione creata!" }, { status: 201 });

  } catch (error: any) {
    console.error("Errore Webhook:", error);
    return NextResponse.json({ error: "Errore interno", details: error.message }, { status: 500 });
  }
}