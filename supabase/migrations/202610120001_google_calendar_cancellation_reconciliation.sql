-- PREPARED ONLY: no application authorized. One append-only journal, no new tables.
begin;
set local lock_timeout = '5s';

alter table public.google_calendar_events add column if not exists cancellation_reconciliation_history jsonb
  not null default '[]'::jsonb check (jsonb_typeof(cancellation_reconciliation_history) = 'array');
comment on column public.google_calendar_events.cancellation_reconciliation_history is
  'Explicit operational decisions and reopen/revoke audit. Never evidence of Google status or chronology.';

create or replace function public.guard_google_cancellation_history() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.cancellation_reconciliation_history is distinct from old.cancellation_reconciliation_history
    and (jsonb_typeof(new.cancellation_reconciliation_history->-1) is distinct from 'object'
      or coalesce(new.cancellation_reconciliation_history->-1->>'state','') not in ('approved','reopened','revoked')
      or nullif(new.cancellation_reconciliation_history->-1->>'decision_id','') is null) then
    raise exception 'Invalid cancellation audit entry';
  end if;
  if new.cancellation_reconciliation_history is distinct from old.cancellation_reconciliation_history
    and current_user='service_role' and new.cancellation_reconciliation_history->-1->>'state' in ('approved','revoked') then
    raise exception 'Operational decision requires database owner';
  end if;
  if new.cancellation_reconciliation_history is distinct from old.cancellation_reconciliation_history
    and (jsonb_array_length(new.cancellation_reconciliation_history) <> jsonb_array_length(old.cancellation_reconciliation_history) + 1
      or new.cancellation_reconciliation_history - (jsonb_array_length(new.cancellation_reconciliation_history) - 1)
        is distinct from old.cancellation_reconciliation_history) then
    raise exception 'Cancellation history is append-only';
  end if;
  return new;
end;
$$;
create or replace trigger guard_google_cancellation_history before update on public.google_calendar_events
for each row execute function public.guard_google_cancellation_history();

create or replace function public.approve_google_cancellation(
  decision_id text, actor text, reason text, expected_booking jsonb,
  expected_staging jsonb, expected_canonical jsonb, expected_aliases jsonb
) returns text language plpgsql security invoker set search_path = public, pg_temp
set lock_timeout = '5s' as $$
declare
  b public.bookings; s public.google_calendar_import_staging; e public.google_calendar_events;
  aliases jsonb; entry jsonb; prior jsonb;
