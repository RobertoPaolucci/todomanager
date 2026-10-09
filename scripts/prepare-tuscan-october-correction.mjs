// Offline SQL preparation only. No network, env loading, or apply mode.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseGoogleCalendarAttendance } from "../lib/google-calendar-attendance.mjs";
import { canonicalizeGoogleUid } from "../lib/google-calendar-uid.mjs";

export function prepareTuscanOctoberTargets(snapshot, google) {
  const expected = [[2145, "2026-10-01", 8], [2144, "2026-10-05", 8], [2143, "2026-10-08", 8],
    [2142, "2026-10-09", 5], [2141, "2026-10-11", 7], [2190, "2026-10-22", 7]];
  if (snapshot.fmdq_monthly_invoices.length || google.google_updated_available !== false) throw new Error("Unexpected invoice/evidence state");
  const experience = snapshot.experiences.find(row => row.id === 7);
  if (!experience || experience.supplier_id !== 3) throw new Error("Unexpected lunch experience");
  return expected.map(([id, date, adults]) => {
    const booking = snapshot.bookings.filter(row => row.id === id);
    const staging = snapshot.google_calendar_import_staging.filter(row => row.imported_booking_id === id);
    if (booking.length !== 1 || staging.length !== 1) throw new Error("Ambiguous booking/staging");
    const b = booking[0], s = staging[0];
    const events = snapshot.google_calendar_events.filter(row => row.original_uid === s.gcal_uid);
    const evidence = google.events.filter(row => row.id === s.gcal_uid);
    if (events.length !== 1 || evidence.length !== 1) throw new Error("Ambiguous Google identity");
    const e = events[0], g = evidence[0], parsed = parseGoogleCalendarAttendance(g.summary);
    if (g.status !== "confirmed" || g.summary !== s.original_title || g.start !== `${date}T13:15:00+02:00`
      || g.recurring_event_id || g.original_start_time || g.organizer !== "calendario.fattoria@gmail.com"
      || parsed.attendance_quality !== "parsed" || parsed.effective_total_guests !== adults || parsed.excluded_staff !== 1
      || e.canonical_uid !== canonicalizeGoogleUid(g.id).canonicalUid || e.event_date !== date
      || e.gcal_event_status === "cancelled" || /manual[-_]review/i.test(e.attendance_parser_version ?? "")
      || b.booking_date !== date || b.channel_id !== 7 || b.experience_id !== 22 || b.was_modified !== false
      || b.agreed_unit_price != null || b.is_cancelled !== false || b.adults !== 1 || b.total_people !== 1
      || s.import_status !== "needs_review" || s.booking_reference !== b.booking_reference
      || ["your_unit_price", "supplier_unit_cost", "public_unit_price", "total_to_you", "total_supplier_cost",
        "total_customer", "total_amount", "margin_total", "supplier_amount_paid"].some(field => b[field] !== 0)) {
      throw new Error(`Evidence requires review for ${id}`);
    }
    const after = { ...b, experience_id: 7, experience_name: experience.name, adults, children: 0, infants: 0,
      non_paying_adults: 1, total_people: adults + 1, pax: adults, notes: g.summary, was_modified: true };
    const canonicalAfter = e.event_classification === "operational_block" ? { ...e, original_title: g.summary,
      observed_total_guests: adults + 1, effective_total_guests: adults, attendance_source: "google_title",
      attendance_quality: "parsed", attendance_parser_version: "farm-attendance-v1+manual-review-20261009",
      event_classification: "customer_event", exclusion_reason: null, gcal_event_status: "confirmed" } : { ...e };
    if (canonicalAfter.original_title !== g.summary || canonicalAfter.observed_total_guests !== adults + 1
      || canonicalAfter.effective_total_guests !== adults || canonicalAfter.event_classification !== "customer_event") {
      throw new Error(`Canonical requires review for ${id}`);
    }
    return { before: b, after, staging: s, canonical_before: e, canonical_after: canonicalAfter,
      aliases: snapshot.google_calendar_event_aliases.filter(row => row.event_id === e.id), google_evidence: g };
  });
}

