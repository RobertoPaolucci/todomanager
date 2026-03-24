import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

function stripSystemAlert(notes: string) {
  return notes
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("🟢") && !t.startsWith("🟡") && !t.startsWith("🔴");
    })
    .join("\n")
    .trim();
}

function buildSystemAlert(type: "new" | "modified" | "cancelled") {
  if (type === "cancelled") return "🔴 Prenotazione cancellata";
  if (type === "modified") return "🟡 Prenotazione modificata";
  return "🟢 Nuova prenotazione";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== "Bearer TuscanyTours-Webhook-Secret-2026") {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    }

    const body = await req.json();

    const rawBokunId = String(body.bokun_id || "").trim();
    const bookingReference = String(body.booking_reference || "").trim();

    const { data: experience, error: experienceError } = await supabase
      .from("experiences")
      .select("id, name, supplier_id, is_group_pricing, supplier_unit_cost")
      .eq("bokun_id", rawBokunId)
      .single();

    if (experienceError || !experience) {
      return NextResponse.json({ error: "Esperienza non trovata" }, { status: 404 });
    }

    const isCancelled =
      String(body.status || "").toUpperCase() === "CANCELLED";

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
      infants: Number(body.infants || 0),
      total_people:
        Number(body.adults || 0) +
        Number(body.children || 0) +
        Number(body.infants || 0),
      is_cancelled: isCancelled,
      booking_source: String(body.booking_source || "Bokun").trim(),
    };

    const { data: existing, error: existingError } = await supabase
      .from("bookings")
      .select("id, notes")
      .eq("booking_reference", bookingReference)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const previousNotes = String(existing?.notes || body.notes || "").trim();
    const cleanNotes = stripSystemAlert(previousNotes);

    let alertType: "new" | "modified" | "cancelled" = "new";

    if (isCancelled) {
      alertType = "cancelled";
    } else if (existing) {
      alertType = "modified";
    }

    const systemAlert = buildSystemAlert(alertType);
    const finalNotes = cleanNotes ? `${systemAlert}\n${cleanNotes}` : systemAlert;

    if (existing) {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          ...bookingData,
          notes: finalNotes,
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase
        .from("bookings")
        .insert({
          ...bookingData,
          booking_reference: bookingReference,
          booking_created_at: new Date().toISOString().split("T")[0],
          notes: finalNotes,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    revalidatePath("/");
    revalidatePath("/prenotazioni");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Errore webhook prenotazioni:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}