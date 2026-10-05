begin;

-- Canonical-only correction of ten verified June 2026 records.
-- Preserve every field except the explicitly assigned attendance fields below.
-- True Tuscan Escape blocks 1103, 1107, 1112 and 1113 are not targets.
-- Expected chart delta: ID 912 +6, ID 936 -7, ID 969 -1; others 0.
-- First application: 375 - 2 = 373. A replay accepts final states without writes.
do $correction$
declare
  expected record;
  affected integer;
begin
  -- Lock every target, including already-corrected rows, until commit.
  perform id from public.google_calendar_events
  where id in (912, 936, 937, 942, 969, 979, 983, 990, 1097, 1098)
  order by id
  for update;

  -- Rental: only effective needs correction; preserve observed and provenance.
  update public.google_calendar_events
  set effective_total_guests = 0
  where id = 936
    and original_title = '7 ebike a noleggio Jenny McSherry TOD-T128484202'
    and event_date = date '2026-06-09'
    and gcal_event_status = 'unknown'
    and observed_total_guests = 7
    and effective_total_guests = 7
    and event_classification = 'customer_event'
    and attendance_source = 'historical'
    and attendance_quality = 'historical_reference'
    and attendance_parser_version = 'gcal-attendance-review-v1'
    and exclusion_reason is null
    and concat_ws(' ', attendance_parser_version, exclusion_reason) !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 936
        and original_title = '7 ebike a noleggio Jenny McSherry TOD-T128484202'
        and event_date = date '2026-06-09'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 7
        and effective_total_guests = 0
        and event_classification = 'customer_event'
        and attendance_source = 'historical'
        and attendance_quality = 'historical_reference'
        and attendance_parser_version = 'gcal-attendance-review-v1'
        and exclusion_reason is null
        and concat_ws(' ', attendance_parser_version, exclusion_reason) !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 936 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: unexpected row count for ID 936';
  end if;

  -- Explicit guides only change observed; effective and provenance stay intact.
  for expected in
    select * from (values
      (942::bigint, date '2026-06-10', '10+2 guida tagliere bruschette Italy on a budget tours', 10, 12, 10, 'historical', 'historical_reference'),
      (979::bigint, date '2026-06-24', '4+guida tagliere bruschette italy on a budget tours', 4, 5, 4, 'historical', 'historical_reference'),
      (983::bigint, date '2026-06-26', '2+guida tagliere bruschette itsly on a budget tour', 2, 3, 2, 'historical', 'historical_reference'),
      (990::bigint, date '2026-06-29', '4+guida tagliere bruschette italy on a budget tours', 4, 5, 4, 'historical', 'historical_reference'),
      (1097::bigint, date '2026-06-03', '2+guida tagliere bruschette italy on a budget tours', 2, 3, 2, 'google_title', 'parsed'),
      (1098::bigint, date '2026-06-03', '2+guida tagliere bruschette italy on a budget tours', 2, 3, 2, 'google_title', 'parsed')
    ) as targets(id, event_date, original_title, previous_observed, final_observed, effective, attendance_source, attendance_quality)
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
      and event.attendance_source = expected.attendance_source
      and event.attendance_quality = expected.attendance_quality
      and event.attendance_parser_version = 'gcal-attendance-review-v1'
      and event.exclusion_reason is null
      and concat_ws(' ', event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review';

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
          and event.attendance_source = expected.attendance_source
          and event.attendance_quality = expected.attendance_quality
          and event.attendance_parser_version = 'gcal-attendance-review-v1'
          and event.exclusion_reason is null
          and concat_ws(' ', event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review'
      ) then
        raise exception 'Canonical attendance correction: ID % missing, unexpected or manually protected', expected.id;
      end if;
    elsif affected <> 1 then
      raise exception 'Canonical attendance correction: unexpected row count for ID %', expected.id;
    end if;
  end loop;

  -- Farm meals: require the exact previous provenance before replacing it.
  for expected in
    select * from (values
      (912::bigint, date '2026-06-01', '7 pranzo Tuscan Escape', 'unknown', 7, 'operational_block', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 7, 6),
      (937::bigint, date '2026-06-09', '3 tagliere claudio', 'confirmed', 3, 'unclassified', 'historical_reference', null, null, 3, 3),
      (969::bigint, date '2026-06-21', '9 pranzo tuscan escape', 'unknown', 9, 'unclassified', 'needs_review', 'gcal-attendance-review-v1', null, 9, 8)
    ) as targets(id, event_date, original_title, gcal_event_status, previous_effective, previous_classification,
                 previous_quality, previous_parser_version, previous_exclusion_reason, final_observed, final_effective)
  loop
    update public.google_calendar_events as event
    set observed_total_guests = expected.final_observed,
        effective_total_guests = expected.final_effective,
        event_classification = 'customer_event',
        attendance_source = 'google_title',
        attendance_quality = 'parsed',
        attendance_parser_version = 'farm-attendance-v1',
        exclusion_reason = null
    where event.id = expected.id
      and event.original_title = expected.original_title
      and event.event_date = expected.event_date
      and event.gcal_event_status = expected.gcal_event_status
      and event.observed_total_guests is null
      and event.effective_total_guests = expected.previous_effective
      and event.event_classification = expected.previous_classification
      and event.attendance_source = 'historical'
      and event.attendance_quality = expected.previous_quality
      and event.attendance_parser_version is not distinct from expected.previous_parser_version
      and event.exclusion_reason is not distinct from expected.previous_exclusion_reason
      and concat_ws(' ', event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review';

    get diagnostics affected = row_count;
    if affected = 0 then
      if not exists (
        select 1 from public.google_calendar_events as event
        where event.id = expected.id
          and event.original_title = expected.original_title
          and event.event_date = expected.event_date
          and event.gcal_event_status = expected.gcal_event_status
          and event.observed_total_guests = expected.final_observed
          and event.effective_total_guests = expected.final_effective
          and event.event_classification = 'customer_event'
          and event.attendance_source = 'google_title'
          and event.attendance_quality = 'parsed'
          and event.attendance_parser_version = 'farm-attendance-v1'
          and event.exclusion_reason is null
          and concat_ws(' ', event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review'
      ) then
        raise exception 'Canonical attendance correction: ID % missing, unexpected or manually protected', expected.id;
      end if;
    elsif affected <> 1 then
      raise exception 'Canonical attendance correction: unexpected row count for ID %', expected.id;
    end if;
  end loop;
end;
$correction$;

commit;
