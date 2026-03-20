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
    const { booking_reference, status } = body;

    // --- 1. LOGICA CANCELLAZIONE ---
    if (status === "CANCELLED" && booking_reference) {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ 
          is_cancelled: true,
          customer_payment_status: "cancelled",
          notes: "Cancellata automaticamente tramite Bokun/Make" 
        })
        .eq("booking_reference", booking_reference);

      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ success: true, message: "Prenotazione cancellata!" });
    }

    // --- 2. LOGICA CREAZIONE ---
    const {
      channel_id,
      experience_id,
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

    if (!channel_id || !experience_id || !booking_date || !customer_name) {
      return NextResponse.json({ error: "Dati obbligatori mancanti" }, { status: 400 });
    }

    // Recupero dati esperienza dalla tabella 'experiences' (dove la colonna è 'name')
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("id", experience_id)
      .single();

    if (expError || !experience) return NextResponse.json({ error: "Esperienza non trovata" }, { status: 404 });

    // Recupero dati canale
    const { data: channel } = await supabase.from("channels").select("name").eq("id", channel_id).single();
    
    // Recupero prezzi
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

    // SALVATAGGIO NELLA TABELLA 'bookings'
    const { error: insertError } = await supabase.from("bookings").insert({
      channel_id,
      booking_source: channel?.name || "Bokun",
      experience_id,
      supplier_id: experience.supplier_id,
      booking_reference,
      booking_created_at: new Date().toISOString().split("T")[0],
      customer_name,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      // CORREZIONE DEFINITIVA: 
      // La colonna nel DB si chiama 'experience_name'
      // Il valore lo prendiamo da 'experience.name'
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
      customer_payment_status: "pending",
      supplier_payment_status: "pending",
      supplier_amount_paid: 0,
      is_cancelled: false,
      notes
    });

    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({ success: true, message: "Prenotazione creata!" }, { status: 201 });

  } catch (error: any) {
    console.error("Errore Webhook:", error);
    return NextResponse.json({ error: "Errore interno", details: error.message }, { status: 500 });
  }
}