begin
  if nullif(btrim(decision_id),'') is null or nullif(btrim(actor),'') is null or nullif(btrim(reason),'') is null then
    raise exception 'Decision ID, approver and reason required';
  end if;
  -- Prevent phantom references/aliases/links as well as concurrent snapshot edits.
  lock table public.bookings, public.google_calendar_import_staging,
    public.google_calendar_events, public.google_calendar_event_aliases in share row exclusive mode;
  select * into b from public.bookings where id=(expected_booking->>'id')::bigint;
  select * into s from public.google_calendar_import_staging where id=(expected_staging->>'id')::bigint;
  select * into e from public.google_calendar_events where id=(expected_canonical->>'id')::bigint;
  if b.id is null or s.id is null or e.id is null then raise exception 'Missing target'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into aliases
    from public.google_calendar_event_aliases a where a.event_id=e.id;
  select value into prior from jsonb_array_elements(e.cancellation_reconciliation_history)
    where value->>'decision_id'=approve_google_cancellation.decision_id and value->>'state'='approved';
  if prior is not null then
    if prior->>'actor' is distinct from actor or prior->>'reason' is distinct from reason
      or prior->'booking_before' is distinct from expected_booking
      or prior->'staging_before' is distinct from expected_staging
      or prior->'canonical_before' is distinct from expected_canonical
      or prior->'aliases_before' is distinct from expected_aliases
      or e.cancellation_reconciliation_history->-1->>'state' <> 'approved'
      or e.cancellation_reconciliation_history->-1->>'decision_id' <> decision_id
      or to_jsonb(b) is distinct from expected_booking
      or to_jsonb(s) is distinct from expected_staging || jsonb_build_object('imported_booking_id',b.id)
      or to_jsonb(e)-'cancellation_reconciliation_history' is distinct from expected_canonical-'cancellation_reconciliation_history'
      or aliases is distinct from expected_aliases then raise exception 'Decision replay conflicts with current snapshot'; end if;
    return 'unchanged';
  end if;
  if to_jsonb(b) is distinct from expected_booking or to_jsonb(s) is distinct from expected_staging
    or to_jsonb(e) is distinct from expected_canonical or aliases is distinct from expected_aliases then
    raise exception 'Snapshot mismatch';
  end if;
  if b.is_cancelled is distinct from true or s.import_status is distinct from 'gcal_cancelled'
    or (s.imported_booking_id is not null and s.imported_booking_id <> b.id)
    or e.cancellation_reconciliation_history->-1->>'state' = 'approved' then
    raise exception 'Operational cancellation or unreconciled staging required';
  end if;
  -- Identity requires verified UID mapping AND a unique exact reference token.
  -- A customer name, even identical, is never evidence for this procedure.
  if nullif(btrim(b.booking_reference),'') is null
    or exists (select 1 from jsonb_array_elements(e.cancellation_reconciliation_history) h
      where (h->>'staging_id')::bigint is distinct from s.id or (h->>'booking_id')::bigint is distinct from b.id)
    or exists (select 1 from public.google_calendar_events other where other.id<>e.id
      and exists (select 1 from jsonb_array_elements(other.cancellation_reconciliation_history) h where (h->>'staging_id')::bigint=s.id))
    or not coalesce((s.booking_reference = b.booking_reference or
      upper(coalesce(s.original_title,'') || ' ' || coalesce(s.notes,'')) ~
        ('(^|[^A-Z0-9])' || regexp_replace(upper(b.booking_reference),'^TOD-','') || '([^A-Z0-9]|$)')),false)
    or b.booking_reference !~ '^[A-Za-z0-9_-]+$'
    or (select count(*) from public.bookings where upper(booking_reference)=upper(b.booking_reference)) <> 1
    or not exists (select 1 from public.google_calendar_event_aliases a where a.event_id=e.id
      and a.verified and a.original_uid=s.gcal_uid and a.canonical_uid=e.canonical_uid
      and a.identity_namespace=e.identity_namespace and a.occurrence_id is not distinct from e.occurrence_id)
    or exists (select 1 from public.google_calendar_event_aliases a where a.event_id=e.id and not a.verified)
    or exists (select 1 from public.google_calendar_import_staging other where other.id<>s.id
      and (other.imported_booking_id=b.id or other.gcal_uid in
        (select original_uid from public.google_calendar_event_aliases where event_id=e.id))) then
    raise exception 'Ambiguous or insufficient reference/UID identity';
  end if;
  -- Review existing UPDATE hooks before any historical repair.
  if exists (select 1 from pg_trigger where tgrelid in
      ('public.google_calendar_import_staging'::regclass,'public.google_calendar_events'::regclass)
      and not tgisinternal and tgenabled <> 'D' and (tgtype::integer & 16) <> 0
      and not (tgtype=19 and tgnargs=0 and tgqual is null and (
        (tgrelid='public.google_calendar_events'::regclass and tgname='guard_google_cancellation_history'
          and tgfoid is not distinct from to_regprocedure('public.guard_google_cancellation_history()'))
        or (tgrelid='public.google_calendar_import_staging'::regclass and tgname='guard_reconciled_google_staging'
          and tgfoid is not distinct from to_regprocedure('public.guard_reconciled_google_staging()')))))
    or exists (select 1 from pg_rewrite where ev_class in
      ('public.google_calendar_import_staging'::regclass,'public.google_calendar_events'::regclass)
      and ev_type='2' and ev_enabled<>'D') then raise exception 'Review UPDATE hooks before reconciliation'; end if;
  entry := jsonb_build_object('decision_id',decision_id,'state','approved','actor',actor,'reason',reason,
    'recorded_at',clock_timestamp(),'booking_id',b.id,'staging_id',s.id,
    'booking_before',expected_booking,'staging_before',expected_staging,
    'canonical_before',expected_canonical,'aliases_before',expected_aliases);
  update public.google_calendar_import_staging set imported_booking_id=b.id where id=s.id;
  update public.google_calendar_events set cancellation_reconciliation_history=cancellation_reconciliation_history || entry where id=e.id;
  if (select to_jsonb(row) from public.google_calendar_import_staging row where id=s.id)
      is distinct from expected_staging || jsonb_build_object('imported_booking_id',b.id)
    or (select to_jsonb(row)-'cancellation_reconciliation_history' from public.google_calendar_events row where id=e.id)
      is distinct from expected_canonical-'cancellation_reconciliation_history' then raise exception 'Unexpected repair side effect'; end if;
  return 'approved';
