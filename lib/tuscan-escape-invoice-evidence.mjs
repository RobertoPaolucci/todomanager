import { canonicalizeGoogleUid } from "./google-calendar-uid.mjs";
import { parseGoogleCalendarAttendance } from "./google-calendar-attendance.mjs";
import { matchGoogleCalendarIdentity, inspectGoogleCalendarStatus } from "./google-calendar-canonical-plan.mjs";

const reference = value => String(value ?? "").trim().toUpperCase();
// Same legacy reference encoding as the Google webhook. A truncated reference
// is accepted only if ALL matching rows resolve to one full scoped Google UID.
const googleReference = value => `GCAL-${String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
const identityKey = row => JSON.stringify([row.identity_namespace ?? "legacy_unscoped",
  canonicalizeGoogleUid(row.gcal_uid).canonicalUid, row.occurrence_id ?? null]);

/** Invoice evidence only: never changes parser, canonical, staging or bookings.
 * Stored canonical attendance is a historical cache (including old blocks).
 * Parse source titles; reject conflicting usable titles and cancellation evidence.
 */
export function resolveTuscanEscapeInvoiceEvidence(bookings, staging, events, aliases) {
  const result = new Map();
  for (const booking of bookings) {
    if (Number(booking.channel_id) !== 7 || booking.is_cancelled === true
      || Number(booking.adults ?? 0) + Number(booking.children ?? 0) !== 8
      || Number(booking.infants ?? 0) !== 0) continue;
    const ref = reference(booking.booking_reference);
    if (!ref.startsWith("GCAL-") || ref.length <= 5) continue;
    const matching = staging.filter(row => reference(googleReference(row.gcal_uid)) === ref);
    if (!matching.length || new Set(matching.map(identityKey)).size !== 1) continue;
    const source = matching[0];
    if (canonicalizeGoogleUid(source.gcal_uid).kind !== "google") continue;
    const identity = matchGoogleCalendarIdentity(source, events, aliases);
    if (identity.outcome !== "match") continue;
    const event = events.find(row => String(row.id) === String(identity.event_id));
    if (!event || event.event_date !== booking.booking_date
      || inspectGoogleCalendarStatus(event).value === "cancelled") continue;
    // Include every observation for this scoped identity, not just one linked
    // staging ID or a convenient observation from the selected month.
    const observations = staging.filter(row => identityKey(row) === identityKey(source));
    const parsed = observations.map(row => parseGoogleCalendarAttendance(row));
    if (observations.some(row => Number(row.channel_id) !== 7
      || row.booking_date !== booking.booking_date || row.import_status === "gcal_cancelled"
      || inspectGoogleCalendarStatus(row).value === "cancelled"
      || (row.imported_booking_id != null && String(row.imported_booking_id) !== String(booking.id)))) continue;
    if (parsed.some(value => value.attendance_quality !== "parsed"
      || value.effective_total_guests !== 8 || value.excluded_staff !== 1)) continue;
    const canonicalTitle = parseGoogleCalendarAttendance(event);
    if (canonicalTitle.attendance_quality === "parsed" && canonicalTitle.event_classification === "customer_event"
      && (canonicalTitle.effective_total_guests !== 8 || canonicalTitle.excluded_staff !== 1)) continue;
    result.set(String(booking.id), {
      effective_total_guests: 8, excluded_staff: 1, attendance_quality: "parsed",
    });
  }
  return result;
}