export function renderTuscanOctoberSql(targets) {
  const json = JSON.stringify(targets, null, 2).replace(/'/g, "''");
  return `-- PREPARED ONLY: six October 2026 Tuscan Escape bookings. DO NOT APPLY WITHOUT APPROVAL.
-- Google Calendar read_event verified all six confirmed, titles/date/time/UID on 2026-10-09.
-- Connector does NOT expose Google updated: never mark legacy chronology verified.
-- Recheck Google before future execution; SQL cannot contact Calendar.
-- Economics remain byte-for-byte unchanged (zero); all six need separate financial review.
-- Booking manual flag / canonical manual-review marker protect this reviewed repair.
-- Canonical 1322 is already correct and is retained entirely.
-- Staging remains needs_review, including structured anomaly 612, pending financial/source review.
-- Blocks 2140,2138,2137,2292 and all September/May/other-channel rows are excluded.
begin;
set local lock_timeout = '5s';
do $correction$
declare
  targets jsonb := '${json}'::jsonb;
  t jsonb; b jsonb; e jsonb; s jsonb; before_b jsonb; after_b jsonb; before_e jsonb; after_e jsonb;
  changed integer;
begin
  lock table public.bookings, public.google_calendar_import_staging,
    public.google_calendar_events, public.google_calendar_event_aliases,
    public.fmdq_monthly_invoices, public.experiences in share row exclusive mode;
  if exists (select 1 from pg_trigger where tgrelid in ('public.bookings'::regclass,'public.google_calendar_events'::regclass)
    and not tgisinternal and tgenabled <> 'D' and (tgtype::integer & 16) <> 0)
    or exists (select 1 from pg_rewrite where ev_class in ('public.bookings'::regclass,'public.google_calendar_events'::regclass)
    and ev_type = '2' and ev_enabled <> 'D') then raise exception 'Review UPDATE hooks first'; end if;
  -- Complete preflight before ANY update; fail closed on manual edits, cancellation,
  -- changed title/date/UID, duplicate links, invoice additions, or mixed repair states.
  for t in select value from jsonb_array_elements(targets) loop
    select to_jsonb(row) into b from public.bookings row where id=(t->'before'->>'id')::bigint;
    select to_jsonb(row) into s from public.google_calendar_import_staging row where id=(t->'staging'->>'id')::bigint;
    select to_jsonb(row) into e from public.google_calendar_events row where id=(t->'canonical_before'->>'id')::bigint;
    before_b := to_jsonb(jsonb_populate_record(null::public.bookings,t->'before'));
    after_b := to_jsonb(jsonb_populate_record(null::public.bookings,t->'after'));
    before_e := to_jsonb(jsonb_populate_record(null::public.google_calendar_events,t->'canonical_before'));
    after_e := to_jsonb(jsonb_populate_record(null::public.google_calendar_events,t->'canonical_after'));
    if b is null or e is null or s is distinct from to_jsonb(jsonb_populate_record(null::public.google_calendar_import_staging,t->'staging'))
      or not ((b=before_b and e=before_e) or (b=after_b and e=after_e)) then
      raise exception 'October correction: snapshot/manual/cancellation mismatch for %', t->'before'->>'id';
    end if;
    if (select count(*) from public.bookings where upper(booking_reference)=upper(t->'before'->>'booking_reference')) <> 1
      or exists (select 1 from public.google_calendar_import_staging where id<>(t->'staging'->>'id')::bigint
        and (upper(booking_reference)=upper(t->'staging'->>'booking_reference')
          or imported_booking_id=(t->'before'->>'id')::bigint))
      or exists (select 1 from public.google_calendar_events where id<>(t->'canonical_before'->>'id')::bigint
        and identity_namespace=t->'canonical_before'->>'identity_namespace' and occurrence_id is null
        and (canonical_uid=t->'canonical_before'->>'canonical_uid' or original_uid=t->'staging'->>'gcal_uid'))
      or exists (select 1 from public.fmdq_monthly_invoices where channel_id=7 and invoice_month='2026-10-01')
      or not exists (select 1 from public.experiences where id=7 and name=t->'after'->>'experience_name' and supplier_id=3)
      or (select count(*) from public.google_calendar_event_aliases where event_id=(t->'canonical_before'->>'id')::bigint)
        <> jsonb_array_length(t->'aliases')
      or exists (select 1 from jsonb_array_elements(t->'aliases') a where not exists
        (select 1 from public.google_calendar_event_aliases row where to_jsonb(row)=
          to_jsonb(jsonb_populate_record(null::public.google_calendar_event_aliases,a)))) then
      raise exception 'October correction: identity/invoice/catalog evidence changed for %',t->'before'->>'id';
    end if;
  end loop;
  for t in select value from jsonb_array_elements(targets) loop
    select to_jsonb(row) into b from public.bookings row where id=(t->'before'->>'id')::bigint;
    if b=to_jsonb(jsonb_populate_record(null::public.bookings,t->'after')) then continue; end if;
    update public.bookings set adults=(t->'after'->>'adults')::integer, children=0, infants=0,
      non_paying_adults=1, total_people=(t->'after'->>'total_people')::integer, pax=(t->'after'->>'pax')::integer,
      experience_id=7, experience_name=t->'after'->>'experience_name', notes=t->'after'->>'notes', was_modified=true
      where id=(t->'before'->>'id')::bigint;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Expected one booking'; end if;
    if t->'canonical_before' is distinct from t->'canonical_after' then
      update public.google_calendar_events set original_title=t->'canonical_after'->>'original_title',
        observed_total_guests=(t->'canonical_after'->>'observed_total_guests')::integer,
        effective_total_guests=(t->'canonical_after'->>'effective_total_guests')::integer,
        attendance_source='google_title', attendance_quality='parsed',
        attendance_parser_version='farm-attendance-v1+manual-review-20261009',
        event_classification='customer_event', exclusion_reason=null, gcal_event_status='confirmed'
        where id=(t->'canonical_before'->>'id')::bigint;
      get diagnostics changed = row_count;
      if changed <> 1 then raise exception 'Expected one canonical'; end if;
    end if;
  end loop;
  for t in select value from jsonb_array_elements(targets) loop
    if (select to_jsonb(row) from public.bookings row where id=(t->'before'->>'id')::bigint)
        is distinct from to_jsonb(jsonb_populate_record(null::public.bookings,t->'after'))
      or (select to_jsonb(row) from public.google_calendar_events row where id=(t->'canonical_before'->>'id')::bigint)
        is distinct from to_jsonb(jsonb_populate_record(null::public.google_calendar_events,t->'canonical_after')) then
      raise exception 'October correction postcondition failed';
    end if;
  end loop;
end;
$correction$;
commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(readFileSync(new URL("../tests/fixtures/tuscan-october-2026-readonly.json", import.meta.url)));
  const google = JSON.parse(readFileSync(new URL("../tests/fixtures/tuscan-october-2026-google.json", import.meta.url)));
  process.stdout.write(renderTuscanOctoberSql(prepareTuscanOctoberTargets(snapshot, google)));
}
