import { parseGoogleCalendarAttendance } from "./google-calendar-attendance.mjs";
import { canonicalizeGoogleUid } from "./google-calendar-uid.mjs";
import { inspectGoogleTimestamp, inspectManualAttendanceProtection } from "./google-calendar-observation.mjs";

const time = value => String(value ?? "").slice(0, 5);
const reference = value => String(value ?? "").trim().toUpperCase();
const generatedReference = value => reference(`GCAL-${String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`);
const moneyFields = ["your_unit_price", "supplier_unit_cost", "public_unit_price", "total_to_you",
  "total_supplier_cost", "total_customer", "total_amount", "margin_total"];
const review = reason => ({ action: "needs_review", review_reasons: [reason], values: null });

/** Pure, deliberately narrow policy. No inference from customer/channel alone,
 * no historical pricing repair, no manual/paid/agreed bookings or reactivation.
 * rateForAttendance is the existing effectiveFmdqInvoiceRates policy, injected
 * by the server so the same rule (including 8 clients at EUR36) is reused.
 */
export function planTuscanBookingReconciliation({ previous, incoming, canonical, booking, bookings,
  observations, experience, price, invoices, rateForAttendance }) {
  if (Number(incoming.channel_id) !== 7 || !previous?.imported_booking_id) return { action: "not_applicable", values: null };
  const attendance = parseGoogleCalendarAttendance(incoming);
  if (attendance.event_classification === "operational_block") return review("operational_block_unchanged");
  if (!/^\d+\s+pranzo\s+tuscan\s+escape\s*$/i.test(String(incoming.original_title ?? "").trim())
    || attendance.activity !== "tuscan_escape_lunch" || attendance.attendance_quality !== "parsed"
    || attendance.effective_total_guests < 1 || attendance.excluded_staff !== 1) return review("ambiguous_tuscan_lunch");
  if (!canonical || !inspectGoogleTimestamp(canonical.current).verified
    || !inspectGoogleTimestamp(canonical.previous).verified) return review("unverified_google_chronology");
  const current = canonical.current;
  if (inspectManualAttendanceProtection(current).protected || inspectManualAttendanceProtection(canonical.previous).protected)
    return review("manual_attendance_approval_required");
  if (!inspectManualAttendanceProtection(current).automatic_reparse_allowed
    || !inspectManualAttendanceProtection(canonical.previous).automatic_reparse_allowed) return review("unrecognized_attendance_provenance");
  if (current.gcal_event_status !== "confirmed" || canonical.previous.gcal_event_status !== "confirmed"
    || previous.import_status === "gcal_cancelled" || booking?.is_cancelled !== false) return review("cancellation_or_reactivation_requires_review");
  const uid = canonicalizeGoogleUid(incoming.gcal_uid);
  if (uid.kind !== "google" || uid.canonicalUid !== current.canonical_uid
    || current.identity_namespace !== "legacy_unscoped" || current.occurrence_id != null
    || previous.gcal_uid !== incoming.gcal_uid || generatedReference(incoming.gcal_uid) !== reference(incoming.booking_reference)
    || reference(previous.booking_reference) !== reference(incoming.booking_reference)
    || booking?.id !== previous.imported_booking_id
    || reference(booking.booking_reference) !== reference(incoming.booking_reference)
    || bookings.filter(row => reference(row.booking_reference) === reference(incoming.booking_reference)).length !== 1
    || observations.some(row => (reference(row.booking_reference) === reference(incoming.booking_reference)
      || row.imported_booking_id === booking.id
      || canonicalizeGoogleUid(row.gcal_uid).canonicalUid === uid.canonicalUid) && row.id !== previous.id)) return review("conflicting_booking_identity");
  if (current.original_title !== incoming.original_title || current.event_date !== incoming.booking_date
    || time(current.event_time) !== time(incoming.booking_time)
    || Date.parse(current.gcal_updated_at) !== Date.parse(incoming.gcal_updated_at)
    || current.effective_total_guests !== attendance.effective_total_guests
    || current.observed_total_guests !== attendance.observed_total_guests
    || current.event_classification !== "customer_event" || current.attendance_quality !== "parsed") return review("canonical_observation_mismatch");
  if (booking.was_modified !== false || booking.agreed_unit_price != null || booking.total_to_you_source != null
    || booking.recovery_tag != null || booking.bokun_booking_reference != null
    || booking.customer_phone != null || booking.customer_email != null
    || !["Tuscan", "Tuscan Escape"].includes(booking.customer_name)
    || booking.booking_source !== "Tuscan Escape" || booking.channel_id !== 7
    || booking.business_unit_id !== 1 || booking.supplier_id !== 3
    || booking.customer_payment_status !== "pending" || booking.supplier_payment_status !== "pending"
    || Number(booking.supplier_amount_paid) !== 0 || booking.cancelled_at != null) return review("manual_or_financial_changes");
  const months = new Set([booking.booking_date.slice(0, 7), incoming.booking_date.slice(0, 7)]);
  if (invoices.some(row => months.has(String(row.invoice_month).slice(0, 7)))) return review("invoice_requires_review");
  if (experience?.id !== 7 || experience.supplier_id !== 3 || experience.is_group_pricing !== false
    || Number(price?.your_unit_price) !== 38 || Number(price?.supplier_adult_unit_cost) !== 38
    || Number(price?.public_unit_price) !== 0 || Number(experience.supplier_unit_cost) !== 38) return review("unverified_tuscan_rates");
  const clients = attendance.effective_total_guests;
  const rate = rateForAttendance(attendance);
  if (rate !== (clients === 8 ? 36 : 38)) return review("unexpected_tuscan_rate");
  const values = { experience_id: 7, experience_name: experience.name, adults: clients, children: 0, infants: 0,
    non_paying_adults: 1, total_people: clients + 1, pax: clients, booking_date: incoming.booking_date,
    booking_time: time(incoming.booking_time), notes: incoming.original_title,
    your_unit_price: rate, supplier_unit_cost: rate, public_unit_price: 0,
    total_to_you: rate * clients, total_supplier_cost: rate * clients, total_customer: 0, total_amount: 0, margin_total: 0 };
  const same = Object.entries(values).every(([field, value]) => field === "booking_time"
    ? time(booking[field]) === value : booking[field] === value);
  if (same) return { action: "unchanged", review_reasons: [], values };
  // A previous verified canonical and the booking must describe the exact same
  // old source. Even unflagged manual changes fail these structural guards.
  const old = parseGoogleCalendarAttendance(canonical.previous);
  const block = old.event_classification === "operational_block";
  const oldClients = block ? 1 : old.effective_total_guests;
  const oldRate = block ? 0 : rateForAttendance(old);
  if ((!block && (old.activity !== "tuscan_escape_lunch" || old.attendance_quality !== "parsed"))
    || booking.notes !== canonical.previous.original_title || booking.booking_date !== canonical.previous.event_date
    || time(booking.booking_time) !== time(canonical.previous.event_time)
    || booking.experience_id !== (block ? 22 : 7)
    || booking.experience_name !== (block ? "Tuscan Escape - Blocco data" : experience.name) || booking.adults !== oldClients
    || booking.children !== 0 || booking.infants !== 0 || booking.non_paying_adults !== (block ? 0 : 1)
    || booking.total_people !== (block ? 1 : oldClients + 1) || booking.pax !== oldClients
    || moneyFields.some(field => booking[field] !== ({ your_unit_price: oldRate, supplier_unit_cost: oldRate,
      total_to_you: oldRate * oldClients, total_supplier_cost: oldRate * oldClients }[field] ?? 0))) return review("booking_differs_from_verified_source");
  return { action: "safe_update", review_reasons: [], values };
}

