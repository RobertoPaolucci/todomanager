begin;

-- Canonical-only correction of five verified March 2026 records.
-- Assign only observed_total_guests; preserve every other field.
-- Explicit guides are observed people, not effective farm presences.
-- Expected chart delta: 0. Dashboard total remains 67.
-- A replay accepts exact final states without writes.
do $correction$
declare
  expected record;
  affected integer;
begin
  -- Lock every target, including already-corrected rows, until commit.
  perform id from public.google_calendar_events
  where id in (749, 754, 759, 768, 772)
  order by id
  for update;

  for expected in
    select * from (values
      (749::bigint, date '2026-03-01', '2 +guida tagliere bruschette italy on a budget tours', 2, 3, 2),
      (754::bigint, date '2026-03-09', '2 +guida tagliere bruschette italy on a budget tours', 2, 3, 2),
      (759::bigint, date '2026-03-13', '8 + guida tagliere brischette italy on a Buget tours', 8, 9, 8),
      (768::bigint, date '2026-03-27', '4+guida tagliere bruschette italy on a budget tour', 4, 5, 4),
      (772::bigint, date '2026-03-30', '3+guida tagliere bruschette italy on a budget tours', 3, 4, 3)
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
      and event.attendance_source = 'historical'
      and event.attendance_quality = 'historical_reference'
      and event.attendance_parser_version = 'gcal-attendance-review-v1'
      and event.exclusion_reason is null
      and concat_ws(' ', event.attendance_source, event.attendance_quality, event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review';

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
          and event.attendance_source = 'historical'
          and event.attendance_quality = 'historical_reference'
          and event.attendance_parser_version = 'gcal-attendance-review-v1'
          and event.exclusion_reason is null
          and concat_ws(' ', event.attendance_source, event.attendance_quality, event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review'
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
