import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";
import { applyBookingAgreement, parseAgreedUnitPrice, assertPersonAgreement, isDirectFmdqAgreementContext } from "@/lib/booking-pricing";
import { getFmdqInternalSupplierKeys } from "@/lib/booking-pricing-server";
import {
  BokunIdentityError,
  findBokunBooking,
  requireBokunBusinessUnit,
  getBokunBookingReference,
  hasGetYourGuideReference,
  requireBokunIdentityForGYG,
} from "@/lib/bokun-booking-identity";

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
  "booking_reference",
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
  "total_to_you_source",
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

  if (
    ref.startsWith("GYG") ||
    hasGetYourGuideReference(body.externalBookingReference, body.external_booking_reference, body.booking_reference)
  ) {
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

class BokunChannelError extends Error {}

// This convention belongs only to our Bókun widgets. Legacy/OTA resolution
// deliberately remains separate, and product references never decide a widget.
function resolveWidgetChannel(
  body: Record<string, unknown>,
  businessUnitId: number,
  existing: ExistingBooking | null,
  bokunBookingReference: string,
) {
  const incomingId = toOptionalNumber(body.channel_id);
  const existingId = existing?.channel_id;
  const fail: (message: string) => never = (message) => {
    console.error("BOKUN WIDGET CHANNEL CONFLICT", {
      message, bokun_booking_reference: bokunBookingReference,
      business_unit_id: businessUnitId, booking_id: existing?.id ?? null,
      incoming_channel_id: body.channel_id ?? null,
      existing_channel_id: existingId ?? null,
      bokun_channel_id: body.bokun_channel_id,
    });
    throw new BokunChannelError(message);
  };

  if (!bokunBookingReference) {
    fail("Widget Bókun senza identità canonica: inviare bokun_booking_reference.");
  }
  const otaIds = [2, 3, 5];
  const sourceIds = [body.booking_source, body.channel_name, body.seller,
    body.seller_name, body.source, body.origin, body.vendor, body.channel]
    .map(value => detectChannelIdFromText(cleanString(value)));
  const otaReference = [body.externalBookingReference, body.external_booking_reference,
    body.booking_reference, existing?.booking_reference]
    .some(value => /^(GYG|VIA)/i.test(cleanString(value)));
  if (otaIds.includes(incomingId ?? 0) || otaIds.includes(existingId ?? 0) ||
      sourceIds.some(id => otaIds.includes(id ?? 0)) || otaReference) {
    fail("DIRECT_ONLINE_WIDGETS in conflitto con un canale OTA: revisione necessaria.");
  }
  if (hasValue(body.channel_id) && ![1, 4, 6].includes(incomingId ?? 0)) {
    fail("Canale interno non valido per DIRECT_ONLINE_WIDGETS: revisione necessaria.");
  }
  // A legacy Make fallback of 1 is insufficient evidence only when the new
  // widget marker is present. Never reinterpret a stored Direct booking.
  const explicitId = incomingId === 4 || incomingId === 6 ? incomingId : null;
  if (existing) {
    if (existingId !== 4 && existingId !== 6) {
      fail("Canale della booking esistente ambiguo per il widget: revisione necessaria; nessuna correzione automatica.");
    }
    if (explicitId !== null && explicitId !== existingId) {
      fail("Canale widget esplicito diverso dalla booking esistente: revisione necessaria.");
    }
    return { channelId: existingId, bookingSource: getBookingSourceFromChannelId(existingId) };
  }
  const channelId = explicitId ?? (businessUnitId === 2 ? 4 : businessUnitId === 1 ? 6 : null);
  if (channelId === null) {
    fail("Widget senza canale determinabile per questa business unit: revisione necessaria.");
  }
  return { channelId, bookingSource: getBookingSourceFromChannelId(channelId) };
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
  channelId: number;
  sourceTotalPrice?: unknown;
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

  const sourceTotalPrice = params.channelId === 2 &&
    (typeof params.sourceTotalPrice === "number" ||
      typeof params.sourceTotalPrice === "string")
    ? toOptionalNumber(params.sourceTotalPrice)
    : null;

  // Viator supplies the total for the entire booking, not a per-person price.
  const usesSourceTotalPrice = sourceTotalPrice !== null && sourceTotalPrice >= 0;
  const totalToYou = usesSourceTotalPrice
    ? toMoney(sourceTotalPrice)
    : isGroupPricing
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
    ...(params.channelId === 2 ? {
      total_to_you_source: usesSourceTotalPrice ? "bokun_webhook" : "configured_price",
    } : {}),
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
    .is("bokun_booking_reference", null)
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
  bookingReferences: string[];
  allowHeuristicMatch: boolean;
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
    bookingReferences,
    allowHeuristicMatch,
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

  if (bookingReferences.length) {
    const { data: identified, error } = await supabaseServer.from("bookings")
      .select("id").in("booking_reference", bookingReferences)
      .not("bokun_booking_reference", "is", null).limit(1);
    if (error) throw new Error(error.message);
    if (identified?.length) {
      throw new BokunIdentityError("Inviare il Booking ref Bókun per aggiornare una prenotazione con identità Bókun.");
    }
  }

  for (const bookingReference of bookingReferences) {
    const latestByReference = await getLatestBookingByReference(bookingReference);
    if (latestByReference) {
      return {
        booking: latestByReference,
        matchedReference: bookingReference,
        usedHeuristicMatch: false,
      };
    }
  }

  if (!allowHeuristicMatch) return null;
  if (!bookingDate) return null;

  const { data: sameExperienceCandidates, error: sameExperienceError } =
    await supabaseServer
      .from("bookings")
      .select(selectFields)
      .eq("booking_date", bookingDate)
      .eq("experience_id", experienceId)
      .eq("is_cancelled", false)
      .is("bokun_booking_reference", null)
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
    return {
      booking: await getLatestVersionForCandidate(sameExperienceResult.match),
      matchedReference: null,
      usedHeuristicMatch: true,
    };
  }

  const { data: sameDateCandidates, error: sameDateError } = await supabaseServer
    .from("bookings")
    .select(selectFields)
    .eq("booking_date", bookingDate)
    .eq("is_cancelled", false)
    .is("bokun_booking_reference", null)
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
          bookingReferences,
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
    return {
      booking: await getLatestVersionForCandidate(sameDateResult.match),
      matchedReference: null,
      usedHeuristicMatch: true,
    };
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
    const bokunBookingReference = getBokunBookingReference(body);

    const incomingBookingReferences = Array.from(
      new Set(
        [
          body.externalBookingReference,
          body.external_booking_reference,
          body.booking_reference,
          body.productConfirmationCode,
          body.product_confirmation_code,
        ]
          .map(cleanString)
          .filter(Boolean)
      )
    );
    const incomingBookingReference = bokunBookingReference
      ? [body.externalBookingReference, body.external_booking_reference, body.booking_reference]
        .map(cleanString).find(ref => ref && ref !== bokunBookingReference && !/^TOD-T\d+$/i.test(ref)) || ""
      : incomingBookingReferences[0] || "";
    const status = cleanString(body.status).toUpperCase();
    const action = cleanString(body.action).toUpperCase();
    const isCancelled =
      status === "CANCELLED" ||
      status === "CANCELED" ||
      action === "CANCELLED" ||
      action === "CANCELED" ||
      action === "BOOKING_CANCELLED" ||
      action === "BOOKING_ITEM_CANCELLED";
    const isModified =
      status === "MODIFIED" || action === "MODIFIED" || action === "BOOKING_MODIFIED";
    const eventType = isCancelled
      ? "CANCELLED"
      : isModified
        ? "MODIFIED"
        : "CONFIRMED";
    const incomingEventDate = getIncomingEventDate(body);

    console.log("WEBHOOK EVENT DETECTED", {
      event_type: eventType,
      status,
      action,
      candidate_references: incomingBookingReferences,
    });

    if (!rawBokunId) {
      return NextResponse.json({ error: "bokun_id mancante" }, { status: 400 });
    }

    if (!incomingBookingReference && !bokunBookingReference && !isCancelled) {
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

    const { data: experiences, error: experienceError } = await supabaseServer
      .from("experiences")
      .select(
        "id, name, supplier_id, is_group_pricing, supplier_unit_cost, business_unit_id"
      )
      .eq("bokun_id", resolvedBokunId)
      .limit(2);

    if (experienceError) {
      console.error("BOKUN EXPERIENCE LOOKUP ERROR", {
        bokun_id_ricevuto: rawBokunId, bokun_id_risolto: resolvedBokunId,
        error: experienceError,
      });
      return NextResponse.json({ error: "Errore tecnico nella risoluzione dell'esperienza" }, { status: 500 });
    }
    if (experiences && experiences.length > 1) {
      console.error("BOKUN EXPERIENCE CARDINALITY ERROR", {
        bokun_id_ricevuto: rawBokunId, bokun_id_risolto: resolvedBokunId,
        experiences: experiences.map(item => ({ id: item.id, business_unit_id: item.business_unit_id })),
      });
      return NextResponse.json({ error: "Risoluzione dell'esperienza ambigua" }, { status: 500 });
    }
    const experience = experiences?.[0];
    if (!experience) {
      console.error("ESPERIENZA NON TROVATA", {
        bokun_id_ricevuto: rawBokunId,
        bokun_id_risolto: resolvedBokunId,
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

    const businessUnitId = requireBokunBusinessUnit(experience.business_unit_id);
    const isWidget = cleanString(body.bokun_channel_id).toUpperCase() === "DIRECT_ONLINE_WIDGETS";

    // Cancellation identity is authoritative: never enter legacy/heuristic matching.
    if (isCancelled && bokunBookingReference) {
      const { data: candidates, error: matchError } = await supabaseServer
        .from("bookings").select("*")
        .eq("business_unit_id", businessUnitId)
        .eq("bokun_booking_reference", bokunBookingReference).limit(2);
      if (matchError) throw new Error(matchError.message);

      const booking = candidates?.length === 1
        ? candidates[0] as ExistingBooking : null;
      const diagnostics = {
        matched_booking_id: booking?.id ?? null,
        matched_bokun_booking_reference: booking?.bokun_booking_reference ?? null,
        matching_method: "bokun_booking_reference",
        channel_id: booking?.channel_id ?? null,
        booking_source: booking?.booking_source ?? null,
        business_unit_id: businessUnitId,
      };
      if (!booking || Number(booking.experience_id) !== Number(experience.id)) {
        return NextResponse.json({
          ...diagnostics, success: false, skipped: true,
          updated_existing_booking: false,
          reason: "bokun_reconciliation_required",
          error: "Riferimento Bókun non associato a una sola prenotazione valida nella business unit. Riconciliazione necessaria; nessuna riga modificata.",
        }, { status: 409 });
      }

      if (isWidget) resolveWidgetChannel(body, businessUnitId, booking, bokunBookingReference);
      const unchanged = booking.is_cancelled === true;
      if (!unchanged) {
        const notes = stripSystemAlert(cleanString(booking.notes));
        const alert = buildSystemAlert("cancelled");
        // Only cancellation state and its alert change; preserve stored identity,
        // channel, customer, schedule and economics even with incomplete payloads.
        const { data: updated, error: updateError } = await supabaseServer
          .from("bookings")
          .update({ is_cancelled: true, notes: notes ? `${alert}\n${notes}` : alert })
          .eq("id", booking.id)
          .eq("business_unit_id", businessUnitId)
          .eq("bokun_booking_reference", bokunBookingReference)
          .eq("experience_id", experience.id)
          .select("id").maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!updated || updated.id !== booking.id) {
          return NextResponse.json({
            ...diagnostics, success: false, updated_existing_booking: false,
            reason: "bokun_update_not_verified",
            error: "Aggiornamento della prenotazione Bókun non verificato: riconciliare prima di ripetere l'evento.",
          }, { status: 409 });
        }
        revalidatePath("/");
        revalidatePath("/prenotazioni");
      }
      return NextResponse.json({
        ...diagnostics, success: true, action: unchanged ? "unchanged" : "updated",
        bokun_id_ricevuto: rawBokunId, bokun_id_risolto: resolvedBokunId,
        matched_existing_booking: true, updated_existing_booking: !unchanged,
        created_new_history_row: false, unchanged,
        changed_fields: unchanged ? [] : ["is_cancelled"],
        preserved_existing_reference: Boolean(booking.booking_reference),
        applied_channel_price: false, totals: null,
      });
    }

    const identifiedBokunBooking = bokunBookingReference
      ? await findBokunBooking(supabaseServer, businessUnitId, bokunBookingReference, incomingBookingReferences) as ExistingBooking | null
      : null;
    const channelReference = hasGetYourGuideReference(identifiedBokunBooking?.booking_reference)
      ? identifiedBokunBooking!.booking_reference!
      : incomingBookingReference;
    const resolvedChannel = isWidget
      ? resolveWidgetChannel(body, businessUnitId, identifiedBokunBooking, bokunBookingReference)
      : resolveChannel(body, channelReference) ||
        (identifiedBokunBooking && resolveChannel(identifiedBokunBooking, identifiedBokunBooking.booking_reference || ""));

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
    requireBokunIdentityForGYG(
      bokunBookingReference,
      channelId === 3 || hasGetYourGuideReference(...incomingBookingReferences)
    );

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

    const existingMatch = bokunBookingReference ? {
      booking: identifiedBokunBooking,
      matchedReference: bokunBookingReference,
      usedHeuristicMatch: false,
    } : await findExistingBooking({
      bookingReferences: incomingBookingReferences,
      allowHeuristicMatch: isModified || isCancelled,
      experienceId: experience.id,
      bookingDate: incomingBookingDate,
      bookingTime: incomingBookingTime,
      channelId,
      customerName: incomingCustomerName,
      customerEmail: incomingCustomerEmail,
      customerPhone: incomingCustomerPhone,
      totalPeople: incomingTotalPeople > 0 ? incomingTotalPeople : null,
    });
    const existing = existingMatch?.booking || null;
    const agreement = parseAgreedUnitPrice(existing?.agreed_unit_price);
    if (agreement !== null && !isCancelled && (
      Number(existing?.experience_id) !== Number(experience.id) ||
      Number(existing?.channel_id) !== channelId ||
      Number(existing?.supplier_id) !== Number(experience.supplier_id) ||
      Number(existing?.business_unit_id) !== businessUnitId
    )) {
      throw new BokunIdentityError("Prenotazione con prezzo concordato: cambio di contesto da verificare manualmente.");
    }

    // A cart containing another product must be reviewed, never overwritten.
    if (bokunBookingReference && existing && Number(existing.experience_id) !== Number(experience.id)) {
      throw new BokunIdentityError("Booking Bókun già associato a un'altra esperienza: verificare i prodotti della prenotazione.");
    }

    console.log("WEBHOOK BOOKING MATCH", {
      event_type: eventType,
      candidate_references: incomingBookingReferences,
      matched_booking_id: existing?.id || null,
      matched_reference: existingMatch?.matchedReference || null,
      used_heuristic_match: existingMatch?.usedHeuristicMatch || false,
    });

    if ((isModified || isCancelled) && !existing) {
      console.log(
        "WEBHOOK EVENT SKIPPED: ORIGINAL BOOKING NOT FOUND",
        JSON.stringify(
          {
            event_type: eventType,
            final_operation: "SKIP",
            incoming: {
              booking_references: incomingBookingReferences,
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
          `${eventType} ricevuto ma prenotazione esistente non trovata. Nessun dato aggiornato per evitare duplicati o abbinamenti sbagliati.`,
      }, { status: bokunBookingReference ? 409 : 200 });
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

    let economicData = priceRule
      ? calculateBookingEconomics({
          priceRule,
          channelId,
          sourceTotalPrice: isCancelled ? undefined : body.source_total_price,
          isGroupPricing: Boolean(experience.is_group_pricing),
          adults: finalAdults,
          children: finalChildren,
          infants: finalInfants,
        })
      : {};

    if (agreement !== null && !isCancelled) {
      assertPersonAgreement(agreement, Boolean(experience.is_group_pricing));
      const [keys, channelResult] = await Promise.all([
        getFmdqInternalSupplierKeys(),
        supabaseServer.from("channels").select("fattura_mensile_fmdq").eq("id", channelId).single(),
      ]);
      if (channelResult.error || !channelResult.data) throw new Error("Impossibile verificare il canale del prezzo concordato.");
      if (!priceRule) throw new Error("Listino mancante per la prenotazione con prezzo concordato.");
      economicData = {
        ...applyBookingAgreement(calculateBookingEconomics({
          priceRule, channelId, sourceTotalPrice: body.source_total_price,
          isGroupPricing: Boolean(experience.is_group_pricing),
          adults: finalAdults, children: finalChildren, infants: finalInfants,
        }), {
          price: agreement, adults: finalAdults, children: finalChildren,
          isGroupPricing: Boolean(experience.is_group_pricing),
          directFmdq: isDirectFmdqAgreementContext(keys.has(`${businessUnitId}:${experience.supplier_id}`), channelResult.data.fattura_mensile_fmdq),
        }),
        // A manual agreement is not a Bókun source total.
        total_to_you_source: null,
      };
    }

    // Display reference only: matching and channel resolution are already complete.
    const todoProductReference = bokunBookingReference && existing &&
      channelId === 4 && !isCancelled && !cleanString(existing.booking_reference) &&
      /^TOD-T\d+$/i.test(cleanString(body.booking_reference))
      ? cleanString(body.booking_reference)
      : "";

    const bookingData = {
      ...(bokunBookingReference ? {
        bokun_booking_reference: bokunBookingReference,
        // Fill the external reference if an earlier event only had the cart ID.
        booking_reference: todoProductReference
          ? incomingBookingReference || todoProductReference
          : !existing?.booking_reference || existing.booking_reference === bokunBookingReference
            ? incomingBookingReference || null
            : existing.booking_reference,
      } : {}),
      channel_id: channelId,
      booking_source: bookingSource,

      experience_id: experience.id,
      experience_name: experience.name,
      supplier_id: experience.supplier_id,
      business_unit_id: businessUnitId,

      customer_name: finalCustomerName,
      customer_email: finalCustomerEmail,
      customer_phone: finalCustomerPhone,

      booking_date: finalBookingDate,
      booking_time: finalBookingTime,

      adults: finalAdults,
      children: finalChildren,
      infants: finalInfants,
      total_people: finalAdults + finalChildren + finalInfants +
        (agreement !== null ? Number(existing?.non_paying_adults || 0) : 0),

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
            bokunBookingReference ? bookingData.booking_reference : existing.booking_reference || incomingBookingReference || null,
          booking_created_at: shouldRefreshCreatedAt
            ? incomingEventDate
            : existing.booking_created_at || incomingEventDate,
          notes: finalNotes,
          was_modified: nextWasModified,
        };

        let updateQuery = supabaseServer
          .from("bookings")
          .update(updatePayload)
          .eq("id", existing.id);
        // A concurrent manual agreement must not be overwritten by stale economics.
        updateQuery = existing.agreed_unit_price == null
          ? updateQuery.is("agreed_unit_price", null)
          : updateQuery.eq("agreed_unit_price", existing.agreed_unit_price);
        if (bokunBookingReference) {
          updateQuery = updateQuery.eq("business_unit_id", businessUnitId)
            .eq("bokun_booking_reference", bokunBookingReference);
        }
        const { data: updated, error: updateError } = await updateQuery.select("id").maybeSingle();

        if (updateError) {
          throw new Error(updateError.message);
        }
        if (!updated) return NextResponse.json({ success: false, retryable: true,
          error: "Prezzo concordato modificato durante l'aggiornamento: ripetere l'evento." }, { status: 409 });

        actionResult = "updated";
      }
    } else {
      const { error: insertError } = await supabaseServer
        .from("bookings")
        .insert({
          ...bookingData,
          booking_reference: bokunBookingReference ? bookingData.booking_reference : incomingBookingReference,
          booking_created_at: incomingEventDate,
          notes: finalNotes,
          was_modified: false,
        });

      if (insertError) {
        // A concurrent delivery may win the unique-index race. Return a
        // retryable response instead of creating another row or overwriting it.
        if (bokunBookingReference && insertError.code === "23505") {
          const concurrentBooking = await findBokunBooking(supabaseServer, businessUnitId, bokunBookingReference, incomingBookingReferences);
          if (concurrentBooking) {
            return NextResponse.json({ success: false, retryable: true, error: "Conflitto di inserimento Bókun: ripetere lo stesso evento." }, { status: 409 });
          }
        }
        throw new Error(insertError.message);
      }

      actionResult = "created";
    }

    const finalOperation = isCancelled
      ? "CANCEL"
      : existing
        ? "UPDATE"
        : "INSERT";

    console.log("WEBHOOK FINAL OPERATION", {
      event_type: eventType,
      final_operation: finalOperation,
      action_result: actionResult,
      candidate_references: incomingBookingReferences,
      matched_reference: existingMatch?.matchedReference || null,
      used_heuristic_match: existingMatch?.usedHeuristicMatch || false,
      booking_id: existing?.id || null,
    });

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
    if (error instanceof BokunChannelError) {
      return NextResponse.json({
        success: false, updated_existing_booking: false,
        error: error.message, reason: "bokun_channel_conflict",
      }, { status: 409 });
    }
    if (error instanceof BokunIdentityError) {
      return NextResponse.json({ success: false, error: error.message, reason: "bokun_identity_required" }, { status: 409 });
    }
    console.error("Errore webhook prenotazioni:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
