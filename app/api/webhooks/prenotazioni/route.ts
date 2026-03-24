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
    
    // 1. Pulizia dei codici per evitare errori di "esperienza non trovata"
    const raw_bokun_id = String(body.bokun_id || "").trim();
    const booking_reference = String(body.booking_reference || "").trim();

    // 2. Cerchiamo l'esperienza
    const { data: experience } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, is_group_pricing, supplier_unit_cost")
      .eq("bokun_id", raw_bokun_id)
      .single();

    if (!experience) {
      return NextResponse.json({ error: "Esperienza non trovata" }, { status: 404 });
    }

    // 3. Prepariamo i dati minimi necessari (esattamente come prima)
    const bookingData = {
      channel_id: Number(body.channel_id),
      experience_id: experience.id,
      experience_name: experience.name,
      customer_name: String(body.customer_name || "").trim(),
      customer_email: String(body.customer_email || "").trim(),
      booking_date: String(body.booking_date || ""),
      booking_time: String(body.booking_time || ""),
      adults: Number(body.adults || 0),
      children: Number(body.children || 0),
      total_people: Number(body.adults || 0) + Number(body.children || 0) + Number(body.infants || 0),
      is_cancelled: String(body.status).toUpperCase() === "CANCELLED"
    };

    // 4. Cerchiamo se esiste già
    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .eq("booking_reference", booking_reference)
      .single();

    if (existing) {
      // MODIFICA (Dovrebbe far scattare il GIALLO)
      await supabase.from("bookings").update(bookingData).eq("id", existing.id);
    } else {
      // NUOVA (Dovrebbe far scattare il VERDE)
      await supabase.from("bookings").insert({ 
        ...bookingData, 
        booking_reference, 
        booking_created_at: new Date().toISOString().split("T")[0] 
      });
    }

    // 5. IL SEGNALE PER LA DASHBOARD
    // Questi due comandi "svegliano" la pagina e le notifiche
    revalidatePath("/");
    revalidatePath("/prenotazioni");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Errore:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}