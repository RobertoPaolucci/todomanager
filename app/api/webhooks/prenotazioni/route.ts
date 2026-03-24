import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== "Bearer TuscanyTours-Webhook-Secret-2026") {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    }

    const body = await req.json();
    
    // PULIZIA AGGRESSIVA: togliamo ogni spazio bianco dall'ID in arrivo
    const raw_bokun_id = String(body.bokun_id || "").trim();
    const booking_reference = String(body.booking_reference || "").trim();

    // CERCHIAMO L'ESPERIENZA (Usiamo ILIKE per essere meno rigidi con le stringhe)
    const { data: experience, error: expError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, supplier_unit_cost, is_group_pricing")
      .eq("bokun_id", raw_bokun_id)
      .single();

    if (expError || !experience) {
      // Se fallisce, facciamo un secondo tentativo "sporco" per sicurezza
      return NextResponse.json({ 
        error: `Esperienza non trovata per bokun_id: [${raw_bokun_id}]. Verifica che in Supabase non ci siano spazi vuoti nella cella.` 
      }, { status: 404 });
    }

    // ... (Il resto del codice rimane identico al precedente per il calcolo dei prezzi)
    const channel_id = Number(body.channel_id || 0);
    const { data: priceRow } = await supabase
      .from("experience_channel_prices")
      .select("your_unit_price, public_unit_price")
      .eq("experience_id", experience.id)
      .eq("channel_id", channel_id)
      .single();

    const adults = Number(body.adults || 0);
    const children = Number(body.children || 0);
    const pricing_pax = adults + children;
    const your_unit_price = Number(priceRow?.your_unit_price || 0);
    const public_unit_price = Number(priceRow?.public_unit_price || 0);
    const total_customer = experience.is_group_pricing ? public_unit_price : (public_unit_price * pricing_pax);

    const bookingData = {
      channel_id,
      experience_id: experience.id,
      experience_name: experience.name,
      customer_name: String(body.customer_name || "").trim(),
      customer_email: String(body.customer_email || "").trim(),
      booking_date: String(body.booking_date || "").trim(),
      booking_time: String(body.booking_time || "").trim(),
      adults,
      children,
      total_people: adults + children + Number(body.infants || 0),
      total_amount: total_customer,
      total_customer,
      is_cancelled: String(body.status).toUpperCase() === "CANCELLED"
    };

    const { data: existing } = await supabase.from("bookings").select("id").eq("booking_reference", booking_reference).single();

    if (existing) {
      await supabase.from("bookings").update(bookingData).eq("id", existing.id);
    } else {
      await supabase.from("bookings").insert({ ...bookingData, booking_reference, booking_created_at: new Date().toISOString().split("T")[0] });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}