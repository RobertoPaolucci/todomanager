// Pure acquisition contract shared by the authenticated webhook and offline tools.
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;

export function googleDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function googleTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)
    || !googleDate(value.slice(0, 10))) return null;
  const milliseconds = Date.parse(value);
  // Do not silently round distinct sub-millisecond versions into a tie.
  if (/\.\d{3}\d*[1-9]\d*(?:Z|[+-])/i.test(value)) return null;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/** sourceVerified is a server-side assertion about the Google/Make field mapping,
 * NOT a field copied from the HTTP body. Default false. receivedAt is injected
 * by the caller, never substituted for Google updated. No clock or I/O here.
 * @param {object} payload
 * @param {{ receivedAt?: string | null, sourceVerified?: boolean }} [options]
 */
export function normalizeGoogleCalendarObservation(payload, { receivedAt = null, sourceVerified = false } = {}) {
  const warnings = [];
  const rawStatus = text(payload.status)?.toLowerCase();
  const googleStatus = ["confirmed", "tentative", "cancelled"].includes(rawStatus) ? rawStatus : null;
  if (!googleStatus) warnings.push("missing_or_invalid_google_status");
  const googleUpdatedAt = googleTimestamp(payload.updated);
  if (!googleUpdatedAt) warnings.push("missing_or_invalid_google_updated");
  const eventIds = [...new Set([text(payload.event_id), text(payload.id)].filter(Boolean))];
  if (eventIds.length > 1) warnings.push("conflicting_google_event_ids");
  const googleEventId = eventIds.length === 1 ? eventIds[0] : null;
  // uid is deliberately not used: the legacy webhook conflates its semantics.
  const start = payload.originalStartTime ?? {};
  let originalStartAt = googleTimestamp(start.dateTime);
  let originalStartDate = googleDate(start.date);
  if (start.dateTime && start.date) {
    originalStartAt = null;
    originalStartDate = null;
    warnings.push("conflicting_original_start");
  } else if ((start.dateTime && !originalStartAt) || (start.date && !originalStartDate)) warnings.push("invalid_original_start");
  const normalizedReceivedAt = googleTimestamp(receivedAt);
  if (receivedAt && !normalizedReceivedAt) warnings.push("invalid_received_at");
  return {
    googleStatus, googleUpdatedAt, googleEventId, googleICalUid: text(payload.iCalUID),
    recurringEventId: text(payload.recurringEventId), originalStartAt, originalStartDate,
    originalStartTimezone: text(start.timeZone), receivedAt: normalizedReceivedAt,
    sequence: Number.isSafeInteger(payload.sequence) && payload.sequence >= 0 ? payload.sequence : null,
    etag: text(payload.etag), calendarId: text(payload.calendar_id ?? payload.calendarId),
    timestampSource: googleUpdatedAt ? "google_payload_updated" : "missing",
    sourceVerified: sourceVerified === true, warnings,
  };
}

/** Metadata is an in-memory sidecar, not an existing Supabase column. Legacy
 * gcal_updated_at has unknown provenance even when import_origin is make.
 */
export function inspectGoogleTimestamp(row) {
  const metadata = row.google_observation;
  const stored = googleTimestamp(row.gcal_updated_at);
  const value = googleTimestamp(metadata?.googleUpdatedAt ?? row.gcal_updated_at);

  const verifiedFromPayload = Boolean(
    value &&
    metadata?.sourceVerified === true &&
    metadata.timestampSource === "google_payload_updated" &&
    (!row.gcal_updated_at || stored === value)
  );

  const verifiedFromCanonical = Boolean(
    value &&
    stored === value &&
    row.gcal_observation_verified === true
  );

  const verified = verifiedFromPayload || verifiedFromCanonical;

  return {
    value,
    verified,
    source: verifiedFromPayload
      ? "verified_google_payload_updated"
      : verifiedFromCanonical
        ? "verified_google_canonical_updated"
        : value
          ? "legacy_or_unverified_updated"
          : "missing_updated",
  };
}
export function inspectManualAttendanceProtection(event) {
  const version = event?.attendance_parser_version;
  const protectedValue = typeof version === "string" && /manual[-_]review/i.test(version);
  // historical/reference, source=google_fields and discrepancies between counts
  // do not by themselves prove that a human approved anything.
  const recognizedAutomatic = ["gcal-attendance-review-v1", "farm-attendance-v1"].includes(version)
    || (version == null && event?.attendance_source === "historical" && event.attendance_quality === "historical_reference");
  return { protected: protectedValue, automatic_reparse_allowed: !protectedValue && recognizedAutomatic,
    reason: protectedValue ? "explicit_manual_review_marker" : recognizedAutomatic ? null : "unrecognized_attendance_provenance",
    marker: protectedValue ? version : null };
}
