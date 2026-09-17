-- PHASE 1: prepared only. No historical backfill or operational integration.
-- Requires PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT).
begin;
set local lock_timeout = '5s';
do $version_check$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'Phase 1 requires PostgreSQL 15+; no tables created';
  end if;
end;
$version_check$;

create table public.google_calendar_events (
  id bigint generated always as identity primary key,
  calendar_id text,
  identity_namespace text not null default 'legacy_unscoped'
    check (identity_namespace <> '' and identity_namespace = btrim(identity_namespace)),
  canonical_uid text not null check (canonical_uid <> '' and canonical_uid = btrim(canonical_uid)),
  original_uid text not null check (btrim(original_uid) <> ''),
  uid_kind text not null check (uid_kind in ('google', 'synthetic')),
  uid_semantics text not null default 'legacy_unknown'
    check (uid_semantics in ('legacy_unknown', 'event_id', 'ical_uid', 'synthetic')),
  occurrence_id text,
  gcal_event_id text,
  gcal_ical_uid text,
  recurring_event_id text,
  original_start_at timestamptz,
  original_start_date date,
  original_start_timezone text,
  event_date date,
  event_time time without time zone,
  original_title text,
  gcal_html_link text,
  gcal_event_status text not null default 'unknown'
    check (gcal_event_status in ('confirmed', 'tentative', 'cancelled', 'unknown')),
  gcal_updated_at timestamptz,
  gcal_received_at timestamptz,
  historical_booking_id bigint unique,
  staging_id bigint,
  historical_source text,
  historical_snapshot_at timestamptz,
  historical_total_guests integer check (historical_total_guests >= 0),
  observed_total_guests integer check (observed_total_guests >= 0),
  effective_total_guests integer check (effective_total_guests >= 0),
  attendance_source text not null default 'unknown'
    check (attendance_source in ('historical', 'google_title', 'google_fields', 'unknown')),
  attendance_quality text not null default 'unknown'
    check (attendance_quality in ('historical_reference', 'parsed', 'needs_review', 'unknown')),
  attendance_parser_version text,
  event_classification text not null default 'unclassified'
    check (event_classification in ('customer_event', 'operational_block', 'test', 'unclassified')),
  exclusion_reason text,
  last_observation_source text not null
    check (last_observation_source in ('historical_bookings', 'google_calendar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_events_identity_key
    unique nulls not distinct (identity_namespace, canonical_uid, occurrence_id),
  constraint google_calendar_events_id_uid_key unique (id, identity_namespace, canonical_uid),
  constraint google_calendar_events_occurrence_identity check (
    occurrence_id is null or uid_semantics = 'ical_uid'
  ),
  constraint google_calendar_events_original_start_exclusive check (
    original_start_at is null or original_start_date is null
  ),
  constraint google_calendar_events_exclusion_required check (
    event_classification not in ('operational_block', 'test')
    or nullif(btrim(exclusion_reason), '') is not null
  ),
  constraint google_calendar_events_scope_not_empty check (
    (calendar_id is null or btrim(calendar_id) <> '')
    and (occurrence_id is null or btrim(occurrence_id) <> '')
  )
);

-- Logical historical/staging references deliberately have no FK to existing
-- tables: Phase 1 must not change their delete/update behavior.
comment on column public.google_calendar_events.effective_total_guests is
  'NULL = unknown attendance, never an inferred zero. Exclusion is separate.';
comment on column public.google_calendar_events.historical_snapshot_at is
  'Actual Calendar snapshot time if independently known; not historical row created_at.';
comment on column public.google_calendar_events.updated_at is
  'Maintained explicitly by future writers. Phase 1 has no update trigger.';
comment on column public.google_calendar_events.gcal_event_status is
  'Google event state, independent of staging import_status. Historical state retains snapshot provenance.';
comment on column public.google_calendar_events.identity_namespace is
  'Stable identity scope, NOT a fabricated Calendar ID. Legacy scope must be reconciled before enabling another calendar.';
comment on column public.google_calendar_events.occurrence_id is
  'Identity discriminator only for verified recurring iCalUID input; immutable original start, never current event_date.';
comment on column public.google_calendar_events.last_observation_source is
  'Latest observation provenance; independent of the retained historical reference and historical_source.';

create index google_calendar_events_event_date_idx on public.google_calendar_events(event_date);
create unique index google_calendar_events_google_id_key
  on public.google_calendar_events(identity_namespace, gcal_event_id)
  where gcal_event_id is not null;
create unique index google_calendar_events_recurring_time_key
  on public.google_calendar_events(identity_namespace, recurring_event_id, original_start_at)
  where recurring_event_id is not null and original_start_at is not null;
create unique index google_calendar_events_recurring_date_key
  on public.google_calendar_events(identity_namespace, recurring_event_id, original_start_date)
  where recurring_event_id is not null and original_start_date is not null;

create table public.google_calendar_event_aliases (
  id bigint generated always as identity primary key,
  event_id bigint not null,
  calendar_id text,
  identity_namespace text not null default 'legacy_unscoped'
    check (identity_namespace <> '' and identity_namespace = btrim(identity_namespace)),
  occurrence_id text,
  original_uid text not null check (btrim(original_uid) <> ''),
  canonical_uid text not null check (canonical_uid <> '' and canonical_uid = btrim(canonical_uid)),
  alias_type text not null check (alias_type in ('google_uid', 'base32hex', 'synthetic_manual', 'synthetic_test')),
  reconciliation_method text not null
    check (reconciliation_method in ('identity', 'base32hex_roundtrip', 'unresolved_manual', 'explicit_test', 'manual_verified')),
  verified boolean not null default false,
  historical_booking_id bigint,
  created_at timestamptz not null default now(),
  constraint google_calendar_event_aliases_event_fk foreign key (event_id, identity_namespace, canonical_uid)
    references public.google_calendar_events(id, identity_namespace, canonical_uid)
    deferrable initially immediate,
  constraint google_calendar_event_aliases_identity_key
    unique nulls not distinct (identity_namespace, original_uid, occurrence_id),
  constraint google_calendar_event_aliases_scope_not_empty check (
    (calendar_id is null or btrim(calendar_id) <> '')
    and (occurrence_id is null or btrim(occurrence_id) <> '')
  )
);

comment on column public.google_calendar_event_aliases.verified is
  'Verified identity mapping, not verification that the Google event is currently active.';

alter table public.google_calendar_events enable row level security;
alter table public.google_calendar_event_aliases enable row level security;
revoke all on public.google_calendar_events, public.google_calendar_event_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_events, public.google_calendar_event_aliases to service_role;
grant usage, select on sequence public.google_calendar_events_id_seq, public.google_calendar_event_aliases_id_seq to service_role;

-- Aggregate view is not automatically updatable. Server-side inspection only.
-- unknown/tentative are included in this diagnostic sum, not a chart policy.
create view public.google_calendar_events_monthly_control
with (security_invoker = true) as
select
  date_trunc('month', event_date::timestamp)::date as event_month,
  count(*) as canonical_events,
  count(*) filter (where event_classification in ('customer_event', 'unclassified') and gcal_event_status <> 'cancelled') as eligible_events,
  sum(effective_total_guests) filter (
    where event_classification in ('customer_event', 'unclassified') and gcal_event_status <> 'cancelled'
  ) as effective_presences,
  count(*) filter (where event_classification in ('operational_block', 'test')) as excluded_events,
  count(*) filter (where gcal_event_status = 'cancelled') as cancelled_events,
  count(*) filter (where effective_total_guests is null) as null_attendance_events,
  count(*) filter (where event_classification in ('customer_event', 'unclassified') and gcal_event_status <> 'cancelled'
    and effective_total_guests is null) as eligible_null_attendance_events,
  count(*) filter (where gcal_event_status = 'unknown') as unknown_status_events
from public.google_calendar_events
group by date_trunc('month', event_date::timestamp)::date;

comment on view public.google_calendar_events_monthly_control is
  'Diagnostic only. SUM ignores unknown attendance; inspect NULL counters. No dashboard connection.';
revoke all on public.google_calendar_events_monthly_control from public, anon, authenticated;
grant select on public.google_calendar_events_monthly_control to service_role;

notify pgrst, 'reload schema';
commit;
