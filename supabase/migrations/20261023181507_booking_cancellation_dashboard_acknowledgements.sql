-- PREPARED ONLY: do not apply as part of local development.
begin;
set local lock_timeout = '5s';

-- Separate from bookings and from Google Calendar read receipts. No FKs/cascades.
create table public.booking_cancellation_alert_revisions (
  booking_id bigint primary key,
  revision bigint not null check (revision > 0)
);
create table public.booking_cancellation_dashboard_acknowledgements (
  booking_id bigint not null,
  event_version text not null check (event_version ~ '^v1:[0-9a-f]{32}$'),
  event_snapshot jsonb not null check (jsonb_typeof(event_snapshot) = 'object'),
  acknowledged_at timestamptz not null default clock_timestamp(),
  acknowledged_by uuid not null,
  primary key (booking_id, event_version)
);
alter table public.booking_cancellation_alert_revisions enable row level security;
alter table public.booking_cancellation_dashboard_acknowledgements enable row level security;
revoke all on public.booking_cancellation_alert_revisions,
  public.booking_cancellation_dashboard_acknowledgements from public, anon, authenticated, service_role;
grant select, insert, update on public.booking_cancellation_alert_revisions to service_role;
grant select, insert on public.booking_cancellation_dashboard_acknowledgements to service_role;

-- Explicit meaningful fields only. No timestamps, cancellation timestamps, notes,
-- references, money, payments or suppliers. Formatting-only replays stay read.
create function public.booking_cancellation_alert_snapshot(b public.bookings)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'kind', 'booking_cancelled', 'booking_id', b.id,
    'date', b.booking_date, 'time', b.booking_time,
    'people', coalesce(b.total_people, 0),
    'customer', lower(regexp_replace(trim(coalesce(b.customer_name, '')), '[[:space:]]+', ' ', 'g')),
    'experience_id', b.experience_id,
    'experience', lower(regexp_replace(trim(coalesce(b.experience_name, '')), '[[:space:]]+', ' ', 'g')),
    'channel_id', b.channel_id,
    'source', lower(trim(coalesce(b.booking_source, '')))
  );
$$;

-- Necessary to distinguish cancelled -> restored -> cancelled with identical
-- content, even if nobody visited the Dashboard between the two transitions.
-- Only this auxiliary table is written. Existing booking writes use service_role.
create function public.track_booking_cancellation_alert_revision()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if old.is_cancelled is true and
      public.booking_cancellation_alert_snapshot(old) = public.booking_cancellation_alert_snapshot(new) then
      return new;
    end if;
  end if;
  insert into public.booking_cancellation_alert_revisions as r (booking_id, revision)
    values (new.id, 1)
    on conflict (booking_id) do update set revision = r.revision + 1;
  return new;
end;
$$;

create trigger track_booking_cancellation_alert_revision
after insert or update of is_cancelled, booking_date, booking_time, total_people,
  customer_name, experience_id, experience_name, channel_id, booking_source on public.bookings
for each row when (new.is_cancelled is true)
execute function public.track_booking_cancellation_alert_revision();

-- The trigger's DDL lock also prevents writes racing this initial seed.
insert into public.booking_cancellation_alert_revisions (booking_id, revision)
select id, 1 from public.bookings where is_cancelled is true;

create view public.booking_cancellation_alert_versions with (security_invoker=true) as
select b.id, snapshot.value as dashboard_event_snapshot,
  'v1:' || md5(snapshot.value::text) as dashboard_event_version
from public.bookings b
join public.booking_cancellation_alert_revisions r on r.booking_id=b.id
cross join lateral (
  select public.booking_cancellation_alert_snapshot(b) || jsonb_build_object('revision', r.revision) as value
) snapshot
-- Only the known cancellation heading. Mixed/other alerts retain their old behavior.
where b.is_cancelled is true
  and b.notes ~ '^\s*🔴[[:blank:]]*Prenotazione cancellata[[:blank:]]*(\r?\n|$)'
  and b.notes !~ '[🟡🟢]'
  and length(b.notes) - length(replace(b.notes, '🔴', '')) = 1;

create view public.booking_dashboard_alerts with (security_invoker=true) as
select b.id, b.customer_name, b.experience_name, b.notes, b.booking_date,
  b.total_people, b.booking_source, b.is_cancelled, v.dashboard_event_version,
  exists (
    select 1 from public.booking_cancellation_dashboard_acknowledgements a
    where a.booking_id=b.id and a.event_version=v.dashboard_event_version
  ) as dashboard_acknowledged
from public.bookings b
left join public.booking_cancellation_alert_versions v on v.id=b.id;

-- Actor comes exclusively from auth.getUser in the Server Action.
-- Compare and insert atomically: a stale client cannot hide a newer version.
create function public.acknowledge_booking_cancellation_alert(
  alert_id bigint, expected_version text, actor_id uuid
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare matched_id bigint;
begin
  if actor_id is null then raise exception 'Authenticated actor required'; end if;
  insert into public.booking_cancellation_dashboard_acknowledgements
    (booking_id, event_version, event_snapshot, acknowledged_by)
  select v.id, v.dashboard_event_version, v.dashboard_event_snapshot, actor_id
  from public.booking_cancellation_alert_versions v
  where v.id=alert_id and v.dashboard_event_version=expected_version
  on conflict (booking_id, event_version) do nothing
  returning booking_id into matched_id;
  return matched_id is not null or exists (
    select 1 from public.booking_dashboard_alerts v
    where v.id=alert_id and v.dashboard_event_version=expected_version and v.dashboard_acknowledged
  );
end;
$$;

revoke all on public.booking_cancellation_alert_versions, public.booking_dashboard_alerts
  from public, anon, authenticated, service_role;
grant select on public.booking_cancellation_alert_versions, public.booking_dashboard_alerts to service_role;
revoke all on function public.booking_cancellation_alert_snapshot(public.bookings),
  public.track_booking_cancellation_alert_revision(),
  public.acknowledge_booking_cancellation_alert(bigint,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.booking_cancellation_alert_snapshot(public.bookings),
  public.track_booking_cancellation_alert_revision(),
  public.acknowledge_booking_cancellation_alert(bigint,text,uuid) to service_role;
comment on table public.booking_cancellation_dashboard_acknowledgements is
  'Shared Dashboard read receipts only; never changes bookings or Google Calendar acknowledgements.';
notify pgrst, 'reload schema';
commit;