end;
$$;

-- Only called with authenticated, normalized Google metadata after UID resolution.
-- This records conflicting evidence even when legacy chronology blocks canonical sync.
create or replace function public.observe_reconciled_google_cancellation(event_id bigint, observation jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare e public.google_calendar_events; last_entry jsonb; approval jsonb; baseline jsonb; incompatible boolean;
begin
  select * into e from public.google_calendar_events where id=event_id for update;
  if not found then raise exception 'Missing canonical'; end if;
  last_entry := e.cancellation_reconciliation_history->-1;
  if last_entry->>'state' is distinct from 'approved' then return e.cancellation_reconciliation_history; end if;
  if coalesce(observation->>'status','') not in ('confirmed','tentative','cancelled')
    or observation->>'updated' is null then raise exception 'Verified Google observation required'; end if;
  approval := last_entry;
  baseline := approval->'canonical_before';
  -- A legacy timestamp is never used to discard potentially newer evidence.
  if (e.gcal_observation_verified and (observation->>'updated')::timestamptz < e.gcal_updated_at)
    or ((baseline->>'gcal_observation_verified')::boolean is true
      and (observation->>'updated')::timestamptz < (baseline->>'gcal_updated_at')::timestamptz) then
    return e.cancellation_reconciliation_history;
  end if;
  incompatible := observation->>'status' <> 'cancelled'
    or (observation->>'title' is not null and observation->>'title' is distinct from approval->'staging_before'->>'original_title')
    or (observation->>'date' is not null and observation->>'date' is distinct from approval->'staging_before'->>'booking_date')
    or (observation->>'time' is not null and left(observation->>'time',5) is distinct from left(approval->'staging_before'->>'booking_time',5))
    or (observation->>'calendar_id' is not null and baseline->>'calendar_id' is not null
      and observation->>'calendar_id' <> baseline->>'calendar_id');
  if incompatible then
    e.cancellation_reconciliation_history := e.cancellation_reconciliation_history || jsonb_build_object(
      'state','reopened','decision_id',approval->>'decision_id','actor','google_webhook',
      'reason','incompatible_google_observation','recorded_at',clock_timestamp(),
      'booking_id',approval->'booking_id','staging_id',approval->'staging_id','observation',observation);
    update public.google_calendar_events set cancellation_reconciliation_history=e.cancellation_reconciliation_history where id=e.id;
  end if;
  return e.cancellation_reconciliation_history;
end;
$$;

-- Compensating rollback, only against exact current snapshots. Audit is retained.
create or replace function public.revoke_google_cancellation(expected_canonical jsonb, expected_staging jsonb,
  actor text, reason text) returns text language plpgsql security invoker set search_path = public, pg_temp
set lock_timeout = '5s' as $$
declare e public.google_calendar_events; s public.google_calendar_import_staging; approval jsonb; last_entry jsonb;
begin
  if nullif(btrim(actor),'') is null or nullif(btrim(reason),'') is null then raise exception 'Approver and reason required'; end if;
  lock table public.google_calendar_import_staging, public.google_calendar_events in share row exclusive mode;
  select * into e from public.google_calendar_events where id=(expected_canonical->>'id')::bigint;
  select * into s from public.google_calendar_import_staging where id=(expected_staging->>'id')::bigint;
  last_entry := e.cancellation_reconciliation_history->-1;
  if last_entry->>'state'='revoked' and to_jsonb(e)-'cancellation_reconciliation_history'=expected_canonical-'cancellation_reconciliation_history'
    and e.cancellation_reconciliation_history - (jsonb_array_length(e.cancellation_reconciliation_history)-1)=expected_canonical->'cancellation_reconciliation_history'
    and last_entry->>'actor'=actor and last_entry->>'reason'=reason
    and to_jsonb(s)=last_entry->'staging_after' then return 'unchanged'; end if;
  if to_jsonb(e) is distinct from expected_canonical or to_jsonb(s) is distinct from expected_staging
    or last_entry->>'state' not in ('approved','reopened') or last_entry is null
    or (last_entry->>'staging_id')::bigint is distinct from s.id then raise exception 'Rollback snapshot mismatch'; end if;
  select value into approval from jsonb_array_elements(e.cancellation_reconciliation_history)
    where value->>'state'='approved' and value->>'decision_id'=last_entry->>'decision_id';
  if to_jsonb(s) is distinct from approval->'staging_before' || jsonb_build_object('imported_booking_id',approval->'booking_id') then
    raise exception 'Staging changed since approval: manual rollback required';
  end if;
  update public.google_calendar_events set cancellation_reconciliation_history=cancellation_reconciliation_history ||
    jsonb_build_object('state','revoked','decision_id',last_entry->>'decision_id','actor',actor,'reason',reason,
      'recorded_at',clock_timestamp(),'booking_id',last_entry->'booking_id','staging_id',s.id,'staging_after',approval->'staging_before') where id=e.id;
  update public.google_calendar_import_staging set imported_booking_id=(approval->'staging_before'->>'imported_booking_id')::bigint where id=s.id;
  if (select to_jsonb(row) from public.google_calendar_import_staging row where id=s.id)
    is distinct from approval->'staging_before' then raise exception 'Rollback side effect'; end if;
  return 'revoked';
end;
$$;

-- Protect the approved link from legacy Ignore/Reset actions; webhook edits are
-- still accepted and become review evidence in the projection below.
create or replace function public.guard_reconciled_google_staging() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.google_calendar_events e
    where (e.cancellation_reconciliation_history->-1->>'staging_id')::bigint=old.id
      and e.cancellation_reconciliation_history->-1->>'state' in ('approved','reopened'))
    and (new.imported_booking_id is distinct from old.imported_booking_id or new.import_status in ('ignored','pending','rolled_back')) then
    raise exception 'Explicit cancellation reconciliation rollback required';
  end if;
  return new;
