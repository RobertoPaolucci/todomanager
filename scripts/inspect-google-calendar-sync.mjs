// SELECT-only inspection. No apply mode, SQL generation or operational imports.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { planGoogleCalendarSync } from "../lib/google-calendar-canonical-plan.mjs";
import { parseGoogleCalendarAttendance } from "../lib/google-calendar-attendance.mjs";

const TABLES = {
  staging: ["google_calendar_import_staging", "*"],
  events: ["google_calendar_events", "*"],
  aliases: ["google_calendar_event_aliases", "id,event_id,identity_namespace,occurrence_id,original_uid,canonical_uid,verified"],
};

/** Read every identity across dates: filtering canonicals to a month would
 * misidentify a moved event as new. Requests are hardcoded GET/SELECT only.
 * Injectable fetch allows offline verification of every request and pagination.
 */
export async function readGoogleCalendarSnapshot(url, key, fetcher = fetch) {
  const snapshot = {};
  for (const [name, [table, columns]] of Object.entries(TABLES)) {
    const rows = [];
    let lastId = "0";
    for (;;) {
      const endpoint = new URL(`/rest/v1/${table}`, url);
      endpoint.searchParams.set("select", columns);
      endpoint.searchParams.set("id", `gt.${lastId}`);
      endpoint.searchParams.set("order", "id.asc");
      endpoint.searchParams.set("limit", "500");
      const response = await fetcher(endpoint, { method: "GET", redirect: "error",
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`SELECT failed: ${table}`);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("Invalid SELECT result");
      if (!page.length) break;
      const nextId = String(page.at(-1).id);
      if (!/^[1-9]\d*$/.test(nextId) || BigInt(nextId) <= BigInt(lastId)) throw new Error("Invalid SELECT pagination");
      rows.push(...page);
      lastId = nextId;
      // Continue even on short pages: the server may impose a smaller row cap.
    }
    snapshot[name] = rows;
  }
  return snapshot;
}

export function buildGoogleCalendarPreview(snapshot, { period, details = false } = {}) {
  if (period && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(period)) throw new Error("Invalid year/month");
  const { staging, events, aliases } = snapshot;
  if (![staging, events, aliases].every(Array.isArray)) throw new Error("Invalid snapshot");
  const inPeriod = date => !period || (typeof date === "string" && date.startsWith(period));
  const allPlans = planGoogleCalendarSync(staging, events, aliases);
  const byId = new Map(events.map(event => [String(event.id), event]));
  const selected = allPlans.map((plan, i) => ({ plan, row: staging[i] })).filter(({ row, plan }) =>
    inPeriod(row.booking_date ?? row.event_date) || plan.identity.candidate_ids.some(id => inPeriod(byId.get(String(id))?.event_date)));
  const counts = { staging_analyzed: selected.length, canonical_match: 0, new_events: 0, ambiguous: 0,
    insufficient_identity: 0, attendance_differences: 0, classification_differences: 0,
    date_title_differences: 0, certain_cancellations: 0, unproven_google_status: 0, requires_review: 0,
    attendance_requires_review: 0, offsite_rentals: 0, tuscan_escape: 0, status_differences: 0,
    multiple_observation_rows: 0, stale_or_unproven_freshness: 0 };
  const rows = [];
  for (const { plan, row } of selected) {
    const current = byId.get(String(plan.identity.event_id));
    counts[({ match: "canonical_match", new: "new_events", ambiguous: "ambiguous", insufficient_identity: "insufficient_identity" })[plan.identity.outcome]]++;
    if (plan.differences.effective_total_guests) counts.attendance_differences++;
    if (plan.differences.event_classification) counts.classification_differences++;
    if (plan.differences.event_date || plan.differences.original_title) counts.date_title_differences++;
    if (plan.differences.gcal_event_status) counts.status_differences++;
    if (plan.review_reasons.includes("multiple_observations_same_identity_no_winner_selected")) counts.multiple_observation_rows++;
    if ((plan.precedence.group_staging_ids?.length ?? 0) > 1) counts.multiple_observation_rows++;
    if (plan.review_reasons.includes("unverified_google_chronology") || plan.action === "stale_observation") counts.stale_or_unproven_freshness++;
    if (plan.status.value === "cancelled") counts.certain_cancellations++;
    if (plan.status.certainty === "unproven") counts.unproven_google_status++;
    if (plan.requires_review) counts.requires_review++;
    if (plan.attendance.attendance_quality === "needs_review") counts.attendance_requires_review++;
    if (plan.attendance.exclusion_reason === "offsite_rental_only") counts.offsite_rentals++;
    if (/tuscan\s+escape/i.test(row.original_title ?? "")) counts.tuscan_escape++;
    rows.push({ staging_id: row.id, event_id: plan.identity.event_id ?? null,
      date: row.booking_date ?? row.event_date ?? null, title: row.original_title ?? row.title ?? null,
      outcome: plan.identity.outcome, identity_reason: plan.identity.reason,
      candidate_ids: plan.identity.candidate_ids, observed: plan.attendance.observed_total_guests,
      historical: current?.historical_total_guests ?? null, before: current?.effective_total_guests ?? null,
      parsed_effective: plan.attendance.effective_total_guests, candidate: plan.candidate?.effective_total_guests ?? null,
      proposed: plan.proposed?.effective_total_guests ?? null, classification: plan.proposed?.event_classification ?? plan.attendance.event_classification,
      exclusion_reason: plan.attendance.exclusion_reason, status: plan.status, retained_status: plan.retained_status,
      observation_evidence: Object.fromEntries(["gcal_uid", "gcal_updated_at", "created_at", "updated_at", "received_at", "gcal_received_at", "import_origin", "booking_time", "adults", "children", "infants", "import_status", "booking_reference"].map(field => [field, row[field] ?? null])),
      canonical_evidence: current ? Object.fromEntries(["canonical_uid", "original_uid", "gcal_updated_at", "gcal_received_at", "created_at", "updated_at", "attendance_source", "attendance_quality", "attendance_parser_version", "historical_total_guests", "observed_total_guests", "effective_total_guests"].map(field => [field, current[field] ?? null])) : null,
      action: plan.action, eligible_for_sync: plan.eligible_for_sync, timestamp: plan.timestamp,
      canonical_timestamp: plan.canonical_timestamp, precedence: plan.precedence, protection: plan.protection,
      protected_differences: plan.protected_differences, eligible_differences: plan.eligible_differences,
      differences: plan.differences, review_reasons: plan.review_reasons });
  }
  counts.distinct_matched_events = new Set(selected.filter(({ plan }) => plan.identity.outcome === "match").map(({ plan }) => String(plan.identity.event_id))).size;
  const represented = new Set(allPlans.flatMap(plan => plan.identity.candidate_ids.map(String)));
  const canonicalOnly = events.filter(event => inPeriod(event.event_date) && !represented.has(String(event.id))).map(event => {
    const attendance = parseGoogleCalendarAttendance(event);
    return { event_id: event.id, date: event.event_date, title: event.original_title,
      before: event.effective_total_guests, historical: event.historical_total_guests,
      title_analysis: attendance, stored_status: event.gcal_event_status,
      action: "no_staging_observation_no_sync_proposal" };
  });
  const emptyActions = () => Object.fromEntries(["safe_update", "new", "manual_override_protected", "needs_review", "ambiguous", "stale_observation", "equal_timestamp_conflict"].map(key => [key, 0]));
  const byObservation = emptyActions();
  const identityGroups = new Map();
  selected.forEach(({ plan }, index) => {
    byObservation[plan.action]++;
    const key = plan.identity.event_id != null ? `event:${plan.identity.event_id}`
      : plan.identity.outcome === "new" ? JSON.stringify([plan.identity.identity_namespace, plan.identity.canonical_uid, plan.identity.occurrence_id]) : `unresolved:${index}`;
    const group = identityGroups.get(key) ?? [];
    group.push(plan);
    identityGroups.set(key, group);
  });
  const byIdentity = emptyActions();
  for (const group of identityGroups.values()) {
    // An older row is retained in row diagnostics, not counted as another event.
    const priority = ["ambiguous", "equal_timestamp_conflict", "manual_override_protected", "safe_update", "needs_review", "new", "stale_observation"];
    byIdentity[priority.find(action => group.some(plan => plan.action === action))]++;
  }
  return { mode: "read_only", period: period ?? "all", counts,
    decisions: { by_observation: byObservation, by_identity: byIdentity,
      eligible_observations: selected.filter(({ plan }) => plan.eligible_for_sync).length },
    google_status: { known: selected.filter(({ plan }) => plan.status.knowledge === "known").length,
      unknown: selected.filter(({ plan }) => plan.status.knowledge === "unknown").length,
      verified_updated: selected.filter(({ plan }) => plan.timestamp.verified).length },
    coverage: { staging_read: staging.length, canonical_read: events.length, aliases_read: aliases.length,
      canonical_without_staging_in_period: canonicalOnly.length },
    available_staging_fields: Object.keys(staging[0] ?? {}).sort(),
    notes: ["Differences are diagnostic candidates; only eligible_differences pass the temporal/manual policy.",
      "new means unseen identity, not permission to insert: inspect eligible_for_sync and review reasons.",
      "known means explicit status evidence, not necessarily a fresh Google state; legacy updated is unverified.",
      "Unknown Google status retains the existing snapshot status; it does not confirm current activity.",
      "Period includes staging dates and matched canonical dates, including movements across months.",
      "Sequential SELECTs are not a transactional snapshot. No final attendance total is asserted."],
    ...(details ? { rows, canonical_without_staging: canonicalOnly } : {}) };
}

const usage = `Read-only Google Calendar preview (SELECT only; no apply mode).
node scripts/inspect-google-calendar-sync.mjs --from-db --month 2026-09 [--details]
node scripts/inspect-google-calendar-sync.mjs --input snapshot.json [--year 2026] [--details]
Offline input: { staging: [...], events: [...], aliases: [...] }.
No arguments: help only. Default output: aggregate counts, no titles or credentials.
--details includes titles and field differences; keep this personal-data report local.`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) { console.log(usage); return; }
  let fromDb = false;
  let input;
  let period;
  let details = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--from-db" && !fromDb) fromDb = true;
    else if (arg === "--details" && !details) details = true;
    else if (arg === "--input" && !input && args[i + 1] && !args[i + 1].startsWith("--")) input = args[++i];
    else if (["--month", "--year"].includes(arg) && !period) {
      period = args[++i];
      if (!(arg === "--month" ? /^\d{4}-(?:0[1-9]|1[0-2])$/ : /^\d{4}$/).test(period ?? "")) throw new Error("Invalid period");
    } else throw new Error("Invalid argument");
  }
  if (Boolean(input) === fromDb) throw new Error("Choose one input");
  let snapshot;
  if (input) snapshot = JSON.parse(await readFile(resolve(input), "utf8"));
  else {
    const envModule = await import("@next/env");
    const loadEnvConfig = envModule.loadEnvConfig ?? envModule.default.loadEnvConfig;
    loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing server configuration");
    snapshot = await readGoogleCalendarSnapshot(url, key);
  }
  console.log(JSON.stringify(buildGoogleCalendarPreview(snapshot, { period, details }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Never print fetch errors, request headers, env values or raw payloads.
    console.error("Inspection failed; no database writes performed. Check arguments, server configuration and SELECT access.");
    process.exitCode = 1;
  });
}
