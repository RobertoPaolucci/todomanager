import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type ChannelRow = {
  id: number;
  name: string;
  type: string | null;
};

type WebhookPayload = {
  secret?: string;
  event_id?: string;
  id?: string;
  uid?: string;
  status?: string;
  title?: string;
  summary?: string;
  description?: string;
  start?: any;
  start_date?: string;
  startDate?: string;
  start_datetime?: string;
  startDateTime?: string;
  end?: any;
  updated?: string;
  htmlLink?: string;
  calendar_id?: string;
  calendarId?: string;
  all_day?: boolean;
  allDay?: boolean;
};

const EXPERIENCE_IDS = {
  COOKING_CLASS: 5,
  PRANZO: 7,
  CAVALLO: 8,
  CENA: 10,
  QUAD_3_ORE: 11,
  QUAD_1_ORA: 14,
  E_BIKE: 15,
  TAGLIERE: 16,
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalize(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSpaces(value?: string | null) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeForReference(value: string) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = normalize(String(value ?? ""));
  return text === "true" || text === "1" || text === "yes";
}

function getEventId(payload: WebhookPayload) {
  return cleanSpaces(payload.event_id || payload.id || payload.uid || "");
}

function getTitle(payload: WebhookPayload) {
  return cleanSpaces(payload.title || payload.summary || "");
}

function getStatus(payload: WebhookPayload) {
  return normalize(payload.status || "confirmed");
}

function getStartValue(payload: WebhookPayload) {
  if (typeof payload.start_datetime === "string") return payload.start_datetime;
  if (typeof payload.startDateTime === "string") return payload.startDateTime;
  if (typeof payload.start === "string") return payload.start;

  if (payload.start && typeof payload.start === "object") {
    if (typeof payload.start.dateTime === "string") return payload.start.dateTime;
    if (typeof payload.start.datetime === "string") return payload.start.datetime;
    if (typeof payload.start.date === "string") return payload.start.date;
  }

  if (typeof payload.start_date === "string") return payload.start_date;
  if (typeof payload.startDate === "string") return payload.startDate;

  return "";
}

function parseStart(payload: WebhookPayload) {
  const raw = cleanSpaces(getStartValue(payload));
  const explicitAllDay =
    parseBoolean(payload.all_day) || parseBoolean(payload.allDay);

  if (!raw) {
    return {
      isValid: false,
      isAllDay: false,
      bookingDate: "",
      bookingTime: "",
    };
  }

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const hasTime = raw.includes("T");

  if (explicitAllDay || isDateOnly || !hasTime) {
    return {
      isValid: true,
      isAllDay: true,
      bookingDate: raw.slice(0, 10),
      bookingTime: "",
    };
  }

  return {
    isValid: true,
    isAllDay: false,
    bookingDate: raw.slice(0, 10),
    bookingTime: raw.split("T")[1]?.slice(0, 5) || "",
  };
}

function parsePeople(title: string) {
  const text = cleanSpaces(title);

  const match = text.match(
    /^\s*(\d+)(?:\s*\+\s*(\d+)(?:\s*(bambin[aoie]*|child|children|neonat[oi]?|infant[is]?|guida|guide|driver|autista))?)?/i
  );

  if (!match) {
    return null;
  }

  const adults = Math.max(0, Number(match[1] || 0));
  const plusNumber = Math.max(0, Number(match[2] || 0));
  const plusLabel = normalize(match[3] || "");

  let children = 0;
  let infants = 0;

  if (plusNumber > 0) {
    if (plusLabel.includes("neonat") || plusLabel.includes("infant")) {
      infants = plusNumber;
    } else if (
      plusLabel.includes("guida") ||
      plusLabel.includes("guide") ||
      plusLabel.includes("driver") ||
      plusLabel.includes("autista")
    ) {
      children = 0;
    } else {
      children = plusNumber;
    }
  }

  return {
    adults,
    children,
    infants,
  };
}

function detectExperienceId(title: string) {
  const text = normalize(title);

  if (text.includes("cooking class") || text.includes("cooking")) {
    return EXPERIENCE_IDS.COOKING_CLASS;
  }

  if (text.includes("cena")) {
    return EXPERIENCE_IDS.CENA;
  }

  if (
    text.includes("cavallo") ||
    text.includes("cavalli") ||
    text.includes("horse")
  ) {
    return EXPERIENCE_IDS.CAVALLO;
  }

  if (text.includes("quad")) {
    if (
      text.includes("1 ora") ||
      text.includes("1h") ||
      text.includes("1 h") ||
      text.includes("quad 1")
    ) {
      return EXPERIENCE_IDS.QUAD_1_ORA;
    }

    return EXPERIENCE_IDS.QUAD_3_ORE;
  }

  if (
    text.includes("e-bike") ||
    text.includes("ebike") ||
    text.includes("e bike") ||
    text.includes("bike")
  ) {
    return EXPERIENCE_IDS.E_BIKE;
  }

  if (
    text.includes("tagliere") ||
    text.includes("bruschette") ||
    text.includes("italy on a budget") ||
    text.includes("italy budget tour")
  ) {
    return EXPERIENCE_IDS.TAGLIERE;
  }

  if (
    text.includes("pranzo") ||
    text.includes("curioseety") ||
    text.includes("viator") ||
    text.includes("airbnb")
  ) {
    return EXPERIENCE_IDS.PRANZO;
  }

  if (/^\s*\d+/.test(text)) {
    return EXPERIENCE_IDS.PRANZO;
  }

  return null;
}

function detectChannelLabel(title: string) {
  const text = normalize(title);

  if (text.includes("curioseety")) return "Curioseety";

  if (
    text.includes("italy on a budget") ||
    text.includes("italy budget tour") ||
    text.includes("italy on a budget tours")
  ) {
    return "Italy on a Budget Tours";
  }

  if (text.includes("tuscan escape")) return "Tuscan Escape";
  if (text.includes("sireontours")) return "Sireontours";
  if (text.includes("moscadella")) return "La Moscadella";
  if (text.includes("villa poggiano")) return "Villa Poggiano";
  if (text.includes("cesarine")) return "Cesarine";
  if (text.includes("anastasiya")) return "Anastasiya";
  if (text.includes("evolution travel")) return "Evolution Travel";
  if (text.includes("san bartolomeo")) return "San Bartolomeo";
  if (text.includes("umbriaction")) return "Umbriaction";
  if (text.includes("b-italian") || text.includes("b italian")) return "B-Italian";
  if (text.includes("michelangelo tour")) return "Michelangelo Tour";
  if (text.includes("paloma my luxury drive")) return "Paloma My Luxury Drive";

  if (/\btod[-\s]?[a-z0-9]*/i.test(title) || text.includes("todointheworld")) {
    return "ToDoInTheWorld";
  }

  if (text.includes("viator") || /\bvia-[a-z0-9]+/i.test(title)) {
    return "Viator";
  }

  if (text.includes("airbnb")) return "Airbnb";
  if (text.includes("freedome")) return "Freedome";

  if (
    text.includes("getyourguide") ||
    text.includes("get your guide") ||
    text.includes("gyg")
  ) {
    return "GetYourGuide";
  }

  if (
    text.includes("fmdq") ||
    text.includes("fattoria madonna della querce")
  ) {
    return "Fattoria Madonna della Querce";
  }

  return "Fattoria Madonna della Querce";
}

function normalizeChannelKey(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function channelMatchesLabel(channel: ChannelRow, label: string) {
  const channelKey = normalizeChannelKey(channel.name);
  const labelKey = normalizeChannelKey(label);

  if (channelKey === labelKey) return true;

  if (labelKey === "todointheworld") {
    return (
      channelKey.includes("todointheworld") ||
      channelKey.includes("todo") ||
      channelKey.includes("tod")
    );
  }

  if (labelKey === "fattoriamadonnadellaquerce") {
    return channelKey.includes("fattoriamadonnadellaquerce") || channelKey === "fmdq";
  }

  if (labelKey === "getyourguide") {
    return channelKey.includes("getyourguide") || channelKey === "gyg";
  }

  if (labelKey === "lamoscadella") {
    return channelKey.includes("moscadella");
  }

  if (labelKey === "italyonabudgettours") {
    return channelKey.includes("italyonabudget");
  }

  return channelKey.includes(labelKey) || labelKey.includes(channelKey);
}

function extractCurioseetyCustomer(title: string) {
  const match = title.match(/curioseety\s+(.+)$/i);
  if (!match) return null;

  return (
    cleanSpaces(match[1])
      .replace(/\s+(viator|airbnb|tod[-\s]?[a-z0-9]+|via-[a-z0-9]+).*$/i, "")
      .trim() || null
  );
}

function extractAnastasiyaPranzoCustomer(title: string) {
  const text = cleanSpaces(title);

  if (!/anastasiya/i.test(text)) return null;
  if (!/pranzo/i.test(text)) return null;
  if (/quad|cooking|cena|cavall|e-bike|ebike|tagliere|bruschette/i.test(text)) {
    return null;
  }

  return (
    text
      .replace(/^\s*\d+(?:\s*\+\s*\d+\s*\w*)?\s+/i, "")
      .replace(/\bpranzo\b/i, "")
      .replace(/\banastasiya\b/i, "")
      .trim() || null
  );
}

function extractCustomerName(title: string, channelLabel: string) {
  if (normalizeChannelKey(channelLabel) === "curioseety") {
    return extractCurioseetyCustomer(title);
  }

  if (normalizeChannelKey(channelLabel) === "anastasiya") {
    return extractAnastasiyaPranzoCustomer(title);
  }

  return null;
}

function extractBookingReference(title: string, gcalUid: string) {
  const patterns = [
    /\bTOD[-\s]?[A-Z0-9]+\b/i,
    /\bVIA-[A-Z0-9]+\b/i,
    /\bBR-[A-Z0-9]+\b/i,
    /\bGYG[A-Z0-9]+\b/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[0]) {
      return match[0].replace(/\s+/g, "-").toUpperCase();
    }
  }

  return `GCAL-${sanitizeForReference(gcalUid)}`;
}

async function findChannelId(params: {
  channels: ChannelRow[];
  label: string;
}) {
  const directMatch = params.channels.find((channel) =>
    channelMatchesLabel(channel, params.label)
  );

  if (directMatch) return directMatch.id;

  const fallback = params.channels.find((channel) =>
    channelMatchesLabel(channel, "Fattoria Madonna della Querce")
  );

  return fallback?.id ?? null;
}

async function getExistingStagingRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  gcalUid: string
) {
  const { data } = await supabase
    .from("google_calendar_import_staging")
    .select("id, import_status, imported_booking_id")
    .eq("gcal_uid", gcalUid)
    .maybeSingle();

  return data;
}