end;
$$;
create or replace trigger guard_reconciled_google_staging before update on public.google_calendar_import_staging
for each row execute function public.guard_reconciled_google_staging();

-- Existing Tuscan RPC deliberately refuses unknown UPDATE hooks. Whitelist
-- exactly this audited guard; it does nothing to stages without reconciliation.
-- Keep its complete existing implementation/permissions and refuse unknown code.
do $tuscan_compatibility$
declare
  target regprocedure := to_regprocedure('public.reconcile_tuscan_google_booking(jsonb,jsonb,jsonb,jsonb)');
  definition text;
  original_guard text := 'and not tgisinternal and tgenabled <> ''D'' and (tgtype::integer & 16) <> 0';
  approved_guard text := 'and not (tgrelid=''public.google_calendar_import_staging''::regclass and tgname=''guard_reconciled_google_staging'' and tgfoid is not distinct from to_regprocedure(''public.guard_reconciled_google_staging()'') and tgtype=19 and tgnargs=0 and tgqual is null) and not tgisinternal and tgenabled <> ''D'' and (tgtype::integer & 16) <> 0';
begin
  if target is not null then
    definition := pg_get_functiondef(target);
    if position(approved_guard in definition)=0 then
      if (length(definition)-length(replace(definition,original_guard,'')))/length(original_guard) <> 1 then
        raise exception 'Review Tuscan RPC hook policy before installing reconciliation';
      end if;
      execute replace(definition,original_guard,approved_guard);
    end if;
  end if;
end;
$tuscan_compatibility$;

create or replace function public.preserve_google_cancellation_history() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name='google_calendar_events' then
    if jsonb_array_length(old.cancellation_reconciliation_history)>0 then raise exception 'Preserve cancellation audit'; end if;
  elsif exists (select 1 from public.google_calendar_events e
    where (e.cancellation_reconciliation_history->-1->>'staging_id')::bigint=old.id) then
    raise exception 'Preserve cancellation staging history';
  end if;
  return old;
end;
$$;
create or replace trigger preserve_google_cancellation_history before delete on public.google_calendar_events
for each row execute function public.preserve_google_cancellation_history();
create or replace trigger preserve_google_cancellation_staging before delete on public.google_calendar_import_staging
for each row execute function public.preserve_google_cancellation_history();

