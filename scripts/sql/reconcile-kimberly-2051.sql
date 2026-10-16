-- PREPARED ONLY. No execution authorized. Replace NULL with the reviewed JSON
-- snapshot and approver; never capture expected snapshots dynamically here.
-- Keep ROLLBACK for the first authorized rehearsal. COMMIT needs authorization.
begin;
set local lock_timeout = '5s';
do $repair$
declare
  snapshot jsonb := null; -- REVIEWED_SNAPSHOT
  approver text := null; -- REVIEWED_APPROVER
  explanation text := 'Operational cancellation already recorded; staging 563 linked by verified UID aliases and reference TOD-T144976349. No financial adjustment.';
  result text;
begin
  if snapshot is null or nullif(btrim(approver),'') is null then
    raise exception 'BLOCKED: full reviewed snapshots and named approver required';
  end if;
  lock table public.bookings, public.google_calendar_import_staging,
    public.google_calendar_events, public.google_calendar_event_aliases in share row exclusive mode;
  if (snapshot->'booking'->>'id')::bigint is distinct from 2051
    or snapshot->'booking'->>'booking_reference' is distinct from 'TOD-T144976349'
    or snapshot->'booking'->>'is_cancelled' is distinct from 'true'
    or (snapshot->'staging'->>'id')::bigint is distinct from 563
    or snapshot->'staging'->>'import_status' is distinct from 'gcal_cancelled'
    or snapshot->'staging'->'imported_booking_id' is distinct from 'null'::jsonb
    or (snapshot->'canonical'->>'id')::bigint is distinct from 1242
    or snapshot->'canonical'->>'gcal_event_status' is distinct from 'unknown'
    or snapshot->'canonical'->>'gcal_observation_verified' is distinct from 'false'
    or snapshot->'canonical'->'cancellation_reconciliation_history' is distinct from '[]'::jsonb
    or (select jsonb_agg((a->>'id')::bigint order by (a->>'id')::bigint) from jsonb_array_elements(snapshot->'aliases') a)
      is distinct from '[1579,1580]'::jsonb
    or exists (select 1 from jsonb_array_elements(snapshot->'aliases') a where a->>'verified' is distinct from 'true'
      or (a->>'event_id')::bigint is distinct from 1242)
    or (snapshot->'protected_2300'->>'id')::bigint is distinct from 2300
    or (snapshot->'protected_2322'->>'id')::bigint is distinct from 2322
    or snapshot->'protected_2322'->>'is_cancelled' is distinct from 'false' then
    raise exception 'Case facts mismatch';
  end if;
  if (select to_jsonb(b) from public.bookings b where id=2300) is distinct from snapshot->'protected_2300'
    or (select to_jsonb(b) from public.bookings b where id=2322) is distinct from snapshot->'protected_2322' then
    raise exception 'Protected booking snapshot mismatch';
  end if;
  result := public.approve_google_cancellation('kimberly-2051-staging-563-v1',approver,explanation,
    snapshot->'booking',snapshot->'staging',snapshot->'canonical',snapshot->'aliases');
  if (select to_jsonb(b) from public.bookings b where id=2051) is distinct from snapshot->'booking'
    or (select to_jsonb(b) from public.bookings b where id=2300) is distinct from snapshot->'protected_2300'
    or (select to_jsonb(b) from public.bookings b where id=2322) is distinct from snapshot->'protected_2322' then
    raise exception 'Booking preservation postcondition failed';
  end if;
  raise notice 'Reconciliation result: %; transaction still requires explicit COMMIT',result;
end;
$repair$;
rollback;
