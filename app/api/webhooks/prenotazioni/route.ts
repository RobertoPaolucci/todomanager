import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

type ExistingBooking = {
  id: number;
  notes: string | null;
  was_modified: boolean | null;
  booking_reference: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  booking_date: string | null;
  booking_time: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  total_people: number | null;
  channel_id: number | null;
  booking_source?: string | null;
  experience_id: number | null;
  experience_name?: string | null;
  supplier_id?: number | null;
  business_unit_id?: number | null;
  is_cancelled: boolean | null;
  your_unit_price: number | null;
  public_unit_price: number | null;
  supplier_unit_cost: number | null;
  total_to_you: number | null;
  total_customer: number | null;
  total_supplier_cost: number | null;
  margin_total: number | null;
  booking_created_at: string | null;
  [key: string]: any;
};

type ExperienceChannelPrice = {
  id: number;
  experience_id: number;
  channel_id: number;
  your_unit_price: number | null;
  public_unit_price: number | null;
  your_child_unit_price: number | null;
  public_child_unit_price: number | null;
  supplier_adult_unit_cost: number | null;
  supplier_child_unit_cost: number | null;
};

type BookingData = Record<string, any>;

const BOKUN_ID_ALIASES: Record<string, string> = {
  // Il prodotto Viator/Bókun può arrivare con uno dei due identificativi
  // seguenti, ma in Todo Manager corrisponde all'esperienza bokun_id 956472.
  "115190": "956472",
  "1151900": "956472",
};

const COMPARE_FIELDS = [
  "channel_id",
  "booking_source",
  "experience_id",
  "experience_name",
  "supplier_id",
  "business_unit_id",
  "customer_name",
  "customer_email",
  "customer_phone",
  "booking_date",
  "booking_time",
  "adults",
  "children",
  "infants",
  "total_people",
  "is_cancelled",
  "your_unit_price",
  "public_unit_price",
  "supplier_unit_cost",
  "total_to_you",
  "total_customer",
  "total_supplier_cost",
  "margin_total",
];

const NUMBER_ZERO_FIELDS = new Set([
  "adults",
  "children",
  "infants",
  "total_people",
  "non_paying_adults",
  "channel_id",
  "experience_id",
  "supplier_id",
  "business_unit_id",
]);

const MONEY_FIELDS = new Set([
  "your_unit_price",
  "public_unit_price",
  "supplier_unit_cost",
  "total_to_you",
  "total_customer",
  "total_supplier_cost",
  "margin_total",
  "supplier_amount_paid",
]);



function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function hasValue(value: unknown) {
  return cleanString(value) !== "";
}

function toOptionalNumber(value: unknown) {
  if (!hasValue(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMoney(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

function normalizeText(value: unknown) {
  return cleanString(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: unknown) {
  return cleanString(value).replace(/\D/g, "");
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const s = cleanString(value);
    if (s) return s;
  }
  return "";
}

function getIncomingEventDate(body: any) {
  const rawDate = firstNonEmpty(
    body.booking_created_at,
    body.booking_created,
    body.created_at,
    body.created,
    body.event_created_at,
    body.event_date,
    body.booked_at
  );

  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return rawDate;
    }
  }

  return new Date().toISOString().split("T")[0];
}

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
        cleanString(body.booking_source) ||
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

async function getExperienceChannelPrice(params: {
  experienceId: number;
  channelId: number;
}) {
  const { experienceId, channelId } = params;

  const { data, error } = await supabaseServer
    .from("experience_channel_prices")
    .select(
      "id, experience_id, channel_id, your_unit_price, public_unit_price, your_child_unit_price, public_child_unit_price, supplier_adult_unit_cost, supplier_child_unit_cost"
    )
    .eq("experience_id", experienceId)
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`Errore lettura prezzi canale: ${error.message}`);
  }

  return (data || null) as ExperienceChannelPrice | null;
}

