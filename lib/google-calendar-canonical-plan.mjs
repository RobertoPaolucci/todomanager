import { canonicalizeGoogleUid } from "./google-calendar-uid.mjs";
import { parseGoogleCalendarAttendance } from "./google-calendar-attendance.mjs";

export const LEGACY_NAMESPACE = "legacy_unscoped";
const uid = value => canonicalizeGoogleUid(value).canonicalUid;
const namespace = row => row.identity_namespace ?? LEGACY_NAMESPACE;
const occurrence = row => row.occurrence_id ?? null;
const sameScope = (a, b) => namespace(a) === namespace(b) && occurrence(a) === occurrence(b);
const evidenceUids = row => [row.gcal_uid, row.canonical_uid, row.original_uid, row.gcal_event_id,
  row.uid_semantics === "ical_uid" && occurrence(row) ? row.gcal_ical_uid : null].map(uid).filter(Boolean);

/** No title/date/reference/staging_id matching. All evidence must agree. */
export function matchGoogleCalendarIdentity(observation, events = [], aliases = []) {
  const keys = new Set(evidenceUids(observation));
  const base = { identity_namespace: namespace(observation), canonical_uid: keys.values().next().value ?? null,
    occurrence_id: occurrence(observation), candidate_ids: [], evidence: [] };
  if (!keys.size || typeof namespace(observation) !== "string" || !namespace(observation).trim()
    || namespace(observation) !== namespace(observation).trim()
    || (observation.uid_semantics === "ical_uid" && !occurrence(observation))
    || (occurrence(observation) && observation.uid_semantics !== "ical_uid")) {
    return { ...base, outcome: "insufficient_identity", reason: "missing_uid_or_occurrence_scope" };
  }
  const candidates = new Map();
  let brokenAlias = false;
  for (const event of events) {
    if (sameScope(event, observation) && evidenceUids(event).some(key => keys.has(key))) {
      candidates.set(String(event.id), event);
      base.evidence.push({ type: "uid", event_id: event.id });
    }
  }
  for (const alias of aliases) {
    if (!sameScope(alias, observation) || !keys.has(uid(alias.original_uid))) continue;
    if (alias.verified !== true) { brokenAlias = true; continue; }
    const target = events.find(event => String(event.id) === String(alias.event_id) && sameScope(event, observation));
    if (!target || uid(target.canonical_uid) !== uid(alias.canonical_uid)) { brokenAlias = true; continue; }
    candidates.set(String(target.id), target);
    base.evidence.push({ type: "verified_alias", event_id: target.id });
  }
  base.candidate_ids = [...candidates.values()].map(event => event.id);
  if (candidates.size > 1 || brokenAlias) return { ...base, outcome: "ambiguous", reason: "conflicting_or_unverified_identity_evidence" };
  if (candidates.size === 1) {
    const event = candidates.values().next().value;
    // Additional supplied UIDs must also resolve to this event; don't silently
    // discard an unmatched canonical UID in favour of a matched raw UID.
    const represented = new Set(evidenceUids(event));
    for (const alias of aliases) if (alias.verified === true && sameScope(alias, observation)
      && String(alias.event_id) === String(event.id) && uid(alias.canonical_uid) === uid(event.canonical_uid)) represented.add(uid(alias.original_uid));
    if ([...keys].some(key => !represented.has(key))) return { ...base, outcome: "ambiguous", reason: "inconsistent_input_uids" };
    return { ...base, canonical_uid: event.canonical_uid, outcome: "match", event_id: event.id, reason: "uid_evidence" };
  }
  if (keys.size > 1) return { ...base, outcome: "ambiguous", reason: "inconsistent_input_uids" };
  if ([...keys].some(key => canonicalizeGoogleUid(key).kind === "synthetic")) {
    return { ...base, outcome: "insufficient_identity", reason: "unreconciled_synthetic_uid" };
  }
  return { ...base, outcome: "new", reason: "unseen_uid" };
}

/** "certain" means explicit evidence at its source, not a fresh Google fetch. */
export function inspectGoogleCalendarStatus(observation) {
  const raw = typeof observation.gcal_event_status === "string" ? observation.gcal_event_status.trim().toLowerCase() : "";
  const explicit = raw === "canceled" ? "cancelled" : raw;
  if (["confirmed", "tentative", "cancelled"].includes(explicit)) {
    return { value: explicit, certainty: "certain", source: "explicit_gcal_event_status" };
  }
  // These are emitted specifically by markGoogleCalendarEventCancelled.
  // Ignore/reset may change import_status while retaining the cancellation note.
  const marker = /^🔴\s*Evento cancellato da Google Calendar(?:\s|$)/u.test(String(observation.notes ?? "").trim());
  if (observation.import_status === "gcal_cancelled" || marker) {
    return { value: "cancelled", certainty: "certain", source: marker ? "persisted_cancellation_marker" : "persisted_gcal_cancelled" };
  }
  return { value: null, certainty: "unproven", source: "staging_does_not_preserve_google_status" };
}

