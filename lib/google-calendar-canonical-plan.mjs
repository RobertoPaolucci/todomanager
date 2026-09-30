import { canonicalizeGoogleUid } from "./google-calendar-uid.mjs";
import { parseGoogleCalendarAttendance } from "./google-calendar-attendance.mjs";
import { inspectGoogleTimestamp, inspectManualAttendanceProtection } from "./google-calendar-observation.mjs";

export const LEGACY_NAMESPACE = "legacy_unscoped";
const uid = value => canonicalizeGoogleUid(value).canonicalUid;
const namespace = row => row.identity_namespace ?? LEGACY_NAMESPACE;
const occurrence = row => row.occurrence_id ?? null;
const sameScope = (a, b) => namespace(a) === namespace(b) && occurrence(a) === occurrence(b);
const evidenceUids = row => [row.gcal_uid, row.canonical_uid, row.original_uid, row.gcal_event_id, row.google_observation?.googleEventId,
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
  const supplied = observation.google_observation?.googleStatus ?? observation.gcal_event_status;
  const raw = typeof supplied === "string" ? supplied.trim().toLowerCase() : "";
  const explicit = raw === "canceled" ? "cancelled" : raw;
  if (["confirmed", "tentative", "cancelled"].includes(explicit)) {
    return { value: explicit, certainty: "certain", knowledge: "known", source: "explicit_gcal_event_status" };
  }
  // These are emitted specifically by markGoogleCalendarEventCancelled.
  // Import workflow flags, including gcal_cancelled, are never Google state.
  // The exact persisted webhook note is independent legacy evidence, not proof
  // of current state/freshness; the temporal policy still blocks stale changes.
  const marker = /^🔴\s*Evento cancellato da Google Calendar(?:\s|$)/u.test(String(observation.notes ?? "").trim());
  if (marker) {
    return { value: "cancelled", certainty: "certain", knowledge: "known", source: "persisted_cancellation_marker" };
  }
  return { value: null, certainty: "unproven", knowledge: "unknown", source: "staging_does_not_preserve_google_status" };
}

function observationContent(row) {
  // Provenance IDs, workflow, reception/creation times and generated booking
  // references are deliberately excluded. UID normalization happens beforehand.
  return JSON.stringify([row.original_title ?? row.title ?? row.summary ?? null,
    row.event_date ?? row.booking_date ?? null,
    (row.event_time ?? row.booking_time)?.slice(0, 5) ?? null,
    inspectGoogleCalendarStatus(row).value]);
}

function contradictsCanonical(observation, current) {
  const supplied = [observation.original_title ?? observation.title ?? observation.summary,
    observation.event_date ?? observation.booking_date, (observation.event_time ?? observation.booking_time)?.slice(0, 5),
    inspectGoogleCalendarStatus(observation).value];
  const previous = [current.original_title, current.event_date, current.event_time?.slice(0, 5), inspectGoogleCalendarStatus(current).value];
  return supplied.some((value, i) => value != null && value !== "" && value !== (previous[i] ?? null));
}

/** Per-row roles, with all equal, identical newest observations coalesced.
 * The caller groups by canonical identity, NEVER by date/title/reference.
 */
export function resolveGoogleCalendarPrecedence(rows) {
  const timestamps = rows.map(inspectGoogleTimestamp);
  const contents = rows.map(observationContent);
  const base = timestamps.map(timestamp => ({ timestamp, role: "unproven", reason: "unverified_google_chronology" }));
  if (timestamps.some(timestamp => !timestamp.verified)) {
    const ties = new Map();
    timestamps.forEach((timestamp, i) => {
      if (!timestamp.value) return;
      const values = ties.get(timestamp.value) ?? new Set();
      values.add(contents[i]);
      ties.set(timestamp.value, values);
    });
    if ([...ties.values()].some(values => values.size > 1)) return base.map(value => ({ ...value, role: "conflict", reason: "equal_timestamp_conflict" }));
    return base;
  }
  const latest = Math.max(...timestamps.map(timestamp => Date.parse(timestamp.value)));
  const winners = timestamps.flatMap((timestamp, i) => Date.parse(timestamp.value) === latest ? [i] : []);
  const conflict = new Set(winners.map(i => contents[i])).size > 1;
  return base.map((value, i) => ({ ...value,
    role: !winners.includes(i) ? "stale" : conflict ? "conflict" : "selected",
    reason: !winners.includes(i) ? "newer_verified_observation" : conflict ? "equal_timestamp_conflict" : "latest_verified_google_observation",
    equivalent_count: conflict ? 0 : winners.length }));
}

