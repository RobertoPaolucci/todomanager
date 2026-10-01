begin;

-- Canonical-only correction of nine verified September 2026 records.
-- No staging, historical, identity, Google observation or date/time writes.
-- Parser version and lunch/rental rules: lib/google-calendar-attendance.mjs.
-- Expected chart delta: (8 + 6 + 8 + 6 + 8 + 5 + 8 + 7) - 2 = +54.
do $correction$
declare
  expected record;
  affected integer;
begin
  -- Hold the target rows until commit, including already-corrected rows.
  perform id from public.google_calendar_events
  where id in (1213, 1221, 1222, 1244, 1245, 1255, 1256, 1257, 1277)
  order by id
  for update;

  -- Preserve observed=2 and all provenance fields on the rental record.
  update public.google_calendar_events
  set effective_total_guests = 0
  where id = 1213
    and original_title = '2 ebike noleggio T143390648 Avar Pal'
    and event_date = date '2026-09-01'
    and gcal_event_status = 'unknown'
    and observed_total_guests = 2
    and effective_total_guests = 2
    and event_classification = 'customer_event'
    and coalesce(attendance_parser_version, '') !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  -- A replay accepts only the exact final attendance state with the same guards.
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 1213
        and original_title = '2 ebike noleggio T143390648 Avar Pal'
        and event_date = date '2026-09-01'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 2
        and effective_total_guests = 0
        and event_classification = 'customer_event'
        and coalesce(attendance_parser_version, '') !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 1213 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: ID 1213 missing, changed or manually protected';
  end if;

  for expected in
    select * from (values
      (1221::bigint, date '2026-09-14', '9 pranzo Tuscan escape', 9, 8),
      (1222::bigint, date '2026-09-14', '7 pranzo Tuscan escape', 7, 6),
      (1244::bigint, date '2026-09-07', '9 pranzo tuscan escape', 9, 8),
      (1245::bigint, date '2026-09-08', '7 pranzo Tuscan escape', 7, 6),
      (1255::bigint, date '2026-09-12', '9 pranzo Tuscan escape', 9, 8),
      (1256::bigint, date '2026-09-17', '6 pranzo Tuscan escape', 6, 5),
      (1257::bigint, date '2026-09-18', '9 pranzo Tuscan escape', 9, 8),
      (1277::bigint, date '2026-09-15', '8 pranzo Tuscan escape', 8, 7)
    ) as targets(id, event_date, original_title, observed, effective)
  loop
    update public.google_calendar_events as event
    set observed_total_guests = expected.observed,
        effective_total_guests = expected.effective,
        event_classification = 'customer_event',
        attendance_source = 'google_title',
        attendance_quality = 'parsed',
        attendance_parser_version = 'farm-attendance-v1',
        exclusion_reason = null
    where event.id = expected.id
      and event.original_title = expected.original_title
      and event.event_date = expected.event_date
      and event.gcal_event_status = 'unknown'
      and event.event_classification = 'operational_block'
      and event.observed_total_guests is null
      and event.effective_total_guests is null
      and coalesce(event.attendance_parser_version, '') !~* 'manual[-_]review';

    get diagnostics affected = row_count;
    if affected = 0 then
      if not exists (
        select 1 from public.google_calendar_events as event
        where event.id = expected.id
          and event.original_title = expected.original_title
          and event.event_date = expected.event_date
          and event.gcal_event_status = 'unknown'
          and event.observed_total_guests = expected.observed
          and event.effective_total_guests = expected.effective
          and event.event_classification = 'customer_event'
          and event.attendance_source = 'google_title'
          and event.attendance_quality = 'parsed'
          and event.attendance_parser_version = 'farm-attendance-v1'
          and event.exclusion_reason is null
          and coalesce(event.attendance_parser_version, '') !~* 'manual[-_]review'
      ) then
        raise exception 'Canonical attendance correction: ID % missing, unexpected or manually protected', expected.id;
      end if;
    elsif affected <> 1 then
      raise exception 'Canonical attendance correction: ID % missing, changed or manually protected', expected.id;
    end if;
  end loop;
end;
$correction$;

commit;
