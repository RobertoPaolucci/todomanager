import { LEGACY_NAMESPACE, planGoogleCalendarObservation } from "./google-calendar-canonical-plan.mjs";

// Only these planner fields may be persisted by the live writer. In particular,
// historical_*, staging_id, identity and manual metadata are never updated.
const LIVE_FIELDS = ["original_title", "event_date", "event_time", "gcal_event_status",
  "gcal_updated_at", "gcal_received_at", "last_observation_source",
  "observed_total_guests", "effective_total_guests", "attendance_source",
  "attendance_quality", "attendance_parser_version", "event_classification", "exclusion_reason"];
const IDENTITY_FIELDS = ["identity_namespace", "canonical_uid", "original_uid",
  "uid_kind", "uid_semantics", "occurrence_id"];

// Read the complete identity scope: the planner also understands encoded UIDs
// and aliases that an exact raw-UID query would miss. Never filter by event date.
async function readScope(supabase, table) {
  const rows = [];
  let lastId = null;
  for (;;) {
    let query = supabase.from(table).select("*")
      .eq("identity_namespace", LEGACY_NAMESPACE).is("occurrence_id", null)
      .order("id", { ascending: true }).limit(500);
    if (lastId !== null) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    lastId = data[data.length - 1].id;
  }
}

function sameValue(field, a, b) {
  if (field === "event_time") return a?.slice(0, 5) === b?.slice(0, 5);
  if (field === "gcal_updated_at") return Date.parse(a) === Date.parse(b);
  return (a ?? null) === (b ?? null);
}

/** Server-side writer; observation must be built after webhook authentication.
 * No credentials, payload spreading, historical repair or staging reads here.
 * Resource IDs identify instances; legacy `uid` and bare iCalUID are not guessed.
 */
export async function syncGoogleCalendarObservation(supabase, observation) {
  const metadata = observation.google_observation;
  if (metadata?.sourceVerified !== true || !metadata.googleStatus || !metadata.googleUpdatedAt
    || !metadata.googleEventId || metadata.warnings.length) {
    return { written: false, action: "needs_review", review_reasons: ["unverified_or_invalid_google_payload"] };
  }

  // Always re-plan after a concurrent insert/update. The unique identity indexes
  // reject duplicate inserts; compare-and-swap prevents stale/manual overwrites.
  for (let attempt = 0; attempt < 3; attempt++) {
    const aliases = await readScope(supabase, "google_calendar_event_aliases");
    const events = await readScope(supabase, "google_calendar_events");
    const plan = planGoogleCalendarObservation(observation, events, aliases);
    const result = { written: false, action: plan.action, review_reasons: plan.review_reasons };
    if (!plan.eligible_for_sync) return result;

    const current = events.find(row => String(row.id) === String(plan.identity.event_id));
    if (current?.calendar_id && metadata.calendarId && current.calendar_id !== metadata.calendarId) {
      return { ...result, action: "needs_review", review_reasons: ["conflicting_calendar_id"] };
    }
    const proposed = plan.proposed;
    const values = Object.fromEntries(LIVE_FIELDS
      .filter(field => Object.hasOwn(proposed, field))
      .filter(field => !current || !sameValue(field, current[field], proposed[field]))
      .map(field => [field, proposed[field]]));

    // A later reception of the same Google version is not a new observation.
    if (current && Object.keys(values).every(field => field === "gcal_received_at")) {
      return { ...result, action: "unchanged" };
    }

    // Set only on the very same write that accepts verified status AND updated.
    values.gcal_observation_verified = true;
    values.updated_at = metadata.receivedAt;
    let write;
    if (!current) {
      for (const field of IDENTITY_FIELDS) values[field] = proposed[field];
      values.calendar_id = metadata.calendarId;
      values.gcal_event_id = metadata.googleEventId;
      values.gcal_ical_uid = metadata.googleICalUid;
      values.recurring_event_id = metadata.recurringEventId;
      values.original_start_at = metadata.originalStartAt;
      values.original_start_date = metadata.originalStartDate;
      values.original_start_timezone = metadata.originalStartTimezone;
      write = supabase.from("google_calendar_events").insert(values);
    } else {
      write = supabase.from("google_calendar_events").update(values);
      // Guard the actual read snapshot, including manual markers and attendance.
      // updated_at alone is insufficient: older writers may not maintain it.
      for (const [field, value] of Object.entries(current)) {
        write = value === null ? write.is(field, null) : write.eq(field, value);
      }
    }
    const { data, error } = await write.select("id");
    if (error) {
      if (error.code === "23505") continue;
      throw error;
    }
    if (data?.length === 1) return { ...result, written: true };
  }
  return { written: false, action: "needs_review", review_reasons: ["concurrent_canonical_change"] };
}
