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

function detectChannelIdFromText(value: string) {
  const t = String(value || "").trim().toLowerCase();

  if (!t) return null;

  if (t.includes("getyourguide") || t.includes("gyg")) return 3;
  if (t.includes("viator") || t.includes("via")) return 2;
  if (t.includes("freedome")) return 5;
  if (
    t.includes("fattoria madonna della querce") ||
    t.includes("madonna della querce")
  ) {
    return 6;
  }
  if (t.includes("todointheworld") || t.includes("todo in the world")) return 4;
  if (t.includes("direct") || t.includes("website") || t.includes("web")) return 1;

  return null;
}

function resolveChannel(body: any, bookingReference: string) {
  const ref = String(bookingReference || "").trim().toUpperCase();

  if (ref.startsWith("GYG")) {
    return {
      channelId: 3,
      bookingSource: "GetYourGuide",
    };
  }

  if (ref.startsWith("VIA")) {
    return {
      channelId: 2,
      bookingSource: "Viator",
    };
  }

  if (ref.startsWith("TOD")) {
    return {
      channelId: 4,
      bookingSource: "Todointheworld",
    };
  }

  const rawChannelId = Number(body.channel_id);

  const sourceCandidates = [
    body.booking_source,
    body.channel_name,
    body.seller,
    body.seller_name,
    body.source,
    body.origin,
    body.vendor,
    body.channel,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  if (Number.isFinite(rawChannelId) && rawChannelId > 0) {
    return {
      channelId: rawChannelId,
      bookingSource:
        String(body.booking_source || "").trim() ||
        getBookingSourceFromChannelId(rawChannelId),
    };
  }

  for (const candidate of sourceCandidates) {
    const detected = detectChannelIdFromText(candidate);
    if (detected) {
      return {
        channelId: detected,
        bookingSource: getBookingSourceFromChannelId(detected),
      };
    }
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== "Bearer TuscanyTours-Webhook-Secret-2026") {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    }

    const body = await req.json();

    console.log("WEBHOOK PRENOTAZIONE BODY:", JSON.stringify(body, null, 2));

    const rawBokunId = String(body.bokun_id || "").trim();
    const bookingReference = String(body.booking_reference || "").trim();

    if (!rawBokunId) {
      return NextResponse.json({ error: "bokun_id mancante" }, { status: 400 });
    }

    if (!bookingReference) {
      return NextResponse.json(
        { error: "booking_reference mancante" },
        { status: 400 }
      );
    }

    const resolvedChannel = resolveChannel(body, bookingReference);

    if (!resolvedChannel) {
      console.error(
        "Canale non riconosciuto. Payload:",
        JSON.stringify(body, null, 2)
      );
      return NextResponse.json(
        { error: "Canale non riconosciuto: prenotazione non salvata" },
        { status: 400 }
      );
    }

    const channelId = resolvedChannel.channelId;
    const bookingSource = resolvedChannel.bookingSource;

    const { data: experience, error: experienceError } = await supabaseServer
      .from("experiences")
      .select(
        "id, name, supplier_id, is_group_pricing, supplier_unit_cost, business_unit_id"
      )
      .eq("bokun_id", rawBokunId)
      .single();

    if (experienceError || !experience) {
      return NextResponse.json({ error: "Esperienza non trovata" }, { status: 404 });
    }

    if (!experience.business_unit_id) {
      return NextResponse.json(
        { error: "Esperienza senza business_unit_id" },
        { status: 500 }
      );
    }

    const isCancelled = String(body.status || "").toUpperCase() === "CANCELLED";

    const adults = Number(body.adults || 0);
    const children = Number(body.children || 0);
    const infants = Number(body.infants || 0);

    const bookingData = {
      channel_id: channelId,
      booking_source: bookingSource,

      experience_id: experience.id,
      experience_name: experience.name,
      supplier_id: experience.supplier_id,
      business_unit_id: Number(experience.business_unit_id),

      customer_name: String(body.customer_name || "").trim(),
      customer_email: String(body.customer_email || "").trim() || null,
      customer_phone: String(body.customer_phone || "").trim() || null,

      booking_date: String(body.booking_date || "").trim(),
      booking_time: String(body.booking_time || "").trim() || null,

      adults,
      children,
      infants,
      total_people: adults + children + infants,

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
      const nextWasModified = isCancelled ? Boolean(existing.was_modified) : true;

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

    return NextResponse.json({
      success: true,
      channel_id: channelId,
      booking_source: bookingSource,
      business_unit_id: bookingData.business_unit_id,
    });
  } catch (error: any) {
    console.error("Errore webhook prenotazioni:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}