create or replace view public.google_calendar_cancellation_state with (security_invoker=true) as
select e.id as event_id, (last_entry->>'staging_id')::bigint as staging_id,
  last_entry->>'state' as decision_state,
  coalesce(last_entry->>'state' in ('approved','reopened'),false) as operationally_excluded,
  coalesce(last_entry->>'state'='approved' and b.is_cancelled is true
    and s.imported_booking_id=b.id and s.import_status='gcal_cancelled'
    and s.original_title is not distinct from approval->'staging_before'->>'original_title'
    and s.booking_date::text is not distinct from approval->'staging_before'->>'booking_date'
    and left(s.booking_time::text,5) is not distinct from left(approval->'staging_before'->>'booking_time',5),false) as reconciled,
  e.cancellation_reconciliation_history as history,
  e.gcal_event_status as observed_google_status, e.gcal_observation_verified as google_observation_verified
from public.google_calendar_events e
cross join lateral (select e.cancellation_reconciliation_history->-1 as last_entry) l
left join lateral (select value as approval from jsonb_array_elements(e.cancellation_reconciliation_history)
  where value->>'state'='approved' and value->>'decision_id'=last_entry->>'decision_id') a on true
left join public.bookings b on b.id=(last_entry->>'booking_id')::bigint
left join public.google_calendar_import_staging s on s.id=(last_entry->>'staging_id')::bigint;

create or replace view public.google_calendar_import_review with (security_invoker=true) as
select s.*, coalesce(c.reconciled,false) as cancellation_reconciled,
  coalesce(c.operationally_excluded and not c.reconciled,false) as cancellation_review_required,
  coalesce(c.history,'[]'::jsonb) as cancellation_history,
  c.observed_google_status, c.google_observation_verified
from public.google_calendar_import_staging s
left join public.google_calendar_cancellation_state c on c.staging_id=s.id;

create or replace view public.google_calendar_operational_events with (security_invoker=true) as
select e.* from public.google_calendar_events e join public.google_calendar_cancellation_state c on c.event_id=e.id
where not c.operationally_excluded;

create or replace view public.google_calendar_events_monthly_control with (security_invoker=true) as
select date_trunc('month',e.event_date::timestamp)::date as event_month,
  count(*) as canonical_events,
  count(*) filter (where e.event_classification in ('customer_event','unclassified') and e.gcal_event_status<>'cancelled' and not c.operationally_excluded) as eligible_events,
  sum(e.effective_total_guests) filter (where e.event_classification in ('customer_event','unclassified') and e.gcal_event_status<>'cancelled' and not c.operationally_excluded) as effective_presences,
  count(*) filter (where e.event_classification in ('operational_block','test')) as excluded_events,
  count(*) filter (where e.gcal_event_status='cancelled') as cancelled_events,
  count(*) filter (where e.effective_total_guests is null) as null_attendance_events,
  count(*) filter (where e.event_classification in ('customer_event','unclassified') and e.gcal_event_status<>'cancelled' and not c.operationally_excluded and e.effective_total_guests is null) as eligible_null_attendance_events,
  count(*) filter (where e.gcal_event_status='unknown') as unknown_status_events,
  count(*) filter (where c.operationally_excluded) as reconciled_excluded_events
from public.google_calendar_events e join public.google_calendar_cancellation_state c on c.event_id=e.id
group by date_trunc('month',e.event_date::timestamp)::date;

revoke all on function public.approve_google_cancellation(text,text,text,jsonb,jsonb,jsonb,jsonb),
  public.revoke_google_cancellation(jsonb,jsonb,text,text), public.observe_reconciled_google_cancellation(bigint,jsonb),
  public.guard_google_cancellation_history(), public.guard_reconciled_google_staging(),
  public.preserve_google_cancellation_history() from public,anon,authenticated;
-- Approval/rollback intentionally remain owner-only, via separately approved SQL.
revoke all on function public.approve_google_cancellation(text,text,text,jsonb,jsonb,jsonb,jsonb),
  public.revoke_google_cancellation(jsonb,jsonb,text,text) from service_role;
grant execute on function public.observe_reconciled_google_cancellation(bigint,jsonb) to service_role;
revoke all on public.google_calendar_cancellation_state,public.google_calendar_import_review,
  public.google_calendar_operational_events from public,anon,authenticated;
grant select on public.google_calendar_cancellation_state,public.google_calendar_import_review,
  public.google_calendar_operational_events to service_role;
notify pgrst, 'reload schema';
commit;