function calculateBookingEconomics(params: {
  priceRule: ExperienceChannelPrice;
  isGroupPricing: boolean;
  adults: number;
  children: number;
  infants: number;
}) {
  const { priceRule, isGroupPricing, adults, children } = params;

  const adultYourPrice = toMoney(priceRule.your_unit_price);
  const adultPublicPrice = toMoney(priceRule.public_unit_price);

  const childYourPrice = toMoney(
    priceRule.your_child_unit_price ?? priceRule.your_unit_price
  );

  const childPublicPrice = toMoney(
    priceRule.public_child_unit_price ?? priceRule.public_unit_price
  );

  const adultSupplierCost = toMoney(
    priceRule.supplier_adult_unit_cost ?? priceRule.your_unit_price
  );

  const childSupplierCost = toMoney(
    priceRule.supplier_child_unit_cost ??
      priceRule.supplier_adult_unit_cost ??
      priceRule.your_child_unit_price ??
      priceRule.your_unit_price
  );

  const totalToYou = isGroupPricing
    ? adultYourPrice
    : adultYourPrice * adults + childYourPrice * children;

  const totalCustomer = isGroupPricing
    ? adultPublicPrice
    : adultPublicPrice * adults + childPublicPrice * children;

  const totalSupplierCost = isGroupPricing
    ? adultSupplierCost
    : adultSupplierCost * adults + childSupplierCost * children;

  return {
    your_unit_price: adultYourPrice,
    public_unit_price: adultPublicPrice,
    supplier_unit_cost: adultSupplierCost,
    total_to_you: toMoney(totalToYou),
    total_customer: toMoney(totalCustomer),
    total_supplier_cost: toMoney(totalSupplierCost),
    margin_total: toMoney(totalToYou - totalSupplierCost),
  };
}

function normalizeCompareValue(field: string, value: unknown) {
  if (field === "customer_phone") {
    return normalizePhone(value);
  }

  if (field === "booking_time") {
    const text = cleanString(value);
    return text ? text.slice(0, 5) : "";
  }

  if (field === "booking_date" || field === "booking_created_at") {
    const text = cleanString(value);
    if (!text) return "";
    return text.split("T")[0];
  }

  if (MONEY_FIELDS.has(field)) {
    return String(toMoney(value, 0));
  }

  if (NUMBER_ZERO_FIELDS.has(field)) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? String(n) : "0";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value === null || value === undefined) {
    return "";
  }

  return cleanString(value);
}

function getChangedFields(existing: ExistingBooking, bookingData: BookingData) {
  return COMPARE_FIELDS.filter((field) => {
    if (!(field in bookingData)) return false;

    return (
      normalizeCompareValue(field, existing[field]) !==
      normalizeCompareValue(field, bookingData[field])
    );
  });
}

async function getLatestBookingByReference(bookingReference: string) {
  const ref = cleanString(bookingReference);
  if (!ref) return null;

  const { data, error } = await supabaseServer
    .from("bookings")
    .select("*")
    .eq("booking_reference", ref)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return (data || null) as ExistingBooking | null;
}

async function getLatestVersionForCandidate(candidate: ExistingBooking) {
  if (!candidate?.booking_reference) return candidate;

  return (await getLatestBookingByReference(candidate.booking_reference)) || candidate;
}

function scoreCandidate(params: {
  candidate: ExistingBooking;
  expectedExperienceId: number;
  channelId: number;
  bookingTime: string;
  totalPeople: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}) {
  const {
    candidate,
    expectedExperienceId,
    channelId,
    bookingTime,
    totalPeople,
    customerName,
    customerEmail,
    customerPhone,
  } = params;

  let score = 0;

  const incomingEmail = normalizeText(customerEmail);
  const incomingName = normalizeText(customerName);
  const incomingPhone = normalizePhone(customerPhone);

  const candidateEmail = normalizeText(candidate.customer_email);
  const candidateName = normalizeText(candidate.customer_name);
  const candidatePhone = normalizePhone(candidate.customer_phone);

  if (Number(candidate.experience_id) === expectedExperienceId) {
    score += 35;
  }

  if (incomingEmail && candidateEmail && incomingEmail === candidateEmail) {
    score += 100;
  }

  if (incomingPhone && candidatePhone && incomingPhone === candidatePhone) {
    score += 90;
  }

  if (incomingName && candidateName && incomingName === candidateName) {
    score += 80;
  }

  if (
    incomingName &&
    candidateName &&
    incomingName !== candidateName &&
    (incomingName.includes(candidateName) || candidateName.includes(incomingName))
  ) {
    score += 40;
  }

  if (bookingTime && cleanString(candidate.booking_time) === bookingTime) {
    score += 25;
  }

  if (Number(candidate.channel_id) === channelId) {
    score += 15;
  }

  if (
    totalPeople !== null &&
    Number(candidate.total_people || 0) === totalPeople
  ) {
    score += 15;
  }

  return score;
}

