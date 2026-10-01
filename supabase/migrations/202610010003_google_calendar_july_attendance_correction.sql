begin;

-- Canonical-only correction of eight verified July 2026 records.
-- Only effective (rental) or observed (explicit staff) is assigned.
-- Expected chart delta: ID 1010 -2; all other targets 0. 165 - 2 = 163.
-- Already-corrected targets are accepted without writes on replay.
do $correction$
declare
  expected record;
  affected integer;
begin
  perform id from public.google_calendar_events
  where id in (1000, 1001, 1010, 1123, 1124, 1139, 1140, 1141)
  order by id
  for update;

  update public.google_calendar_events
  set effective_total_guests = 0
  where id = 1010
    and original_title = '2 Ebike solo noleggio'
    and event_date = date '2026-07-10'
    and gcal_event_status = 'unknown'
    and observed_total_guests = 2
    and effective_total_guests = 2
    and event_classification = 'customer_event'
    and coalesce(attendance_parser_version, '') !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 1010
        and original_title = '2 Ebike solo noleggio'
        and event_date = date '2026-07-10'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 2
        and effective_total_guests = 0
        and event_classification = 'customer_event'
        and coalesce(attendance_parser_version, '') !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 1010 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: unexpected row count for ID 1010';
  end if;

  -- Preserve effective counts, provenance and Google status, including cancellations.
  for expected in
    select * from (values
      (1000::bigint, date '2026-07-05', '2+guida tagliere bruschette italy on a budget tours', 'unknown', 2, 3, 2),
      (1001::bigint, date '2026-07-05', '5 pranzo +autista Destination 2 Italia 4KPKN6-951693 brian Kacedon +1 - 202-262-0112', 'unknown', 5, 6, 5),
      (1123::bigint, date '2026-07-20', '2+guida tagliere bruschette italy on a budget tours', 'unknown', 2, 3, 2),
      (1124::bigint, date '2026-07-26', '2+guida tagliere bruschette italy on a budget tours', 'cancelled', 2, 3, 2),
      (1139::bigint, date '2026-07-27', '2+guida tagliere bruschette italy on a budget tours', 'unknown', 2, 3, 2),
      (1140::bigint, date '2026-07-29', '2+guida tagliere bruschette italy on a budget tours', 'cancelled', 2, 3, 2),
      (1141::bigint, date '2026-07-31', '8+guida tagliere bruschette italy on a budget tours', 'unknown', 8, 9, 8)
    ) as targets(id, event_date, original_title, gcal_event_status, previous_observed, final_observed, effective)
  loop
    update public.google_calendar_events as event
    set observed_total_guests = expected.final_observed
    where event.id = expected.id
      and event.original_title = expected.original_title
      and event.event_date = expected.event_date
      and event.gcal_event_status = expected.gcal_event_status
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
          and event.gcal_event_status = expected.gcal_event_status
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
end;
$correction$;

commit;
