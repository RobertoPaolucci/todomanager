-- PREPARED ONLY: do not apply during Phase 1. No seed mappings or historical DML.
begin;
set local lock_timeout = '5s';

-- Supporting key for a declarative same-business-unit FK. Existing PK id makes
-- this non-restrictive for existing experience data. No bookings constraints.
alter table public.experiences add constraint experiences_viator_id_business_unit_key
  unique (id, business_unit_id);

create table public.viator_product_mappings (
  id bigint generated always as identity primary key,
  business_unit_id bigint not null references public.business_units(id),
  viator_product_code text not null check (viator_product_code ~ '^[0-9]+P[0-9]+$'),
  viator_tour_grade_code text not null check (viator_tour_grade_code ~ '^TG[0-9]+(~[^[:space:]]+)?$'),
  experience_id bigint not null,
  default_time time without time zone,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint viator_product_mappings_identity_key
    unique (business_unit_id, viator_product_code, viator_tour_grade_code),
  constraint viator_product_mappings_experience_scope_fk
    foreign key (experience_id, business_unit_id) references public.experiences(id, business_unit_id)
);

create table public.viator_email_imports (
  id bigint generated always as identity primary key,
  business_unit_id bigint not null default 1 references public.business_units(id)
    check (business_unit_id = 1),
  message_id text unique check (message_id is null or (message_id = btrim(message_id) and message_id <> '')),
  received_at timestamptz,
  subject text,
  sender text,
  raw_body text not null check (btrim(raw_body) <> ''),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  event_type text not null default 'unknown' check (event_type in ('confirmed', 'modified', 'cancelled', 'unknown')),
  booking_reference text check (booking_reference is null or booking_reference ~ '^BR-[0-9]+$'),
  viator_product_code text,
  viator_tour_grade_code text,
  parsed_data jsonb not null default '{}'::jsonb check (jsonb_typeof(parsed_data) = 'object'),
  status text not null default 'archived' check (status in (
    'archived', 'processing', 'processing_failed', 'ready', 'needs_mapping', 'duplicate_candidate',
    'needs_review', 'modified', 'cancelled', 'modification_unmatched', 'cancellation_unmatched'
  )),
  -- Reserved logical link, deliberately NULL in Phase 1. No FK/trigger on bookings.
  booking_id bigint,
  error_message text,
  parser_version text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_started_at timestamptz,
  constraint viator_email_imports_processing_lease check (
    (status = 'processing') = (processing_started_at is not null)
  )
);

create index viator_email_imports_review_idx on public.viator_email_imports (business_unit_id, status, id desc);
create index viator_email_imports_reference_idx on public.viator_email_imports (business_unit_id, booking_reference);
create index viator_email_imports_hash_idx on public.viator_email_imports (content_hash);

comment on column public.viator_email_imports.raw_body is 'Original Make body, including HTML. Never replaced by normalized text.';
comment on column public.viator_email_imports.received_at is 'Source timestamp when valid; NULL if unavailable. Server receipt is created_at; original retained in raw_payload.';
comment on column public.viator_email_imports.booking_id is 'Reserved for verified future links; Phase 1 uses only parsed_data.classification.candidate_booking_ids.';
comment on column public.viator_email_imports.attempts is 'Claimed processing attempts, not count of duplicate HTTP deliveries.';
comment on column public.viator_email_imports.processed_at is 'Classification completed, not booking mutation time.';
comment on column public.viator_product_mappings.updated_at is 'Future mapping writers must explicitly maintain this timestamp.';

alter table public.viator_email_imports enable row level security;
alter table public.viator_product_mappings enable row level security;
-- Reset inherited/default grants as well (Supabase may grant ALL by default).
revoke all on public.viator_email_imports, public.viator_product_mappings from public, anon, authenticated, service_role;
revoke all on sequence public.viator_email_imports_id_seq, public.viator_product_mappings_id_seq from public, anon, authenticated, service_role;
grant select, insert, update on public.viator_email_imports to service_role;
grant select, insert, update, delete on public.viator_product_mappings to service_role;
grant usage, select on sequence public.viator_email_imports_id_seq, public.viator_product_mappings_id_seq to service_role;

notify pgrst, 'reload schema';
commit;