function differencesBetween(current, proposed) {
  if (!current || !proposed) return {};
  return Object.fromEntries(Object.entries(proposed).filter(([field, value]) => field !== "google_observation"
    && (current[field] ?? null) !== (value ?? null)).map(([field, value]) => [field, { before: current[field] ?? null, after: value }]));
}

const ATTENDANCE_FIELDS = ["observed_total_guests", "effective_total_guests", "attendance_source", "attendance_quality",
  "attendance_parser_version", "event_classification", "exclusion_reason"];

/** Pure hypothetical projection, NOT a write payload or a live update policy.
 * All historical_* fields and existing metadata survive unchanged.
 * An unknown observation status never overwrites a historical Google status.
 */
export function planGoogleCalendarObservation(observation, events = [], aliases = [], { precedence = resolveGoogleCalendarPrecedence([observation])[0] } = {}) {
  const identity = matchGoogleCalendarIdentity(observation, events, aliases);
  const attendance = parseGoogleCalendarAttendance(observation);
  const status = inspectGoogleCalendarStatus(observation);
  const current = identity.outcome === "match" ? events.find(event => String(event.id) === String(identity.event_id)) : null;
  const protection = inspectManualAttendanceProtection(current);
  const timestamp = inspectGoogleTimestamp(observation);
  const canonicalTimestamp = current ? inspectGoogleTimestamp(current) : null;
  const title = observation.original_title ?? observation.title ?? observation.summary;
  const hasTitle = typeof title === "string" && Boolean(title.trim());
  const cancellation = status.value === "cancelled";
  const review = current && (cancellation || !hasTitle) ? [] : [...attendance.review_reasons];
  if (["ambiguous", "insufficient_identity"].includes(identity.outcome)) review.push(identity.reason);
  if (status.certainty === "unproven") review.push("google_status_unproven");
  if (!timestamp.verified || (current && !canonicalTimestamp.verified)) review.push("unverified_google_chronology");
  if (precedence.role === "unproven") review.push(precedence.reason);
  let temporalDecision = precedence.role;
  if (current && timestamp.value && canonicalTimestamp.value) {
    if (timestamp.verified && canonicalTimestamp.verified && Date.parse(timestamp.value) < Date.parse(canonicalTimestamp.value)) temporalDecision = "stale";
    if (timestamp.value === canonicalTimestamp.value && contradictsCanonical(observation, current)) temporalDecision = "conflict";
  }
  if (temporalDecision === "stale") review.push("stale_observation");
  if (temporalDecision === "conflict") review.push("equal_timestamp_conflict");
  const metadata = observation.google_observation;
  if (metadata?.warnings?.some(warning => !["missing_or_invalid_google_status", "missing_or_invalid_google_updated"].includes(warning))) review.push("invalid_google_metadata");
  let proposed = null;
  let protectedDifferences = {};
  if (["match", "new"].includes(identity.outcome)) {
    proposed = current ? { ...current } : {
      identity_namespace: identity.identity_namespace, canonical_uid: identity.canonical_uid,
      original_uid: observation.gcal_uid ?? observation.original_uid ?? observation.canonical_uid ?? observation.gcal_event_id ?? observation.gcal_ical_uid,
      uid_kind: canonicalizeGoogleUid(identity.canonical_uid).kind,
      uid_semantics: observation.uid_semantics ?? "legacy_unknown", occurrence_id: identity.occurrence_id,
      calendar_id: null, gcal_event_status: "unknown",
      historical_booking_id: null, historical_total_guests: null, historical_source: null, historical_snapshot_at: null,
    };
    // A minimal cancellation contains no new attendance evidence. Retain the
    // existing count/classification; an actually supplied ambiguous title still
    // projects NULL with review, as required by the parser contract.
    if (!current || (hasTitle && !cancellation)) {
      for (const field of ATTENDANCE_FIELDS) proposed[field] = attendance[field];
    }
    // Do not erase date/title on minimal cancellation payloads.
    for (const [target, value] of [["event_date", observation.event_date ?? observation.booking_date],
      ["event_time", observation.event_time ?? observation.booking_time],
      ["original_title", observation.original_title ?? observation.title ?? observation.summary]]) {
      if (value !== undefined && value !== null && value !== "") proposed[target] = value;
    }
    if (status.certainty === "certain") proposed.gcal_event_status = status.value;
    if (observation.id != null && (precedence.equivalent_count ?? 1) === 1) proposed.staging_id = observation.id;
    if (timestamp.verified) {
      proposed.gcal_updated_at = timestamp.value;
      proposed.google_observation = metadata; // in-memory provenance only
      if (metadata.receivedAt) proposed.gcal_received_at = metadata.receivedAt;
    }
    proposed.last_observation_source = "google_calendar";
    // Keep explicit historical test exclusions even with ordinary-looking titles.
    if (current?.event_classification === "test" || identity.canonical_uid === "test-gcal-001") {
      proposed.event_classification = "test";
      proposed.exclusion_reason = current?.exclusion_reason ?? "explicit_test_uid";
      proposed.effective_total_guests = 0;
    }
    if (protection.protected) {
      // This marker describes the approved effective count. Never relabel it
      // with the new parser version, or a second replay would lose protection.
      const locked = ATTENDANCE_FIELDS.filter(field => field !== "observed_total_guests");
      protectedDifferences = Object.fromEntries(Object.entries(differencesBetween(current, proposed)).filter(([field]) => locked.includes(field)));
      for (const field of locked) if (Object.hasOwn(current, field)) proposed[field] = current[field];
      else delete proposed[field];
      review.push("manual_attendance_approval_required");
    }
  }
  const candidate = proposed;
  const differences = differencesBetween(current, candidate);
  if (current && timestamp.value === canonicalTimestamp.value
    && ["effective_total_guests", "event_classification", "exclusion_reason"].some(field => differences[field])) review.push("parser_change_without_newer_google_observation");
  const blocking = review.filter(reason => reason !== "manual_attendance_approval_required");
  const eligible = candidate !== null && blocking.length === 0 && temporalDecision === "selected";
  const action = identity.outcome === "ambiguous" ? "ambiguous"
    : temporalDecision === "conflict" ? "equal_timestamp_conflict"
      : temporalDecision === "stale" ? "stale_observation"
        : protection.protected ? "manual_override_protected"
          : identity.outcome === "new" ? "new" : eligible ? "safe_update" : "needs_review";
  // Blocked updates expose the unchanged current projection and zero eligible
  // differences. candidate/attendance keep the diagnostic evidence inspectable.
  proposed = eligible ? candidate : current ? { ...current } : null;
  return { staging_id: observation.id ?? null, identity, attendance, status, action,
    protection, protected_differences: protectedDifferences, timestamp, canonical_timestamp: canonicalTimestamp, precedence,
    retained_status: current?.gcal_event_status ?? null, candidate, proposed, differences,
    eligible_differences: eligible ? differences : {}, eligible_for_sync: eligible,
    requires_review: review.length > 0, review_reasons: [...new Set(review)] };
}

export function planGoogleCalendarSync(staging, events, aliases) {
  const identities = staging.map(row => matchGoogleCalendarIdentity(row, events, aliases));
  const groups = new Map();
  identities.forEach((identity, i) => {
    if (!["new", "match"].includes(identity.outcome)) return;
    const key = JSON.stringify([identity.identity_namespace, identity.canonical_uid, identity.occurrence_id]);
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  });
  const precedence = new Map();
  for (const group of groups.values()) resolveGoogleCalendarPrecedence(group.map(i => staging[i])).forEach((result, n) => precedence.set(group[n], { ...result, group_staging_ids: group.map(i => staging[i].id ?? null).sort() }));
  return staging.map((row, i) => planGoogleCalendarObservation(row, events, aliases, { precedence: precedence.get(i) }));
}
