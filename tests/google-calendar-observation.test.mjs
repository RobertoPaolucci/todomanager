import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleCalendarObservation as normalize, inspectGoogleTimestamp,
  inspectManualAttendanceProtection, googleTimestamp } from "../lib/google-calendar-observation.mjs";
import { planGoogleCalendarObservation as plan, planGoogleCalendarSync as batch,
  resolveGoogleCalendarPrecedence as precedence } from "../lib/google-calendar-canonical-plan.mjs";

const older = "2026-09-01T10:00:00Z";
const newer = "2026-09-02T10:00:00Z";
function metadata(updated = newer, status = "confirmed", id = "event-a") {
  return normalize({ id, status, updated }, { receivedAt: "2026-09-03T10:00:00Z", sourceVerified: true });
}
function current(overrides = {}) {
  return { id: 1, canonical_uid: "event-a", original_uid: "event-a", identity_namespace: "legacy_unscoped",
    event_date: "2026-09-10", event_time: "12:00:00", original_title: "2 pranzo",
    observed_total_guests: 2, effective_total_guests: 2, event_classification: "customer_event",
    attendance_source: "google_title", attendance_quality: "parsed", attendance_parser_version: "old-parser-v0",
    gcal_event_status: "confirmed", gcal_updated_at: older, google_observation: metadata(older),
    historical_total_guests: 5, historical_booking_id: 999, historical_source: "google_calendar_ics",
    ...overrides };
}
function incoming(overrides = {}) {
  return { id: 20, gcal_uid: "event-a", booking_date: "2026-09-10", booking_time: "12:00:00",
    original_title: "3 pranzo", google_observation: metadata(), ...overrides };
}