function tryFindUniqueCandidate(params: {
  candidates: ExistingBooking[];
  expectedExperienceId: number;
  channelId: number;
  bookingTime: string;
  totalPeople: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  broadSearch: boolean;
}) {
  const {
    candidates,
    expectedExperienceId,
    channelId,
    bookingTime,
    totalPeople,
    customerName,
    customerEmail,
    customerPhone,
    broadSearch,
  } = params;

  if (!candidates.length) {
    return {
      match: null as ExistingBooking | null,
      ranked: [] as Array<{ candidate: ExistingBooking; score: number }>,
    };
  }

  const exactTimeChannelPeople = candidates.filter((c) => {
    const sameTime = bookingTime && cleanString(c.booking_time) === bookingTime;
    const sameChannel = Number(c.channel_id) === channelId;
    const samePeople =
      totalPeople !== null && Number(c.total_people || 0) === totalPeople;

    return sameTime && sameChannel && samePeople;
  });

  if (exactTimeChannelPeople.length === 1) {
    return {
      match: exactTimeChannelPeople[0],
      ranked: [],
    };
  }

  const exactTimePeople = candidates.filter((c) => {
    const sameTime = bookingTime && cleanString(c.booking_time) === bookingTime;
    const samePeople =
      totalPeople !== null && Number(c.total_people || 0) === totalPeople;

    return sameTime && samePeople;
  });

  if (exactTimePeople.length === 1) {
    return {
      match: exactTimePeople[0],
      ranked: [],
    };
  }

  const exactTimeChannel = candidates.filter((c) => {
    const sameTime = bookingTime && cleanString(c.booking_time) === bookingTime;
    const sameChannel = Number(c.channel_id) === channelId;

    return sameTime && sameChannel;
  });

  if (exactTimeChannel.length === 1) {
    return {
      match: exactTimeChannel[0],
      ranked: [],
    };
  }

  const sameChannelPeople = candidates.filter((c) => {
    const sameChannel = Number(c.channel_id) === channelId;
    const samePeople =
      totalPeople !== null && Number(c.total_people || 0) === totalPeople;

    return sameChannel && samePeople;
  });

  if (sameChannelPeople.length === 1) {
    return {
      match: sameChannelPeople[0],
      ranked: [],
    };
  }

  const incomingEmail = normalizeText(customerEmail);

  if (incomingEmail) {
    const byEmail = candidates.filter(
      (c) => normalizeText(c.customer_email) === incomingEmail
    );

    if (byEmail.length === 1) {
      return {
        match: byEmail[0],
        ranked: [],
      };
    }
  }

  const incomingPhone = normalizePhone(customerPhone);

  if (incomingPhone) {
    const byPhone = candidates.filter(
      (c) => normalizePhone(c.customer_phone) === incomingPhone
    );

    if (byPhone.length === 1) {
      return {
        match: byPhone[0],
        ranked: [],
      };
    }
  }

  const incomingName = normalizeText(customerName);

  if (incomingName) {
    const byName = candidates.filter(
      (c) => normalizeText(c.customer_name) === incomingName
    );

    if (byName.length === 1) {
      return {
        match: byName[0],
        ranked: [],
      };
    }
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate({
        candidate,
        expectedExperienceId,
        channelId,
        bookingTime,
        totalPeople,
        customerName,
        customerEmail,
        customerPhone,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];

  if (!best) {
    return {
      match: null,
      ranked,
    };
  }

  if (!broadSearch) {
    if (best.score >= 80) {
      return { match: best.candidate, ranked };
    }

    if (best.score >= 45 && (!second || best.score >= second.score + 15)) {
      return { match: best.candidate, ranked };
    }

    if (ranked.length === 1 && best.score >= 25) {
      return { match: best.candidate, ranked };
    }
  } else {
    if (best.score >= 100) {
      return { match: best.candidate, ranked };
    }

    if (best.score >= 65 && (!second || best.score >= second.score + 20)) {
      return { match: best.candidate, ranked };
    }

    if (ranked.length === 1 && best.score >= 40) {
      return { match: best.candidate, ranked };
    }
  }

  return {
    match: null,
    ranked,
  };
}

async function findExistingBooking(params: {
  bookingReference: string;
  isCancelled: boolean;
  experienceId: number;
  bookingDate: string;
  bookingTime: string;
  channelId: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalPeople: number | null;
}) {
  const {
    bookingReference,
    isCancelled,
    experienceId,
    bookingDate,
    bookingTime,
    channelId,
    customerName,
    customerEmail,
    customerPhone,
    totalPeople,
  } = params;

  const selectFields = "*";

  if (bookingReference) {
    const latestByReference = await getLatestBookingByReference(bookingReference);
    if (latestByReference) return latestByReference;
  }

  if (!isCancelled) return null;
  if (!bookingDate) return null;

  const { data: sameExperienceCandidates, error: sameExperienceError } =
    await supabaseServer
      .from("bookings")
      .select(selectFields)
      .eq("booking_date", bookingDate)
      .eq("experience_id", experienceId)
      .eq("is_cancelled", false)
      .limit(50);

  if (sameExperienceError) {
    throw new Error(sameExperienceError.message);
  }

  const sameExperienceList = (sameExperienceCandidates || []) as ExistingBooking[];

  const sameExperienceResult = tryFindUniqueCandidate({
    candidates: sameExperienceList,
    expectedExperienceId: experienceId,
    channelId,
    bookingTime,
    totalPeople,
    customerName,
    customerEmail,
    customerPhone,
    broadSearch: false,
  });

  if (sameExperienceResult.match) {
    return await getLatestVersionForCandidate(sameExperienceResult.match);
  }

  const { data: sameDateCandidates, error: sameDateError } = await supabaseServer
    .from("bookings")
    .select(selectFields)
    .eq("booking_date", bookingDate)
    .eq("is_cancelled", false)
    .limit(100);

  if (sameDateError) {
    throw new Error(sameDateError.message);
  }

  const sameDateList = (sameDateCandidates || []) as ExistingBooking[];

  const sameDateResult = tryFindUniqueCandidate({
    candidates: sameDateList,
    expectedExperienceId: experienceId,
    channelId,
    bookingTime,
    totalPeople,
    customerName,
    customerEmail,
    customerPhone,
    broadSearch: true,
  });

  console.log(
    "CANCEL MATCH DEBUG",
    JSON.stringify(
      {
        incoming: {
          bookingReference,
          experienceId,
          bookingDate,
          bookingTime,
          channelId,
          totalPeople,
          customerName,
          customerEmail,
          customerPhone,
        },
        same_experience_candidates: sameExperienceList.map((c) => ({
          id: c.id,
          booking_reference: c.booking_reference,
          customer_name: c.customer_name,
          booking_time: c.booking_time,
          total_people: c.total_people,
          channel_id: c.channel_id,
          experience_id: c.experience_id,
        })),
        same_experience_ranked: sameExperienceResult.ranked.map((r) => ({
          id: r.candidate.id,
          booking_reference: r.candidate.booking_reference,
          customer_name: r.candidate.customer_name,
          booking_time: r.candidate.booking_time,
          total_people: r.candidate.total_people,
          channel_id: r.candidate.channel_id,
          experience_id: r.candidate.experience_id,
          score: r.score,
        })),
        same_date_candidates: sameDateList.map((c) => ({
          id: c.id,
          booking_reference: c.booking_reference,
          customer_name: c.customer_name,
          booking_time: c.booking_time,
          total_people: c.total_people,
          channel_id: c.channel_id,
          experience_id: c.experience_id,
        })),
        same_date_ranked: sameDateResult.ranked.map((r) => ({
          id: r.candidate.id,
          booking_reference: r.candidate.booking_reference,
          customer_name: r.candidate.customer_name,
          booking_time: r.candidate.booking_time,
          total_people: r.candidate.total_people,
          channel_id: r.candidate.channel_id,
          experience_id: r.candidate.experience_id,
          score: r.score,
        })),
      },
      null,
      2
    )
  );

  if (sameDateResult.match) {
    return await getLatestVersionForCandidate(sameDateResult.match);
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

    const rawBokunId = cleanString(body.bokun_id);
    const resolvedBokunId = BOKUN_ID_ALIASES[rawBokunId] ?? rawBokunId;

    const incomingBookingReference = firstNonEmpty(
      body.externalBookingReference,
      body.external_booking_reference,
      body.booking_reference,
      body.productConfirmationCode,
      body.product_confirmation_code
    );
    const status = cleanString(body.status).toUpperCase();
    const action = cleanString(body.action).toUpperCase();
    const isCancelled =
      status === "CANCELLED" ||
      status === "CANCELED" ||
      action === "BOOKING_CANCELLED" ||
      action === "BOOKING_ITEM_CANCELLED";
    const incomingEventDate = getIncomingEventDate(body);

    if (!rawBokunId) {
      return NextResponse.json({ error: "bokun_id mancante" }, { status: 400 });
    }

    if (!incomingBookingReference && !isCancelled) {
      return NextResponse.json(
        { error: "booking_reference mancante" },
        { status: 400 }
      );
    }

    if (resolvedBokunId !== rawBokunId) {
      console.log("BOKUN ID ALIAS APPLICATO", {
        ricevuto: rawBokunId,
        usato_per_todo_manager: resolvedBokunId,
      });
    }

    const resolvedChannel = resolveChannel(body, incomingBookingReference);

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
      .eq("bokun_id", resolvedBokunId)
      .single();

    if (experienceError || !experience) {
      console.error("ESPERIENZA NON TROVATA", {
        bokun_id_ricevuto: rawBokunId,
        bokun_id_risolto: resolvedBokunId,
        errore_supabase: experienceError?.message || null,
      });

      return NextResponse.json(
        {
          error: "Esperienza non trovata",
          bokun_id_ricevuto: rawBokunId,
          bokun_id_risolto: resolvedBokunId,
        },
        { status: 404 }
      );
    }

    if (!experience.business_unit_id) {
      return NextResponse.json(
        { error: "Esperienza senza business_unit_id" },
        { status: 500 }
      );
    }

    const incomingCustomerName = cleanString(body.customer_name);
    const incomingCustomerEmail = cleanString(body.customer_email);
    const incomingCustomerPhone = cleanString(body.customer_phone);
    const incomingBookingDate = cleanString(body.booking_date);
    const incomingBookingTime = cleanString(body.booking_time);

    const adultsFromBody = toOptionalNumber(body.adults);
    const childrenFromBody = toOptionalNumber(body.children);
    const infantsFromBody = toOptionalNumber(body.infants);

    const incomingTotalPeople =
      (adultsFromBody ?? 0) + (childrenFromBody ?? 0) + (infantsFromBody ?? 0);

    const existing = await findExistingBooking({
      bookingReference: incomingBookingReference,
      isCancelled,
      experienceId: experience.id,
      bookingDate: incomingBookingDate,
      bookingTime: incomingBookingTime,
      channelId,
      customerName: incomingCustomerName,
      customerEmail: incomingCustomerEmail,
      customerPhone: incomingCustomerPhone,
      totalPeople: incomingTotalPeople > 0 ? incomingTotalPeople : null,
    });

    if (isCancelled && !existing) {
      console.log(
        "CANCEL NOT FOUND",
        JSON.stringify(
          {
            incoming: {
              booking_reference: incomingBookingReference,
              bokun_id_ricevuto: rawBokunId,
              bokun_id_risolto: resolvedBokunId,
              resolved_experience_id: experience.id,
              booking_date: incomingBookingDate,
              booking_time: incomingBookingTime,
              channel_id: channelId,
              customer_name: incomingCustomerName,
              customer_email: incomingCustomerEmail,
              customer_phone: incomingCustomerPhone,
              adults: adultsFromBody,
              children: childrenFromBody,
              infants: infantsFromBody,
              total_people: incomingTotalPeople,
            },
          },
          null,
          2
        )
      );

      return NextResponse.json({
        success: false,
        skipped: true,
        reason:
          "Cancellazione ricevuta ma prenotazione esistente non trovata. Nessun dato aggiornato per evitare abbinamenti sbagliati.",
      });
    }

    const finalCustomerName = firstNonEmpty(
      incomingCustomerName,
      existing?.customer_name
    );

    const finalCustomerEmail =
      firstNonEmpty(incomingCustomerEmail, existing?.customer_email) || null;

    const finalCustomerPhone =
      firstNonEmpty(incomingCustomerPhone, existing?.customer_phone) || null;

    const finalBookingDate = firstNonEmpty(
      incomingBookingDate,
      existing?.booking_date
    );

    const finalBookingTime =
      firstNonEmpty(incomingBookingTime, existing?.booking_time) || null;

    const finalAdults =
      adultsFromBody !== null ? adultsFromBody : Number(existing?.adults || 0);

    const finalChildren =
      childrenFromBody !== null
        ? childrenFromBody
        : Number(existing?.children || 0);

    const finalInfants =
      infantsFromBody !== null
        ? infantsFromBody
        : Number(existing?.infants || 0);

    const priceRule = await getExperienceChannelPrice({
      experienceId: Number(experience.id),
      channelId,
    });

    if (!isCancelled && !priceRule) {
      return NextResponse.json(
        {
          error:
            "Prezzo canale mancante: prenotazione non salvata per evitare importi a zero. Configura experience_channel_prices per questa esperienza e questo canale.",
          experience_id: experience.id,
          experience_name: experience.name,
          channel_id: channelId,
          booking_source: bookingSource,
        },
        { status: 400 }
      );
    }

    const economicData = priceRule
      ? calculateBookingEconomics({
          priceRule,
          isGroupPricing: Boolean(experience.is_group_pricing),
          adults: finalAdults,
          children: finalChildren,
          infants: finalInfants,
        })
      : {};

    const bookingData = {
      channel_id: channelId,
      booking_source: bookingSource,

      experience_id: experience.id,
      experience_name: experience.name,
      supplier_id: experience.supplier_id,
      business_unit_id: Number(experience.business_unit_id),

      customer_name: finalCustomerName,
      customer_email: finalCustomerEmail,
      customer_phone: finalCustomerPhone,

      booking_date: finalBookingDate,
      booking_time: finalBookingTime,

      adults: finalAdults,
      children: finalChildren,
      infants: finalInfants,
      total_people: finalAdults + finalChildren + finalInfants,

      is_cancelled: isCancelled,
      ...(isCancelled ? {} : economicData),
    };

    const previousNotes = cleanString(existing?.notes || body.notes);
    const cleanNotes = stripSystemAlert(previousNotes);

    let alertType: "new" | "modified" | "cancelled" = "new";

    if (isCancelled) {
      alertType = "cancelled";
    } else if (existing) {
      alertType = "modified";
    }

    const systemAlert = buildSystemAlert(alertType);
    const finalNotes = cleanNotes ? `${systemAlert}\n${cleanNotes}` : systemAlert;

    let actionResult: "created" | "updated" | "unchanged" = "created";
    let changedFields: string[] = [];

    if (existing) {
      changedFields = getChangedFields(existing, bookingData);

      if (changedFields.length === 0) {
        actionResult = "unchanged";
      } else {
        const nextWasModified = isCancelled ? Boolean(existing.was_modified) : true;
        const shouldRefreshCreatedAt =
          !isCancelled &&
          (Boolean(existing.is_cancelled) || !existing.booking_created_at);

        const updatePayload = {
          ...bookingData,
          booking_reference:
            existing.booking_reference || incomingBookingReference || null,
          booking_created_at: shouldRefreshCreatedAt
            ? incomingEventDate
            : existing.booking_created_at || incomingEventDate,
          notes: finalNotes,
          was_modified: nextWasModified,
        };

        const { error: updateError } = await supabaseServer
          .from("bookings")
          .update(updatePayload)
          .eq("id", existing.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        actionResult = "updated";
      }
    } else {
      const { error: insertError } = await supabaseServer
        .from("bookings")
        .insert({
          ...bookingData,
          booking_reference: incomingBookingReference,
          booking_created_at: incomingEventDate,
          notes: finalNotes,
          was_modified: false,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      actionResult = "created";
    }

    revalidatePath("/");
    revalidatePath("/prenotazioni");

    return NextResponse.json({
      success: true,
      action: actionResult,
      bokun_id_ricevuto: rawBokunId,
      bokun_id_risolto: resolvedBokunId,
      channel_id: channelId,
      booking_source: bookingSource,
      business_unit_id: bookingData.business_unit_id,
      matched_existing_booking: Boolean(existing),
      updated_existing_booking: actionResult === "updated",
      created_new_history_row: false,
      unchanged: actionResult === "unchanged",
      changed_fields: changedFields,
      preserved_existing_reference: Boolean(existing?.booking_reference),
      applied_channel_price: Boolean(priceRule),
      totals: isCancelled
        ? null
        : {
            total_to_you: (bookingData as any).total_to_you,
            total_customer: (bookingData as any).total_customer,
            total_supplier_cost: (bookingData as any).total_supplier_cost,
            margin_total: (bookingData as any).margin_total,
          },
    });
  } catch (error: any) {
    console.error("Errore webhook prenotazioni:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
