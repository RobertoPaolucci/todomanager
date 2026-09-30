import test from "node:test";
import assert from "node:assert/strict";
import { matchGoogleCalendarIdentity as match, planGoogleCalendarObservation as plan,
  planGoogleCalendarSync, inspectGoogleCalendarStatus as status } from "../lib/google-calendar-canonical-plan.mjs";

const plain = "569b4a1925014716a1262afe926cd13e";
const encoded = "_6kr3iohkc4ojichl60oj8dph6pgj2chm69gmcp9p68r66p1h6dig";
const event = (overrides = {}) => ({ id: 1, identity_namespace: "legacy_unscoped", canonical_uid: plain,
  original_uid: plain, occurrence_id: null, original_title: "2 pranzo", event_date: "2026-09-01",
  effective_total_guests: 2, historical_total_guests: 9, historical_booking_id: 17,
  historical_source: "google_calendar_ics", historical_snapshot_at: "2026-08-01T00:00:00Z", gcal_event_status: "unknown", ...overrides });
const observation = (overrides = {}) => ({ id: 40, gcal_uid: plain, original_title: "2 pranzo", booking_date: "2026-09-01", ...overrides });
const alias = (overrides = {}) => ({ event_id: 1, identity_namespace: "legacy_unscoped", occurrence_id: null,
  original_uid: "verified-alternate", canonical_uid: plain, verified: true, ...overrides });

