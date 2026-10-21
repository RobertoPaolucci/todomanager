-- PREPARED ONLY. Dashboard read receipts, never operational reconciliation.
begin;
set local lock_timeout = '5s';

-- Logical IDs deliberately have no FKs: no change to existing delete behavior.
-- One receipt per meaningful snapshot, shared by the operational Dashboard.
create table public.google_calendar_dashboard_acknowledgements (
  staging_id bigint not null,
  event_version text not null check (event_version ~ '^v1:[0-9a-f]{32}$'),
  event_snapshot jsonb not null check (jsonb_typeof(event_snapshot) = 'object'),
  acknowledged_at timestamptz not null default clock_timestamp(),
  acknowledged_by uuid not null,
  primary key (staging_id, event_version)
);
alter table public.google_calendar_dashboard_acknowledgements enable row level security;
revoke all on public.google_calendar_dashboard_acknowledgements from public, anon, authenticated, service_role;
grant select, insert on public.google_calendar_dashboard_acknowledgements to service_role;

create index if not exists google_calendar_events_staging_id_idx on public.google_calendar_events(staging_id);

-- Version only meaningful content. Reception/updated timestamps, import links,
-- payments and bookings are deliberately excluded. Exact replays stay read.
-- Include canonical evidence even if staging was not updated by a legacy writer.
-- Match by staging/verified Google identity, NEVER by a commercial booking ref.
create view public.google_calendar_dashboard_alert_versions with (security_invoker=true) as
select s.*, snapshot.value as dashboard_event_snapshot,
  'v1:' || md5(snapshot.value::text) as dashboard_event_version
from public.google_calendar_import_review s
cross join lateral (
  select jsonb_build_object(
    'staging_id', s.id, 'gcal_uid', s.gcal_uid,
    'title', s.original_title, 'notes', s.notes,
    'date', s.booking_date, 'time', s.booking_time,
    'customer', s.customer_name, 'adults', s.adults, 'children', s.children, 'infants', s.infants,
    'experience_id', s.experience_id, 'channel_id', s.channel_id, 'source', s.booking_source,
    'import_status', s.import_status, 'review_required', s.cancellation_review_required,
    'canonical', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'namespace', e.identity_namespace, 'uid', e.canonical_uid, 'occurrence', e.occurrence_id,
        'status', e.gcal_event_status, 'title', e.original_title, 'date', e.event_date, 'time', e.event_time,
        'guests', e.effective_total_guests, 'classification', e.event_classification,
        'reconciliation_revision', jsonb_array_length(e.cancellation_reconciliation_history),
        'reconciliation_state', e.cancellation_reconciliation_history->-1->>'state',
        'reconciliation_observation', (e.cancellation_reconciliation_history->-1->'observation') - 'updated'
      ) order by e.id)
      from public.google_calendar_events e
      where e.staging_id = s.id or (e.identity_namespace = 'legacy_unscoped' and e.occurrence_id is null
        and exists (select 1 from public.google_calendar_event_aliases a
          where a.event_id=e.id and a.verified and a.original_uid=s.gcal_uid
            and a.identity_namespace=e.identity_namespace and a.canonical_uid=e.canonical_uid
            and a.occurrence_id is not distinct from e.occurrence_id))
    ), '[]'::jsonb)
  ) as value
) snapshot;

create view public.google_calendar_dashboard_alerts with (security_invoker=true) as
select v.*, exists (
  select 1 from public.google_calendar_dashboard_acknowledgements a
  where a.staging_id=v.id and a.event_version=v.dashboard_event_version
) as dashboard_acknowledged
from public.google_calendar_dashboard_alert_versions v;

-- The server checks the real Supabase user before invoking this service-only RPC.
-- Compare the displayed version inside the INSERT statement. A concurrent new
-- version remains unread; a stale browser cannot acknowledge unseen evidence.
create function public.acknowledge_google_calendar_dashboard_alert(
  alert_id bigint, expected_version text, actor_id uuid
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare matched_id bigint;
begin
  if actor_id is null then raise exception 'Authenticated actor required'; end if;
  insert into public.google_calendar_dashboard_acknowledgements
    (staging_id, event_version, event_snapshot, acknowledged_by)
  select v.id, v.dashboard_event_version, v.dashboard_event_snapshot, actor_id
  from public.google_calendar_dashboard_alert_versions v
  where v.id=alert_id and v.dashboard_event_version=expected_version
    and v.import_origin='make' and not v.cancellation_reconciled
    and (v.cancellation_review_required or v.import_status in
      ('pending','rolled_back','needs_review','possible_duplicate','gcal_cancelled'))
  on conflict (staging_id, event_version) do nothing
  returning staging_id into matched_id;
  return matched_id is not null or exists (
    select 1 from public.google_calendar_dashboard_alerts v
    where v.id=alert_id and v.dashboard_event_version=expected_version and v.dashboard_acknowledged
      and not v.cancellation_reconciled and v.import_origin='make'
  );
end;
$$;

revoke all on public.google_calendar_dashboard_alert_versions, public.google_calendar_dashboard_alerts
  from public, anon, authenticated;
grant select on public.google_calendar_dashboard_alert_versions, public.google_calendar_dashboard_alerts to service_role;
revoke all on function public.acknowledge_google_calendar_dashboard_alert(bigint,text,uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_google_calendar_dashboard_alert(bigint,text,uuid) to service_role;
comment on table public.google_calendar_dashboard_acknowledgements is
  'Shared read receipts only. No booking reconciliation, Google status change or removal of history.';
notify pgrst, 'reload schema';
commit;