test("normalization separates real Google fields and never invents confirmed/updated or leaks arbitrary payload fields", () => {
  const payload = { id: "event-a", uid: "not-an-event-id", status: "tentative", updated: newer,
    iCalUID: "series@google.com", recurringEventId: "series-resource", sequence: 0, etag: '"etag"',
    originalStartTime: { dateTime: "2026-09-10T12:00:00+02:00", timeZone: "Europe/Rome" }, secret: "hidden" };
  const before = structuredClone(payload);
  const result = normalize(payload, { receivedAt: "2026-09-03T10:00:00Z", sourceVerified: true });
  assert.equal(result.googleStatus, "tentative");
  assert.equal(result.googleICalUid, "series@google.com");
  assert.equal(result.googleEventId, "event-a");
  assert.equal(result.originalStartAt, "2026-09-10T10:00:00.000Z");
  assert.equal(result.sequence, 0);
  assert.ok(!JSON.stringify(result).includes("hidden"));
  assert.deepEqual(payload, before);
  const missing = normalize({ uid: "opaque", import_status: "imported" }, { receivedAt: newer });
  assert.equal(missing.googleStatus, null);
  assert.equal(missing.googleUpdatedAt, null);
  assert.equal(missing.googleEventId, null);
  assert.equal(inspectGoogleTimestamp({ google_observation: missing }).verified, false);
});
test("dates, timestamp provenance, original occurrence and conflicting IDs fail closed", () => {
  for (const value of [null, "2026-09-01", "2026-09-01T12:00:00", "2026-02-30T12:00:00Z", "2026-09-01T12:00:00.1234Z"]) assert.equal(googleTimestamp(value), null);
  assert.equal(normalize({ originalStartTime: { date: "2026-09-10" } }).originalStartDate, "2026-09-10");
  assert.equal(normalize({ originalStartTime: { date: "2026-02-30" } }).originalStartDate, null);
  const conflict = normalize({ id: "one", event_id: "two", originalStartTime: { date: "2026-09-10", dateTime: newer } });
  assert.equal(conflict.googleEventId, null);
  assert.equal(conflict.originalStartAt, null);
  assert.ok(conflict.warnings.includes("conflicting_google_event_ids"));
  assert.equal(inspectGoogleTimestamp({ gcal_updated_at: older, import_origin: "make" }).verified, false);
  assert.equal(inspectGoogleTimestamp({ google_observation: normalize({ updated: older }) }).verified, false);
  assert.equal(inspectGoogleTimestamp({ gcal_updated_at: older, google_observation: metadata(newer) }).verified, false);
});
test("verified Google timestamp wins regardless of staging ID, creation or reception order", () => {
  const oldRow = incoming({ id: 9999, original_title: "2 pranzo", google_observation: metadata(older) });
  const newRow = incoming({ id: 1, created_at: "2000-01-01", google_observation: metadata(newer) });
  const results = batch([oldRow, newRow], [current()], []);
  assert.equal(results[0].action, "stale_observation");
  assert.deepEqual(results[0].eligible_differences, {});
  assert.equal(results[1].action, "safe_update");
  assert.equal(results[1].proposed.effective_total_guests, 3);
  assert.deepEqual(batch([newRow, oldRow], [current()], []).reverse(), results);
});
test("missing/unverified timestamp cannot defeat a certain version or cause arbitrary winner selection", () => {
  const rows = [incoming(), incoming({ id: 9999, original_title: "5 pranzo", google_observation: undefined, gcal_updated_at: "2099-01-01T00:00:00Z" })];
  const results = batch(rows, [current()], []);
  assert.ok(results.every(result => !result.eligible_for_sync && result.proposed.effective_total_guests === 2));
  assert.ok(results.every(result => result.precedence.role === "unproven"));
  const result = plan(incoming(), [current({ google_observation: undefined })]);
  assert.equal(result.action, "needs_review");
});
test("equal timestamps with different content/status are conflicts, even if etag/sequence differ", () => {
  for (const second of [incoming({ original_title: "8 pranzo" }), incoming({ google_observation: { ...metadata(newer, "cancelled"), sequence: 9, etag: "other" } })]) {
    const results = batch([incoming(), second], [current()], []);
    assert.ok(results.every(result => result.action === "equal_timestamp_conflict" && !result.eligible_for_sync));
  }
  assert.equal(plan(incoming({ google_observation: metadata(older) }), [current()]).action, "equal_timestamp_conflict");
});
test("equal identical observations coalesce without assigning one arbitrary staging_id", () => {
  const rows = [incoming(), incoming({ id: 999, import_status: "ignored", booking_reference: "different" })];
  assert.ok(precedence(rows).every(result => result.role === "selected" && result.equivalent_count === 2));
  const results = batch(rows, [current({ staging_id: 7 })], []);
  assert.ok(results.every(result => result.action === "safe_update" && result.proposed.staging_id === 7));
});
test("verified cancellation changes state without zeroing or reparsing known attendance", () => {
  const result = plan(incoming({ original_title: "Tuscan Escape", google_observation: metadata(newer, "cancelled") }), [current()]);
  assert.equal(result.action, "safe_update");
  assert.equal(result.proposed.gcal_event_status, "cancelled");
  assert.equal(result.proposed.effective_total_guests, 2);
  assert.equal(result.proposed.observed_total_guests, 2);
  assert.equal(result.eligible_differences.effective_total_guests, undefined);
});
test("newer confirmed reactivates same Google identity; older late cancellation is stale", () => {
  const cancelled = current({ gcal_event_status: "cancelled", google_observation: metadata(older, "cancelled") });
  const result = plan(incoming(), [cancelled]);
  assert.equal(result.identity.event_id, 1);
  assert.equal(result.action, "safe_update");
  assert.equal(result.proposed.gcal_event_status, "confirmed");
  const oldCancellation = plan(incoming({ google_observation: metadata(older, "cancelled") }), [result.proposed]);
  assert.equal(oldCancellation.action, "stale_observation");
  assert.equal(oldCancellation.proposed.gcal_event_status, "confirmed");
});
test("minimal cancellation replay is idempotent and does not erase attendance/date/title", () => {
  const row = { id: 20, gcal_uid: "event-a", google_observation: metadata(newer, "cancelled") };
  const first = plan(row, [current()]);
  assert.equal(first.action, "safe_update");
  assert.equal(first.proposed.effective_total_guests, 2);
  assert.equal(first.proposed.event_date, "2026-09-10");
  const replay = plan(row, [first.proposed]);
  assert.equal(replay.action, "safe_update");
  assert.deepEqual(replay.eligible_differences, {});
});
test("missing Google status blocks state and presence changes; import flags never supply it", () => {
  for (const import_status of ["ignored", "already_exists", "needs_review", "imported", "gcal_cancelled"]) {
    const result = plan(incoming({ import_status, google_observation: metadata(newer, undefined) }), [current()]);
    // Use an actually absent status; metadata() defaults only for test fixtures.
    const absent = plan(incoming({ import_status, google_observation: normalize({ id: "event-a", updated: newer }, { sourceVerified: true }) }), [current()]);
    assert.equal(absent.status.knowledge, "unknown");
    assert.equal(absent.action, "needs_review");
    assert.deepEqual(absent.eligible_differences, {});
    assert.ok(result); // regular known payload is independent of import_status
  }
});
test("same booking reference with a new UID is a new event, never a reactivation of the old one", () => {
  const result = plan(incoming({ gcal_uid: "new-id", booking_reference: "shared", google_observation: metadata(newer, "confirmed", "new-id") }), [current({ booking_reference: "shared", gcal_event_status: "cancelled" })]);
  assert.equal(result.action, "new");
  assert.equal(result.identity.event_id, undefined);
  assert.equal(result.proposed.historical_total_guests, null);
});
test("conflicting payload event ID cannot authorize a state change on the staging identity", () => {
  const result = plan(incoming({ google_observation: metadata(newer, "cancelled", "another-event") }), [current()]);
  assert.equal(result.action, "ambiguous");
  assert.equal(result.proposed, null);
});
test("historical alone is not a manual override; old automatic parser can advance on a verified newer version", () => {
  const old = current({ attendance_source: "historical", attendance_quality: "historical_reference" });
  assert.equal(inspectManualAttendanceProtection(old).protected, false);
  const result = plan(incoming(), [old]);
  assert.equal(result.action, "safe_update");
  assert.equal(result.proposed.effective_total_guests, 3);
  assert.equal(result.proposed.historical_total_guests, 5);
});
test("manual-review protects effective/classification/provenance while newer reliable evidence updates observed only", () => {
  const old = current({ attendance_source: "historical", attendance_quality: "historical_reference",
    attendance_parser_version: "old-parser+manual-review-20260917" });
  const before = structuredClone(old);
  const result = plan(incoming(), [old]);
  assert.equal(result.action, "manual_override_protected");
  assert.equal(result.proposed.effective_total_guests, 2);
  assert.equal(result.proposed.observed_total_guests, 3);
  assert.equal(result.proposed.attendance_parser_version, old.attendance_parser_version);
  assert.equal(result.proposed.attendance_source, old.attendance_source);
  assert.equal(result.proposed.historical_total_guests, 5);
  assert.ok(result.requires_review);
  assert.equal(result.protected_differences.effective_total_guests.after, 3);
  assert.equal(result.eligible_differences.effective_total_guests, undefined);
  const replay = plan(incoming(), [result.proposed]);
  assert.equal(replay.protection.protected, true);
  assert.equal(replay.proposed.effective_total_guests, 2);
  assert.deepEqual(old, before);
});
test("manual approvals survive NULL parsing, cancellation and untrusted newer-looking timestamps", () => {
  const old = current({ attendance_parser_version: "v1+manual-review-20260917" });
  for (const row of [incoming({ original_title: "2 ebike villa svetoni" }), incoming({ google_observation: undefined, gcal_updated_at: newer })]) {
    const result = plan(row, [old]);
    assert.equal(result.action, "manual_override_protected");
    assert.equal(result.proposed.effective_total_guests, 2);
    assert.deepEqual(result.eligible_differences, {});
  }
  const cancel = plan(incoming({ google_observation: metadata(newer, "cancelled") }), [old]);
  assert.equal(cancel.proposed.gcal_event_status, "cancelled");
  assert.equal(cancel.proposed.effective_total_guests, 2);
});
