begin;

-- Canonical-only correction of 11 verified April 2026 records.
-- Preserve every field except the explicitly assigned attendance fields below.
-- Expected chart delta: ID 776 +5, ID 800 +6, ID 824 +8, ID 828 +7,
-- ID 816 +1; six guide corrections 0, including cancelled ID 1078.
-- First application: 164 + 27 = 191. A replay accepts final states without writes.
do $correction$
declare
  expected record;
  affected integer;
begin
  -- Lock every target, including already-corrected rows, until commit.
  perform id from public.google_calendar_events
  where id in (776, 785, 793, 800, 802, 807, 816, 822, 824, 828, 1078)
  order by id
  for update;

  -- Explicit guides: change only observed; preserve effective, provenance and cancellations.
  for expected in
    select * from (values
      (785::bigint, date '2026-04-06', '5+guida (1 celiaca) bruschette tagliere italy on a budget tour', 'unknown', 5, 6, 5, 'historical', 'historical_reference'),
      (793::bigint, date '2026-04-12', '2+guida tagliere bruschette italy on a budget tours', 'unknown', 2, 3, 2, 'historical', 'historical_reference'),
      (802::bigint, date '2026-04-15', '6+guida bruschette tagliere italy in a budget tours', 'unknown', 6, 7, 6, 'historical', 'historical_reference'),
      (1078::bigint, date '2026-04-17', '2+guida bruschette tagliere (allergica crostacei) italy in a budget tours', 'cancelled', 2, 3, 2, 'google_title', 'parsed'),
      (807::bigint, date '2026-04-19', '2+guida bruschette tagliere italy in a budget tours', 'unknown', 2, 3, 2, 'historical', 'historical_reference'),
      (822::bigint, date '2026-04-26', '3+guida tagliere bruschette italy on a budget tour', 'unknown', 3, 4, 3, 'historical', 'historical_reference')
    ) as targets(id, event_date, original_title, gcal_event_status, previous_observed, final_observed,
                 effective, attendance_source, attendance_quality)
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
      and event.attendance_source = expected.attendance_source
      and event.attendance_quality = expected.attendance_quality
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
          and event.gcal_event_status = expected.gcal_event_status
          and event.observed_total_guests = expected.final_observed
          and event.effective_total_guests = expected.effective
          and event.event_classification = 'customer_event'
          and event.attendance_source = expected.attendance_source
          and event.attendance_quality = expected.attendance_quality
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

  -- Tuscan lunches: replace the exact previous block classification and provenance.
  for expected in
    select * from (values
      (776::bigint, date '2026-04-04', '6 Pranzo (2 vegetariani) Tuscan Escape', 'unknown', 6, 6, 5),
      (800::bigint, date '2026-04-14', '7 Pranzo tuscan escape', 'unknown', 7, 7, 6),
      (824::bigint, date '2026-04-27', '9 Pranzo tuscan escape', 'unknown', 9, 9, 8),
      (828::bigint, date '2026-04-30', '8 pranzo tuscan escape', 'unknown', 8, 8, 7)
    ) as targets(id, event_date, original_title, gcal_event_status, previous_effective, final_observed, final_effective)
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
      and event.event_classification = 'operational_block'
      and event.attendance_source = 'historical'
      and event.attendance_quality = 'unknown'
      and event.attendance_parser_version = 'gcal-attendance-review-v1'
      and event.exclusion_reason = 'explicit_tuscan_escape_block'
      and concat_ws(' ', event.attendance_source, event.attendance_quality, event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review';

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
          and concat_ws(' ', event.attendance_source, event.attendance_quality, event.attendance_parser_version, event.exclusion_reason) !~* 'manual[-_]review'
      ) then
        raise exception 'Canonical attendance correction: ID % missing, unexpected or manually protected', expected.id;
      end if;
    elsif affected <> 1 then
      raise exception 'Canonical attendance correction: unexpected row count for ID %', expected.id;
    end if;
  end loop;

  -- The infant counts: observed and classification are already correct.
  -- Replace needs_review provenance with the explicit-meal provenance.
  -- Preserve the exact title's U+2011 non-breaking hyphen in both guards.
  update public.google_calendar_events
  set effective_total_guests = 4,
      attendance_source = 'google_title',
      attendance_quality = 'parsed',
      attendance_parser_version = 'farm-attendance-v1'
  where id = 816
    and original_title = U&'2+1 bambino+1neonato pranzo +1 (404) 226\20113278'
    and event_date = date '2026-04-24'
    and gcal_event_status = 'unknown'
    and observed_total_guests = 4
    and event_classification = 'customer_event'
    and effective_total_guests = 3
    and attendance_source = 'historical'
    and attendance_quality = 'needs_review'
    and attendance_parser_version = 'gcal-attendance-review-v1'
    and exclusion_reason is null
    and concat_ws(' ', attendance_source, attendance_quality, attendance_parser_version, exclusion_reason) !~* 'manual[-_]review';

  get diagnostics affected = row_count;
  if affected = 0 then
    if not exists (
      select 1 from public.google_calendar_events
      where id = 816
        and original_title = U&'2+1 bambino+1neonato pranzo +1 (404) 226\20113278'
        and event_date = date '2026-04-24'
        and gcal_event_status = 'unknown'
        and observed_total_guests = 4
        and event_classification = 'customer_event'
        and effective_total_guests = 4
        and attendance_source = 'google_title'
        and attendance_quality = 'parsed'
        and attendance_parser_version = 'farm-attendance-v1'
        and exclusion_reason is null
        and concat_ws(' ', attendance_source, attendance_quality, attendance_parser_version, exclusion_reason) !~* 'manual[-_]review'
    ) then
      raise exception 'Canonical attendance correction: ID 816 missing, unexpected or manually protected';
    end if;
  elsif affected <> 1 then
    raise exception 'Canonical attendance correction: unexpected row count for ID 816';
  end if;
end;
$correction$;

commit;
