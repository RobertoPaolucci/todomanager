begin;

-- Canonical-only correction of 26 verified May 2026 records.
-- Preserve every field except the explicitly assigned attendance fields below.
-- Expected chart delta: five Tuscan blocks +34, five included Tuscan lunches -5,
-- three rentals -6, lunch 1093 +2; all other targets 0 (including cancelled rows).
-- First application: 303 + 25 = 328. A replay accepts final states without writes.
do $correction$
declare
  expected record;
  affected integer;
begin
  -- Lock every target, including already-corrected rows, until commit.
  perform id from public.google_calendar_events
  where id in (829, 837, 846, 847, 853, 856, 857, 862, 869, 871, 879, 882, 884, 885, 889, 893, 900, 904, 1059, 1062, 1081, 1086, 1087, 1091, 1093, 1102)
  order by id
  for update;

  -- Explicit guides: change only observed; preserve effective, provenance and cancellations.
  for expected in
    select * from (values
      (829::bigint, date '2026-05-01', '4+guida tagliere bruschette italy on a budget tours', 'unknown', 4, 5, 4, 'historical', 'historical_reference'),
      (1091::bigint, date '2026-05-01', '2+guida tagliere bruschette italy on a budget tours', 'unknown', 2, 3, 2, 'google_title', 'parsed'),
      (1059::bigint, date '2026-05-08', '2+guida tagliere bruschette italy on budget tours', 'unknown', 2, 3, 2, 'google_title', 'parsed'),
      (856::bigint, date '2026-05-10', '4+guida tagliere bruschette italy on budget tours', 'unknown', 4, 5, 4, 'historical', 'historical_reference'),
      (862::bigint, date '2026-05-13', '2+guida tagliere bruschette Italy on a budget tours', 'unknown', 2, 3, 2, 'historical', 'historical_reference'),
      (869::bigint, date '2026-05-15', '7+guida tagliere brischette italy on a budget tours', 'unknown', 7, 8, 7, 'historical', 'historical_reference'),
      (879::bigint, date '2026-05-18', '4+guida tagliere bruschette italy on a budget tours', 'unknown', 4, 5, 4, 'historical', 'historical_reference'),
      (885::bigint, date '2026-05-22', '3+guida tagliere bruschette italy on a budget tours', 'unknown', 3, 4, 3, 'historical', 'historical_reference'),
      (1081::bigint, date '2026-05-24', '2+guida tagliere bruschette italy on anbudget tours', 'unknown', 2, 3, 2, 'google_title', 'parsed'),
      (1086::bigint, date '2026-05-29', '2+guida tagliere bruschette italy on a budget tours', 'cancelled', 2, 3, 2, 'google_title', 'parsed'),
      (1087::bigint, date '2026-05-31', '1+guida tagliere bruschette italy on a budget tours', 'cancelled', 1, 2, 1, 'google_title', 'parsed')
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

  -- Rentals: change only effective. ID 1102 retains U+202A/U+202C in the exact title.
  for expected in
    select * from (values
      (1102::bigint, date '2026-05-03', U&'2 e-bike solo noleggio Giovanni \202A+39 347 235 0672\202C', 'unknown', 'google_title', 'parsed'),
      (889::bigint, date '2026-05-24', '2 noleggio e-bike TOD-T126888790', 'unknown', 'historical', 'historical_reference'),
      (1062::bigint, date '2026-05-31', '2 noleggio ebike freedome 1011105', 'unknown', 'google_title', 'parsed')
    ) as targets(id, event_date, original_title, gcal_event_status, attendance_source, attendance_quality)
  loop
    update public.google_calendar_events as event
    set effective_total_guests = 0
    where event.id = expected.id
      and event.original_title = expected.original_title
      and event.event_date = expected.event_date
      and event.gcal_event_status = expected.gcal_event_status
      and event.observed_total_guests = 2
      and event.effective_total_guests = 2
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
          and event.observed_total_guests = 2
          and event.effective_total_guests = 0
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

  -- Explicit meals: require exact previous attendance and provenance before replacing them.
  for expected in
    select * from (values
      (837::bigint, date '2026-05-02', '9 Pranzo tuscan escape', 'unknown', 9, 'unclassified', 'historical', 'needs_review', 'gcal-attendance-review-v1', null, 9, 8),
      (853::bigint, date '2026-05-09', '9 Pranzo tuscan escape', 'unknown', 9, 'unclassified', 'historical', 'needs_review', 'gcal-attendance-review-v1', null, 9, 8),
      (857::bigint, date '2026-05-10', '7 Pranzo tuscan escape', 'unknown', 7, 'unclassified', 'historical', 'needs_review', 'gcal-attendance-review-v1', null, 7, 6),
      (871::bigint, date '2026-05-16', '8 Pranzo tuscan escape', 'unknown', 8, 'unclassified', 'historical', 'needs_review', 'gcal-attendance-review-v1', null, 8, 7),
      (900::bigint, date '2026-05-30', '8 pranzo tuscan escape', 'unknown', 8, 'unclassified', 'historical', 'needs_review', 'gcal-attendance-review-v1', null, 8, 7),
      (846::bigint, date '2026-05-04', '7 Pranzo tuscan escape', 'unknown', 7, 'operational_block', 'historical', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 7, 6),
      (882::bigint, date '2026-05-19', '7 Pranzo tuscan escape', 'unknown', 7, 'operational_block', 'historical', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 7, 6),
      (884::bigint, date '2026-05-21', '7 Pranzo tuscan escape', 'unknown', 7, 'operational_block', 'historical', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 7, 6),
      (893::bigint, date '2026-05-25', '9 Pranzo tuscan escape', 'unknown', 9, 'operational_block', 'historical', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 9, 8),
      (904::bigint, date '2026-05-31', '9 pranzo Tuscan escape', 'unknown', 9, 'operational_block', 'historical', 'unknown', 'gcal-attendance-review-v1', 'explicit_tuscan_escape_block', 9, 8),
      (847::bigint, date '2026-05-06', '3 pranzo villetta toscana', 'confirmed', 3, 'unclassified', 'historical', 'historical_reference', null, null, 3, 3),
      (1093::bigint, date '2026-05-29', '1+ bambino pranzo la Moscadella', 'unknown', null, 'unclassified', 'unknown', 'needs_review', 'gcal-attendance-review-v1', null, 2, 2)
    ) as targets(id, event_date, original_title, gcal_event_status, previous_effective, previous_classification,
                 previous_source, previous_quality, previous_parser_version, previous_exclusion_reason,
                 final_observed, final_effective)
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
      and event.effective_total_guests is not distinct from expected.previous_effective
      and event.event_classification = expected.previous_classification
      and event.attendance_source = expected.previous_source
      and event.attendance_quality = expected.previous_quality
      and event.attendance_parser_version is not distinct from expected.previous_parser_version
      and event.exclusion_reason is not distinct from expected.previous_exclusion_reason
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
end;
$correction$;

commit;
