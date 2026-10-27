const text = value => String(value ?? "").trim().replace(/\s+/g, " ");
const key = value => text(value).toUpperCase();

export function extractAirbnbBookingData(title) {
  const tail = text(title).match(/\bairbnb\s+(.+)$/i)?.[1];
  if (!tail) return { bookingReference: null, customerName: null };
  const [candidate, ...name] = tail.split(" ");
  // Conservative local syntax: alphabetic names and numeric phone numbers are
  // never identities. Ambiguous/all-letter provider codes need manual review.
  const code = /^[A-Z0-9]{6,20}$/i.test(candidate) && /[A-Z]/i.test(candidate) && /\d/.test(candidate);
  return { bookingReference: code ? key(candidate) : null,
    customerName: code ? name.join(" ") || null : tail };
}

/** A link is evidence to review, never proof of a reschedule by itself. */
export function inspectBookingLink(incoming, booking, previous = null) {
  if (!booking) return { compatible: false, kind: "missing_booking", reasons: ["missing_booking"] };
  const reasons = [];
  if (booking.is_cancelled !== false) reasons.push("cancelled_or_unknown_booking_status");
  for (const field of ["booking_date", "booking_reference", "experience_id", "channel_id", "adults", "children", "infants"]) {
    if (key(incoming[field]) !== key(booking[field])) reasons.push(field);
  }
  if (text(incoming.booking_time).slice(0, 5) !== text(booking.booking_time).slice(0, 5)) reasons.push("booking_time");
  if (incoming.customer_name && key(incoming.customer_name) !== key(booking.customer_name)) reasons.push("customer_name");
  const sameEvent = previous?.gcal_uid && previous.gcal_uid === incoming.gcal_uid;
  const changedEvent = previous?.gcal_uid && previous.gcal_uid !== incoming.gcal_uid;
  return { compatible: reasons.length === 0 && !changedEvent,
    kind: changedEvent ? "different_event_requires_review" : reasons.length === 0 ? "compatible"
      : sameEvent && reasons.every(reason => ["booking_date", "booking_time"].includes(reason))
        ? "possible_reschedule_requires_confirmation" : "incompatible_booking_requires_review",
    reasons: changedEvent ? [...reasons, "different_google_event"] : reasons };
}

/** Preserve an existing Airbnb identity, never discover a booking by name.
 * The stored link AND real provider reference must already agree. A Google
 * title without a code is missing evidence, not a replacement provider code.
 */
export function preserveAirbnbStagingLink(incoming, booking, previous, canonical) {
  const sameLink = booking && previous?.imported_booking_id === booking.id
    && previous.gcal_uid === incoming.gcal_uid
    && key(previous.booking_source) === "AIRBNB" && key(incoming.booking_source) === "AIRBNB"
    && key(booking.booking_source) === "AIRBNB"
    && previous.channel_id === booking.channel_id && incoming.channel_id === booking.channel_id
    && key(previous.booking_reference) === key(booking.booking_reference)
    && extractAirbnbBookingData(`Airbnb ${booking.booking_reference}`).bookingReference === key(booking.booking_reference);
  if (!sameLink) return incoming;

  const explicitReference = extractAirbnbBookingData(incoming.original_title).bookingReference;
  const resolved = { ...incoming };
  if (!explicitReference && String(incoming.booking_reference).startsWith("GCAL-")) {
    resolved.booking_reference = booking.booking_reference;
  }
  const compatible = inspectBookingLink(resolved, booking, previous).compatible;
  const sameContent = inspectBookingLink(resolved, { ...previous, is_cancelled: false }, previous).compatible
    && text(resolved.original_title) === text(previous.original_title);
  const verified = canonical?.gcal_observation_verified === true
    && canonical.gcal_event_status === "confirmed"
    && canonical.event_date === resolved.booking_date
    && text(canonical.event_time).slice(0, 5) === text(resolved.booking_time).slice(0, 5)
    && text(canonical.original_title) === text(resolved.original_title)
    && Number.isFinite(Date.parse(resolved.gcal_updated_at))
    && Date.parse(canonical.gcal_updated_at) === Date.parse(resolved.gcal_updated_at);
  resolved.import_status = compatible && sameContent && verified
    && ["imported", "already_exists"].includes(previous.import_status)
    ? previous.import_status : "needs_review";
  return resolved;
}

/** Preserve only an already reviewed FMDQ Viator identity. Google remains the
 * source of observations; a new reference/date/count still requires review. */
export function preserveViatorStagingLink(incoming, booking, previous) {
  if (booking?.business_unit_id !== 1 || booking.channel_id !== 2 || booking.bokun_booking_reference
    || previous?.imported_booking_id !== booking.id || previous.channel_id !== 2
    || key(previous.booking_source) !== "VIATOR" || previous.gcal_uid !== incoming.gcal_uid
    || key(previous.booking_reference) !== key(booking.booking_reference)
    || !/^BR-\d+$/.test(key(booking.booking_reference))) return incoming;
  const number = key(booking.booking_reference).slice(3);
  const sameReference = new RegExp(`(^|[^A-Z0-9])(?:BR-)?${number}([^A-Z0-9]|$)`, "i")
    .test(incoming.original_title ?? "");
  if (!sameReference || ![2, 6].includes(incoming.channel_id)) return { ...incoming, import_status: "needs_review" };
  const resolved = { ...incoming, channel_id: 2, booking_source: "Viator",
    booking_reference: booking.booking_reference, customer_name: booking.customer_name };
  resolved.import_status = inspectBookingLink(resolved, booking, previous).compatible
    && text(incoming.original_title) === text(previous.original_title)
    && ["imported", "already_exists"].includes(previous.import_status) ? previous.import_status : "needs_review";
  return resolved;
}