async function readAll(db, table) {
  const rows = [];
  let last = 0;
  for (;;) {
    const { data, error } = await db.from(table).select("*").gt("id", last).order("id").limit(500);
    if (error) throw new Error("reconciliation_read_failed");
    if (!data?.length) return rows;
    rows.push(...data);
    last = data.at(-1).id;
  }
}

/** Only the transactional RPC can write bookings. Missing RPC/schema, read
 * errors and concurrent edits all leave the existing staging link in review.
 */
export async function reconcileTuscanBooking(db, { previous, incoming, canonical, rateForAttendance }) {
  if (!previous?.imported_booking_id || Number(incoming.channel_id) !== 7) return { action: "not_applicable", values: null };
  if (!canonical) return review("unverified_google_chronology");
  try {
    const [bookings, observations, experiences, prices, invoices] = await Promise.all(
      ["bookings", "google_calendar_import_staging", "experiences", "experience_channel_prices", "fmdq_monthly_invoices"]
        .map(table => readAll(db, table)));
    const booking = bookings.find(row => row.id === previous.imported_booking_id);
    const staging = observations.find(row => row.id === previous.id);
    const plan = planTuscanBookingReconciliation({ previous, incoming, canonical, booking, bookings, observations,
      experience: experiences.find(row => row.id === 7), price: prices.find(row => row.experience_id === 7 && row.channel_id === 7),
      invoices: invoices.filter(row => row.channel_id === 7), rateForAttendance });
    if (!["safe_update", "unchanged"].includes(plan.action)) return plan;
    // The selected staging snapshot must still be the observation just written.
    if (!staging || Object.entries(incoming).some(([field, value]) => field === "booking_time"
      ? time(staging[field]) !== time(value) : field === "gcal_updated_at"
        ? Date.parse(staging[field]) !== Date.parse(value) : staging[field] !== value)) return review("concurrent_staging_change");
    const { data, error } = await db.rpc("reconcile_tuscan_google_booking", {
      expected_booking: booking, expected_staging: staging, expected_canonical: canonical.current, proposed: plan.values,
    });
    if (error || data !== true) return review("transaction_unavailable_or_concurrent_change");
    return { ...plan, action: plan.action === "unchanged" ? "unchanged" : "updated" };
  } catch {
    return review("reconciliation_unavailable");
  }
}