test("plain and base32hex converge, in both directions", () => {
  assert.equal(match(observation({ gcal_uid: encoded }), [event()]).event_id, 1);
  assert.equal(match(observation(), [event({ canonical_uid: encoded, original_uid: encoded })]).event_id, 1);
});
test("verified alias resolves; conflicting, dangling and unverified aliases never select an arbitrary event", () => {
  assert.equal(match(observation({ gcal_uid: "verified-alternate" }), [event()], [alias()]).event_id, 1);
  const other = event({ id: 2, canonical_uid: "other", original_uid: "other" });
  const conflict = [alias({ original_uid: plain, event_id: 2, canonical_uid: "other" })];
  assert.equal(match(observation(), [event(), other], conflict).outcome, "ambiguous");
  assert.equal(match(observation({ gcal_uid: "verified-alternate" }), [event()], [alias(), alias({ event_id: 2, canonical_uid: "other" })]).outcome, "ambiguous");
  for (const a of [alias({ verified: false }), alias({ event_id: 999 }), alias({ canonical_uid: "wrong" })]) {
    assert.equal(match(observation({ gcal_uid: "verified-alternate" }), [event()], [a]).outcome, "ambiguous");
  }
});
test("conflicting raw/canonical UIDs and duplicate canonical evidence are ambiguous", () => {
  assert.equal(match(observation({ canonical_uid: "other" }), [event(), event({ id: 2, canonical_uid: "other" })]).outcome, "ambiguous");
  assert.equal(match(observation({ canonical_uid: "unmatched" }), [event()]).outcome, "ambiguous");
  assert.equal(match(observation(), [event(), event({ id: 2 })]).outcome, "ambiguous");
});
test("same booking reference, title, date or staging provenance never merges different UIDs", () => {
  const existing = event({ booking_reference: "SAME", staging_id: 40 });
  assert.equal(match(observation({ gcal_uid: "different", booking_reference: "SAME" }), [existing]).outcome, "new");
  assert.equal(match(observation({ gcal_uid: null, booking_reference: "SAME" }), [existing]).outcome, "insufficient_identity");
});
test("missing identity, calendars and occurrence scopes fail closed", () => {
  assert.equal(match(observation({ gcal_uid: " " }), [event()]).outcome, "insufficient_identity");
  assert.equal(match(observation({ uid_semantics: "ical_uid" }), [event()]).outcome, "insufficient_identity");
  assert.equal(match(observation({ occurrence_id: "date:2026-09-01" }), [event()]).outcome, "insufficient_identity");
  assert.equal(match(observation({ identity_namespace: "calendar:other" }), [event()]).outcome, "new");
  assert.equal(match(observation({ calendar_id: "enriched-calendar" }), [event()]).outcome, "match");
  assert.equal(match(observation({ gcal_uid: "manual-gcal-unresolved" }), []).outcome, "insufficient_identity");
});
test("move date and preserve ALL historical fields; functions do not mutate inputs", () => {
  const current = event({ historical_future_field: { nested: 7 } });
  const incoming = observation({ booking_date: "2026-10-10", original_title: "9 pranzo Tuscan Escape", historical_total_guests: 0 });
  const before = structuredClone({ current, incoming });
  const result = plan(incoming, [current]);
  assert.equal(result.identity.event_id, 1);
  assert.equal(result.proposed.event_date, "2026-10-10");
  assert.equal(result.proposed.effective_total_guests, 8);
  for (const field of Object.keys(current).filter(key => key.startsWith("historical_"))) assert.deepEqual(result.proposed[field], current[field]);
  assert.deepEqual({ current, incoming }, before);
});
test("verified iCalUID occurrence matches only its immutable scope even when date changes", () => {
  const current = event({ canonical_uid: "series", original_uid: "series", gcal_ical_uid: "series",
    uid_semantics: "ical_uid", occurrence_id: "date:2026-09-01" });
  const incoming = { gcal_ical_uid: "series", uid_semantics: "ical_uid", occurrence_id: "date:2026-09-01", booking_date: "2026-10-10" };
  assert.equal(match(incoming, [current]).event_id, 1);
  assert.equal(match({ ...incoming, occurrence_id: "date:2026-09-02" }, [current]).outcome, "new");
  assert.equal(match({ ...incoming, occurrence_id: null }, [current]).outcome, "insufficient_identity");
});
test("identical replay has no differences, independent of workflow state", () => {
  const input = observation();
  const first = plan(input, [event()]);
  const replay = plan(input, [first.proposed]);
  assert.equal(replay.identity.outcome, "match");
  assert.deepEqual(replay.differences, {});
  assert.deepEqual(first, plan(input, [event()]));
});
test("ambiguous or insufficient identity yields no projection", () => {
  assert.equal(plan(observation({ gcal_uid: null }), [event()]).proposed, null);
  assert.equal(plan(observation(), [event(), event({ id: 2 })]).proposed, null);
});
test("workflow states are never Google confirmation/cancellation; retained historical state is explicit", () => {
  for (const import_status of ["ignored", "imported", "needs_review", "pending", "already_exists"]) {
    assert.equal(status({ import_status }).certainty, "unproven");
    const result = plan(observation({ import_status }), [event({ gcal_event_status: "cancelled" })]);
    assert.equal(result.status.value, null);
    assert.equal(result.proposed.gcal_event_status, "cancelled");
    assert.equal(result.retained_status, "cancelled");
    assert.ok(result.requires_review);
  }
  assert.equal(status({ status: "confirmed" }).certainty, "unproven");
});
test("explicit payload status and persisted cancellation markers have named provenance", () => {
  for (const value of ["confirmed", "tentative", "cancelled"]) assert.equal(status({ gcal_event_status: value }).value, value);
  assert.equal(status({ gcal_event_status: "canceled" }).value, "cancelled");
  assert.equal(status({ import_status: "gcal_cancelled" }).value, "cancelled");
  assert.equal(status({ import_status: "ignored", notes: "🔴 Evento cancellato da Google Calendar\n4 pranzo" }).value, "cancelled");
  assert.equal(status({ notes: "cliente vuole cancellare" }).certainty, "unproven");
  const minimal = plan({ gcal_uid: plain, gcal_event_status: "cancelled" }, [event()]);
  assert.equal(minimal.proposed.event_date, "2026-09-01");
  assert.equal(minimal.proposed.original_title, "2 pranzo");
  assert.equal(minimal.proposed.gcal_event_status, "cancelled");
  assert.equal(minimal.proposed.effective_total_guests, 2);
  assert.equal(minimal.differences.effective_total_guests, undefined);
});
test("multiple observations of one identity are flagged, never collapsed by arbitrary order", () => {
  const rows = [observation(), observation({ id: 41, gcal_uid: encoded, original_title: "3 pranzo" })];
  const results = planGoogleCalendarSync(rows, [event()], []);
  assert.equal(results.length, 2);
  assert.ok(results.every(result => result.requires_review && result.review_reasons.includes("multiple_observations_same_identity_no_winner_selected")));
  assert.deepEqual(planGoogleCalendarSync([...rows].reverse(), [event()], []).reverse(), results);
});
test("stale observations are labelled and cannot claim a current status", () => {
  const result = plan(observation({ gcal_updated_at: "2026-09-01T10:00:00Z" }), [event({ gcal_updated_at: "2026-09-02T10:00:00Z" })]);
  assert.ok(result.review_reasons.includes("observation_freshness_unproven_or_stale"));
});
