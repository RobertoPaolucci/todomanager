begin;

-- Canonical-only correction of nine verified August 2026 records.
-- Preserve all fields except the explicitly assigned attendance fields below.
-- Expected chart delta: ID 1036 +1, ID 1186 +4, seven guide rows 0.
-- First application: 212 + 5 = 217. A replay changes nothing.
do $correction$
declare
  expected record;
  affected integer;
begin
  perform id from public.google_calendar_events
  where id in (1036, 1157, 1158, 1179, 1180, 1181, 1186, 1212, 1225)
  order by id
  for update;

  -- Only the effective count needs correction; preserve provenance.
  update public.google_calendar_events
  set effective_total_guests = 4
  where id = 1036
    and original_title = '4 pranzo Mandy Curry GYGWZAWAR7HY +15408092792'
    and event_date = date '2026-08-19'
    and gcal_event_status = 'unknown'
    and observed_total_guests = 4
    and effective_total_guests = 3
    and event_classification = 'customer_event'
    and coalesce(attendance_parser_version, '') !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 1036
        and original_title = '4 pranzo Mandy Curry GYGWZAWAR7HY +15408092792'
        and event_date = date '2026-08-19'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 4
        and effective_total_guests = 4
        and event_classification = 'customer_event'
        and coalesce(attendance_parser_version, '') !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 1036 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: unexpected row count for ID 1036';
  end if;

  -- Observed includes explicitly counted guides; effective already excludes them.
  for expected in
    select * from (values
      (1157::bigint, date '2026-08-07', '2+guida tagliere vegetariani bruschette italy on a budget tour', 2, 3, 2),
      (1158::bigint, date '2026-08-09', '4+guida tagliere bruschette italy on a budget tour', 4, 5, 4),
      (1179::bigint, date '2026-08-10', '6+guida tagliere bruschette italy on a budget tours', 6, 7, 6),
      (1180::bigint, date '2026-08-12', '4+guida tagliere bruschette italy on a budget tours', 4, 5, 4),
      (1181::bigint, date '2026-08-16', '2+guida tagliere bruschette italy on a budget tours', 2, 3, 2),
      (1212::bigint, date '2026-08-28', '4 + 2 guide tagliere bruschetta italy on a budget tours', 4, 6, 4),
      (1225::bigint, date '2026-08-30', '2+guida tagliere bruschette italy on a budget tours', 2, 3, 2)
    ) as targets(id, event_date, original_title, previous_observed, final_observed, effective)
  loop
    update public.google_calendar_events as event
    set observed_total_guests = expected.final_observed
    where event.id = expected.id
      and event.original_title = expected.original_title
      and event.event_date = expected.event_date
      and event.gcal_event_status = 'unknown'
      and event.observed_total_guests = expected.previous_observed
      and event.effective_total_guests = expected.effective
      and event.event_classification = 'customer_event'
      and coalesce(event.attendance_parser_version, '') !~* 'manual[-_]review';

    get diagnostics affected = row_count;
    if affected = 0 then
      if not exists (
        select 1 from public.google_calendar_events as event
        where event.id = expected.id
          and event.original_title = expected.original_title
          and event.event_date = expected.event_date
          and event.gcal_event_status = 'unknown'
          and event.observed_total_guests = expected.final_observed
          and event.effective_total_guests = expected.effective
          and event.event_classification = 'customer_event'
          and coalesce(event.attendance_parser_version, '') !~* 'manual[-_]review'
      ) then
        raise exception 'Canonical attendance correction: ID % missing, unexpected or manually protected', expected.id;
      end if;
    elsif affected <> 1 then
      raise exception 'Canonical attendance correction: unexpected row count for ID %', expected.id;
    end if;
  end loop;

  -- Explicit lunch with 2 + 2 young guests, all counted as farm presences.
  update public.google_calendar_events
  set observed_total_guests = 4,
      effective_total_guests = 4,
      event_classification = 'customer_event',
      attendance_source = 'google_title',
      attendance_quality = 'parsed',
      attendance_parser_version = 'farm-attendance-v1',
      exclusion_reason = null
  where id = 1186
    and original_title = '2+2 giovani pranzo 1435453505 Melanie McMenamin'
    and event_date = date '2026-08-14'
    and gcal_event_status = 'unknown'
    and observed_total_guests is null
    and effective_total_guests is null
    and event_classification = 'unclassified'
    and attendance_source = 'unknown'
    and attendance_quality = 'needs_review'
    and attendance_parser_version = 'gcal-attendance-review-v1'
    and exclusion_reason is null
    and coalesce(attendance_parser_version, '') !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 1186
        and original_title = '2+2 giovani pranzo 1435453505 Melanie McMenamin'
        and event_date = date '2026-08-14'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 4
        and effective_total_guests = 4
        and event_classification = 'customer_event'
        and attendance_source = 'google_title'
        and attendance_quality = 'parsed'
        and attendance_parser_version = 'farm-attendance-v1'
        and exclusion_reason is null
        and coalesce(attendance_parser_version, '') !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 1186 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: unexpected row count for ID 1186';
  end if;
end;
$correction$;

commit;