const ATTENDANCE_FIELDS = ["observed_total_guests", "effective_total_guests", "attendance_source", "attendance_quality",
  "attendance_parser_version", "event_classification", "exclusion_reason"];

/** Pure hypothetical projection, NOT a write payload or a live update policy.
 * All historical_* fields and existing metadata survive unchanged.
 * An unknown observation status never overwrites a historical Google status.
 */
export function planGoogleCalendarObservation(observation, events = [], aliases = []) {
  const identity = matchGoogleCalendarIdentity(observation, events, aliases);
  const attendance = parseGoogleCalendarAttendance(observation);
  const status = inspectGoogleCalendarStatus(observation);
  const current = identity.outcome === "match" ? events.find(event => String(event.id) === String(identity.event_id)) : null;
  const review = [...attendance.review_reasons];
  if (["ambiguous", "insufficient_identity"].includes(identity.outcome)) review.push(identity.reason);
  if (status.certainty === "unproven") review.push("google_status_unproven");
  if (current?.gcal_updated_at && (!Number.isFinite(Date.parse(observation.gcal_updated_at))
    || !Number.isFinite(Date.parse(current.gcal_updated_at))
    || Date.parse(observation.gcal_updated_at) < Date.parse(current.gcal_updated_at))) review.push("observation_freshness_unproven_or_stale");
  let proposed = null;
  const differences = {};
  if (["match", "new"].includes(identity.outcome)) {
    proposed = current ? { ...current } : {
      identity_namespace: identity.identity_namespace, canonical_uid: identity.canonical_uid,
      original_uid: observation.gcal_uid ?? observation.original_uid ?? observation.canonical_uid ?? observation.gcal_event_id ?? observation.gcal_ical_uid,
      uid_kind: canonicalizeGoogleUid(identity.canonical_uid).kind,
      uid_semantics: observation.uid_semantics ?? "legacy_unknown", occurrence_id: identity.occurrence_id,
      calendar_id: null, gcal_event_status: "unknown",
      historical_booking_id: null, historical_total_guests: null, historical_source: null, historical_snapshot_at: null,
    };
    const title = observation.original_title ?? observation.title ?? observation.summary;
    // A minimal cancellation contains no new attendance evidence. Retain the
    // existing count/classification; an actually supplied ambiguous title still
    // projects NULL with review, as required by the parser contract.
    if (!current || (typeof title === "string" && title.trim())) {
      for (const field of ATTENDANCE_FIELDS) proposed[field] = attendance[field];
    }
    // Do not erase date/title on minimal cancellation payloads.
    for (const [target, value] of [["event_date", observation.event_date ?? observation.booking_date],
      ["event_time", observation.event_time ?? observation.booking_time],
      ["original_title", observation.original_title ?? observation.title ?? observation.summary]]) {
      if (value !== undefined && value !== null && value !== "") proposed[target] = value;
    }
    if (status.certainty === "certain") proposed.gcal_event_status = status.value;
    if (observation.id != null) proposed.staging_id = observation.id;
    proposed.last_observation_source = "google_calendar";
    // Keep explicit historical test exclusions even with ordinary-looking titles.
    if (current?.event_classification === "test" || identity.canonical_uid === "test-gcal-001") {
      proposed.event_classification = "test";
      proposed.exclusion_reason = current?.exclusion_reason ?? "explicit_test_uid";
      proposed.effective_total_guests = 0;
    }
    if (current) for (const [field, value] of Object.entries(proposed)) {
      if ((current[field] ?? null) !== (value ?? null)) differences[field] = { before: current[field] ?? null, after: value };
    }
  }
  return { staging_id: observation.id ?? null, identity, attendance, status,
    retained_status: current?.gcal_event_status ?? null, proposed, differences,
    requires_review: review.length > 0, review_reasons: [...new Set(review)] };
}

export function planGoogleCalendarSync(staging, events, aliases) {
  const plans = staging.map(row => planGoogleCalendarObservation(row, events, aliases));
  const groups = new Map();
  for (const plan of plans) {
    if (!["new", "match"].includes(plan.identity.outcome)) continue;
    const key = JSON.stringify([plan.identity.identity_namespace, plan.identity.canonical_uid, plan.identity.occurrence_id]);
    const group = groups.get(key) ?? [];
    group.push(plan);
    groups.set(key, group);
  }
  for (const group of groups.values()) if (group.length > 1) for (const plan of group) {
    plan.requires_review = true;
    plan.review_reasons.push("multiple_observations_same_identity_no_winner_selected");
  }
  return plans;
}
