import type { SupabaseClient } from "@supabase/supabase-js";

const text = (value: unknown) => String(value ?? "").trim();

export class BokunIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BokunIdentityError";
  }
}

// The cart/booking reference identifies the booking. A product code or a
// reference mentioned in rebooking notes must never be used as the cart code.
export function getBokunBookingReference(body: Record<string, unknown>) {
  const values = [
    body.bokun_booking_reference,
    body.bokunBookingReference,
    body.bookingConfirmationCode,
    body.booking_confirmation_code,
    body.confirmationCode,
    body.cartConfirmationCode,
    body.cart_confirmation_code,
    body["Booking ref"],
    body["Bókun Booking ref"],
    body["Cart confirmation code"],
    /^GET-\d+$/i.test(text(body.booking_reference)) ? body.booking_reference : null,
  ].map(text).filter(Boolean).map(value => value.toUpperCase());
  const refs = [...new Set(values)];
  if (refs.length > 1) {
    throw new BokunIdentityError("Riferimenti booking Bókun discordanti nel payload.");
  }
  const ref = refs[0] || "";
  if (ref && (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(ref) || /^TOD-T\d+$/.test(ref))) {
    throw new BokunIdentityError("Booking ref Bókun non valido: inviare il riferimento booking, non quello prodotto.");
  }
  return ref;
}

export function hasGetYourGuideReference(...values: unknown[]) {
  return values.some(value => /^GYG[A-Z0-9]+$/i.test(text(value)));
}

export function requireBokunIdentityForGYG(bokunReference: string, isGetYourGuide: boolean) {
  if (isGetYourGuide && !bokunReference) {
    throw new BokunIdentityError(
      "Booking ref Bókun mancante per GetYourGuide: inviare bokun_booking_reference (GET-...). Il solo riferimento GYG non distingue i rebooking."
    );
  }
}

export function requireBokunBusinessUnit(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BokunIdentityError("Business unit Bokun mancante o non valida: nessun abbinamento consentito.");
  }
  return id;
}

export async function findBokunBooking(
  db: SupabaseClient,
  businessUnitId: number,
  bokunReference: string,
  legacyReferences: string[],
) {
  const unit = requireBokunBusinessUnit(businessUnitId);
  const { data, error } = await db.from("bookings").select("*")
    .eq("business_unit_id", unit)
    .eq("bokun_booking_reference", bokunReference).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  // No automatic historical backfill: an external ref alone cannot establish
  // whether a legacy row belongs to this booking or its cancelled predecessor.
  const refs = [...new Set([...legacyReferences, bokunReference].filter(Boolean))];
  const { data: legacy, error: legacyError } = await db.from("bookings")
    .select("id").eq("business_unit_id", unit).in("booking_reference", refs)
    .is("bokun_booking_reference", null).limit(1);
  if (legacyError) throw new Error(legacyError.message);
  if (legacy?.length) {
    throw new BokunIdentityError(
      `Identità Bókun da riconciliare sulla prenotazione storica ${legacy[0].id}. Nessuna riga modificata: associare il suo Booking ref verificato prima di ripetere l'importazione.`
    );
  }
  return null;
}

export function getBookingHistoryIdentity(booking: {
  id: unknown;
  business_unit_id?: number | null;
  booking_reference?: string | null;
  bokun_booking_reference?: string | null;
}) {
  const bokun = text(booking.bokun_booking_reference).toUpperCase();
  if (bokun) {
    const unit = Number(booking.business_unit_id);
    return Number.isSafeInteger(unit) && unit > 0
      ? `BOKUN:${unit}:${bokun}`
      : `BOKUN:UNSCOPED:${booking.id}`;
  }
  return text(booking.booking_reference).toUpperCase() || `NO-REF-${booking.id}`;
}
