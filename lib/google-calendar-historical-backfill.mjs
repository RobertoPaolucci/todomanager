import { canonicalizeGoogleUid } from "./google-calendar-uid.mjs";

const GOOGLE_HISTORICAL_SOURCES = new Set(["google_calendar_ics", "google_calendar_screenshot"]);
const BLOCK_LABEL = "tuscan escape - blocco data";

function historicalStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "canceled") return "cancelled";
  return ["confirmed", "tentative", "cancelled"].includes(status) ? status : "unknown";
}

function classify(row, identity) {
  if (identity.canonicalUid === "test-gcal-001") {
    return { event_classification: "test", exclusion_reason: "explicit_test_uid" };
  }
  // No generic Tuscan Escape substring exclusion: old lunches are not
  // proven operational blocks merely because their title names the channel.
  if ([row.experience_name, row.original_title].some(value =>
    typeof value === "string" && value.trim().toLowerCase() === BLOCK_LABEL
  )) {
    return { event_classification: "operational_block", exclusion_reason: "explicit_tuscan_escape_block" };
  }
  return { event_classification: "unclassified", exclusion_reason: null };
}

/** Build a deterministic plan from historical rows only; never performs I/O. */
export function prepareHistoricalGoogleCalendarBackfill(rows) {
  if (!Array.isArray(rows)) throw new Error("Historical input must be an array");
  const events = [];
  const aliases = [];
  const conflicts = [];
  const seenIds = new Set();
  const seenKeys = new Map();
  for (const row of rows) {
    const id = String(row.id ?? "");
    const identity = canonicalizeGoogleUid(row.google_uid);
    const guests = row.total_guests ?? null;
    const date = row.booking_date;
    const validDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    const validId = /^[1-9]\d*$/.test(id) && BigInt(id) <= 9223372036854775807n
      && (typeof row.id !== "number" || Number.isSafeInteger(row.id));
    if (!validId || !validDate || !identity.canonicalUid
      || !GOOGLE_HISTORICAL_SOURCES.has(row.source)
      || (guests !== null && (!Number.isInteger(guests) || guests < 0 || guests > 2147483647))) {
      conflicts.push({ historicalBookingId: id, reason: "invalid_historical_row" });
      continue;
    }
    if (seenIds.has(id)) {
      conflicts.push({ historicalBookingId: id, reason: "repeated_historical_row" });
      continue;
    }
    seenIds.add(id);
    // Calendar and occurrence are genuinely unavailable in this snapshot.
    // Never derive a recurrence ID from a date or strip a UID suffix.
    const key = identity.canonicalUid;
    if (seenKeys.has(key)) {
      conflicts.push({ historicalBookingId: id, otherHistoricalBookingId: seenKeys.get(key), reason: "canonical_identity_collision" });
      continue;
    }
    seenKeys.set(key, id);
    const event = {
      calendar_id: null,
      identity_namespace: "legacy_unscoped",
      canonical_uid: key,
      original_uid: identity.originalUid,
      uid_kind: identity.kind,
      uid_semantics: identity.kind === "synthetic" ? "synthetic" : "legacy_unknown",
      occurrence_id: null,
      gcal_event_id: null,
      gcal_ical_uid: null,
      recurring_event_id: null,
      original_start_at: null,
      original_start_date: null,
      original_start_timezone: null,
      event_date: date,
      event_time: row.booking_time ?? null,
      original_title: row.original_title ?? null,
      gcal_html_link: null,
      gcal_event_status: historicalStatus(row.status),
      gcal_updated_at: null,
      gcal_received_at: null,
      historical_booking_id: id,
      staging_id: null,
      historical_source: row.source,
      historical_snapshot_at: null,
      historical_total_guests: guests,
      observed_total_guests: null,
      effective_total_guests: guests,
      attendance_source: "historical",
      attendance_quality: identity.kind === "synthetic" ? "needs_review" : guests === null ? "unknown" : "historical_reference",
      attendance_parser_version: null,
      ...classify(row, identity),
      last_observation_source: "historical_bookings",
    };
    const historicalExpected = Object.fromEntries([
      "google_uid", "booking_date", "booking_time", "original_title", "total_guests", "status", "source", "experience_name",
    ].map(field => [field, row[field] ?? null]));
    events.push({ event, historicalExpected });
    const synthetic = identity.kind === "synthetic";
    aliases.push({
      calendar_id: null, identity_namespace: "legacy_unscoped", occurrence_id: null,
      original_uid: identity.originalUid, canonical_uid: key,
      alias_type: synthetic ? key === "test-gcal-001" ? "synthetic_test" : "synthetic_manual"
        : identity.encoding === "base32hex" ? "base32hex" : "google_uid",
      reconciliation_method: synthetic ? key === "test-gcal-001" ? "explicit_test" : "unresolved_manual"
        : identity.encoding === "base32hex" ? "base32hex_roundtrip" : "identity",
      verified: !synthetic,
      historical_booking_id: id,
    });
    if (identity.encoding === "base32hex") {
      aliases.push({ calendar_id: null, identity_namespace: "legacy_unscoped", occurrence_id: null, original_uid: key, canonical_uid: key,
        alias_type: "google_uid", reconciliation_method: "base32hex_roundtrip", verified: true, historical_booking_id: id });
    }
  }
  return { events, aliases, conflicts };
}

