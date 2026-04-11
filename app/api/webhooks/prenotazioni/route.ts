import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

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

function getBookingSourceFromChannelId(channelId: number) {
  switch (channelId) {
    case 2:
      return "Viator";
    case 3:
      return "GetYourGuide";
    case 4:
      return "Todointheworld";
    case 5:
      return "Freedome";
    case 6:
      return "Fattoria Madonna della Querce";
    case 1:
    default:
      return "Direct";
  }
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
    const channelId = Number(body.channel_id || 1);

    const { data: experience, error: experienceError } = await supabaseServer
      .from("experiences")
      .select("id, name, supplier_id, is_group_pricing, supplier_unit_cost")
      .eq("bokun_id", rawBokunId)
      .single();

    if (experienceError || !experience) {
      return NextResponse.json({ error: "Esperienza non trovata" }, { status: 404 });
    }

    const isCancelled =
      String(body.status || "").toUpperCase() === "CANCELLED";

    const bookingSource = String(
      body.booking_source || getBookingSourceFromChannelId(channelId)
    ).trim();

    const bookingData = {
      channel_id: channelId,
      booking_source: bookingSource,

      experience_id: experience.id,
      experience_name: experience.name,
      supplier_id: experience.supplier_id, // FIX PRINCIPALE

      customer_name: String(body.customer_name || "").trim(),
      customer_email: String(body.customer_email || "").trim() || null,
      customer_phone: String(body.customer_phone || "").trim() || null,

      booking_date: String(body.booking_date || ""),
      booking_time: String(body.booking_time || "") || null,

      adults: Number(body.adults || 0),
      children: Number(body.children || 0),
      infants: Number(body.infants || 0),
      total_people:
        Number(body.adults || 0) +
        Number(body.children || 0) +
        Number(body.infants || 0),

      is_cancelled: isCancelled,
    };

    const { data: existing, error: existingError } = await supabaseServer
      .from("bookings")
      .select("id, notes, was_modified")
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
      const nextWasModified = isCancelled
        ? Boolean(existing.was_modified)
        : true;

      const { error: updateError } = await supabaseServer
        .from("bookings")
        .update({
          ...bookingData,
          notes: finalNotes,
          was_modified: nextWasModified,
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(updateError.message);
      }
    } else {
      const { error: insertError } = await supabaseServer
        .from("bookings")
        .insert({
          ...bookingData,
          booking_reference: bookingReference,
          booking_created_at: new Date().toISOString().split("T")[0],
          notes: finalNotes,
          was_modified: false,
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