function nextStatusForExisting(existingStatus?: string | null) {
  if (!existingStatus) return "pending";

  if (existingStatus === "imported") {
    return "needs_review";
  }

  if (existingStatus === "ignored") return "ignored";
  if (existingStatus === "already_exists") return "already_exists";

  return "pending";
}

export async function POST(request: NextRequest) {
  try {
    const expectedSecret = process.env.GOOGLE_CALENDAR_WEBHOOK_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_CALENDAR_WEBHOOK_SECRET mancante." },
        { status: 500 }
      );
    }

    const payload = (await request.json()) as WebhookPayload;

    const providedSecret =
      request.headers.get("x-webhook-secret") ||
      request.headers.get("x-google-calendar-secret") ||
      payload.secret ||
      "";

    if (providedSecret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: "Secret non valido." },
        { status: 401 }
      );
    }

    const gcalUid = getEventId(payload);
    const title = getTitle(payload);
    const status = getStatus(payload);
    const start = parseStart(payload);

    if (!gcalUid) {
      return NextResponse.json(
        { ok: false, error: "event_id mancante." },
        { status: 400 }
      );
    }

    if (!title) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Titolo vuoto." },
        { status: 200 }
      );
    }

    if (!start.isValid) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Data evento non valida." },
        { status: 200 }
      );
    }

    if (start.isAllDay) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Evento tutto il giorno ignorato." },
        { status: 200 }
      );
    }

    if (status === "cancelled" || status === "canceled") {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason:
            "Evento cancellato ricevuto. Non cancelliamo automaticamente prenotazioni.",
        },
        { status: 200 }
      );
    }

    const people = parsePeople(title);

    if (!people) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Evento senza numero partecipanti." },
        { status: 200 }
      );
    }

    const experienceId = detectExperienceId(title);

    if (!experienceId) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Esperienza non riconosciuta." },
        { status: 200 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: channelsData, error: channelsError } = await supabase
      .from("channels")
      .select("id, name, type")
      .order("id", { ascending: true });

    if (channelsError) {
      return NextResponse.json(
        { ok: false, error: channelsError.message },
        { status: 500 }
      );
    }

    const channels = (channelsData ?? []) as ChannelRow[];
    const channelLabel = detectChannelLabel(title);
    const channelId = await findChannelId({ channels, label: channelLabel });

    if (!channelId) {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: `Canale non trovato per label ${channelLabel}.`,
        },
        { status: 200 }
      );
    }

    const customerName = extractCustomerName(title, channelLabel);
    const bookingReference = extractBookingReference(title, gcalUid);

    const existing = await getExistingStagingRow(supabase, gcalUid);
    const importStatus = nextStatusForExisting(existing?.import_status);

    const rowPayload = {
      booking_date: start.bookingDate,
      booking_time: start.bookingTime,
      booking_reference: bookingReference,
      customer_name: customerName,
      adults: people.adults,
      children: people.children,
      infants: people.infants,
      experience_id: experienceId,
      channel_id: channelId,
      booking_source: channelLabel,
      notes: title,
      original_title: title,
      import_status: importStatus,
      imported_booking_id: existing?.imported_booking_id ?? null,
      import_origin: "make",
    };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("google_calendar_import_staging")
        .update(rowPayload)
        .eq("id", existing.id);

      if (updateError) {
        return NextResponse.json(
          { ok: false, error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from("google_calendar_import_staging")
        .insert({
          ...rowPayload,
          gcal_uid: gcalUid,
        });

      if (insertError) {
        return NextResponse.json(
          { ok: false, error: insertError.message },
          { status: 500 }
        );
      }
    }

    revalidatePath("/import/google-calendar");
    revalidatePath("/prenotazioni");
    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      action: existing?.id ? "updated_staging" : "inserted_staging",
      import_status: importStatus,
      import_origin: "make",
      booking_date: start.bookingDate,
      booking_time: start.bookingTime,
      title,
      experience_id: experienceId,
      channel_id: channelId,
      channel: channelLabel,
      customer_name: customerName,
      booking_reference: bookingReference,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Errore sconosciuto.",
      },
      { status: 500 }
    );
  }
}