function sqlJson(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

/** Generate a reviewable, insert-only transaction. This function never executes SQL. */
export function renderHistoricalGoogleCalendarBackfillSql(plan) {
  if (plan.conflicts.length) throw new Error("Backfill blocked: unresolved historical conflicts");
  const columns = [
    ["calendar_id", "text"], ["identity_namespace", "text"], ["canonical_uid", "text"], ["original_uid", "text"], ["uid_kind", "text"],
    ["uid_semantics", "text"], ["gcal_event_id", "text"], ["gcal_ical_uid", "text"],
    ["occurrence_id", "text"], ["recurring_event_id", "text"], ["original_start_at", "timestamptz"],
    ["original_start_date", "date"], ["original_start_timezone", "text"],
    ["event_date", "date"], ["event_time", "time"], ["original_title", "text"], ["gcal_html_link", "text"],
    ["gcal_event_status", "text"], ["gcal_updated_at", "timestamptz"], ["gcal_received_at", "timestamptz"],
    ["historical_booking_id", "bigint"], ["staging_id", "bigint"], ["historical_source", "text"],
    ["historical_snapshot_at", "timestamptz"], ["historical_total_guests", "integer"],
    ["observed_total_guests", "integer"], ["effective_total_guests", "integer"],
    ["attendance_source", "text"], ["attendance_quality", "text"], ["attendance_parser_version", "text"],
    ["event_classification", "text"], ["exclusion_reason", "text"], ["last_observation_source", "text"],
  ];
  const names = columns.map(([name]) => name).join(", ");
  const types = columns.map(([name, type]) => `${name} ${type}`).join(", ");
  const eventRows = plan.events.map(({ event }) => event);
  const expectedRows = plan.events.map(({ event, historicalExpected }) => ({ id: event.historical_booking_id, expected: historicalExpected }));
  const historicalFields = Object.keys(plan.events[0]?.historicalExpected ?? {
    google_uid: null, booking_date: null, booking_time: null, original_title: null,
    total_guests: null, status: null, source: null, experience_name: null,
  });
  const historicalProjection = historicalFields.map(field => `'${field}', h.${field}`).join(", ");
  return `-- PREPARED ONLY. Review separately; never executed by the preparation CLI.
begin;
set local lock_timeout = '5s';
set local standard_conforming_strings = on;
-- Locks only the NEW tables, serializing competing canonical backfills/writers.
lock table public.google_calendar_events, public.google_calendar_event_aliases in share row exclusive mode;
create temporary table _gcal_historical_expected on commit drop as
  select * from jsonb_to_recordset(${sqlJson(expectedRows)}) as r(id bigint, expected jsonb);
create temporary table _gcal_event_plan on commit drop as
  select * from jsonb_to_recordset(${sqlJson(eventRows)}) as r(${types});
create temporary table _gcal_alias_plan on commit drop as
  select * from jsonb_to_recordset(${sqlJson(plan.aliases)}) as r(
    calendar_id text, identity_namespace text, occurrence_id text, original_uid text, canonical_uid text,
    alias_type text, reconciliation_method text, verified boolean, historical_booking_id bigint);
do $gcal_preflight$
begin
  if exists (
    select 1 from _gcal_historical_expected p
    left join public.historical_bookings h on h.id = p.id
    where h.id is null or jsonb_build_object(${historicalProjection}) is distinct from p.expected
  ) then raise exception 'Historical source changed: regenerate and review the backfill'; end if;
end;
$gcal_preflight$;
insert into public.google_calendar_events (${names})
select ${names} from _gcal_event_plan
on conflict do nothing;
do $gcal_events_check$
begin
  if exists (
    select 1 from _gcal_event_plan p
    left join public.google_calendar_events e
      on e.identity_namespace = p.identity_namespace
      and e.canonical_uid = p.canonical_uid
      and e.occurrence_id is not distinct from p.occurrence_id
    where e.id is null or not (to_jsonb(e) @> to_jsonb(p))
  ) then raise exception 'Canonical conflict: no existing event will be overwritten'; end if;
end;
$gcal_events_check$;
insert into public.google_calendar_event_aliases (
  event_id, calendar_id, identity_namespace, occurrence_id, original_uid, canonical_uid,
  alias_type, reconciliation_method, verified, historical_booking_id)
select e.id, p.calendar_id, p.identity_namespace, p.occurrence_id, p.original_uid, p.canonical_uid,
  p.alias_type, p.reconciliation_method, p.verified, p.historical_booking_id
from _gcal_alias_plan p join public.google_calendar_events e
  on e.identity_namespace = p.identity_namespace and e.canonical_uid = p.canonical_uid
  and e.occurrence_id is not distinct from p.occurrence_id
on conflict do nothing;
do $gcal_alias_check$
begin
  if exists (
    select 1 from _gcal_alias_plan p
    join public.google_calendar_events e
      on e.identity_namespace = p.identity_namespace and e.canonical_uid = p.canonical_uid
      and e.occurrence_id is not distinct from p.occurrence_id
    left join public.google_calendar_event_aliases a
      on a.identity_namespace = p.identity_namespace and a.original_uid = p.original_uid
      and a.occurrence_id is not distinct from p.occurrence_id
    where a.id is null or a.event_id <> e.id or not (to_jsonb(a) @> to_jsonb(p))
  ) then raise exception 'Alias conflict: no existing reconciliation will be overwritten'; end if;
end;
$gcal_alias_check$;
commit;
`;
}
