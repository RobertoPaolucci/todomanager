-- PREPARED ONLY. Apply before deploying the webhook change; no historical backfill.
begin;
set local lock_timeout = '5s';

alter table public.bookings add column total_to_you_source text;
alter table public.bookings add constraint bookings_total_to_you_source_check
  check (total_to_you_source is null or total_to_you_source in (
    'configured_price', 'bokun_webhook', 'bokun_api_backfill'
  ));

comment on column public.bookings.total_to_you_source is
  'Origin recorded by the Viator webhook/backfill. NULL means unknown; no historical inference or default.';
notify pgrst, 'reload schema';
commit;
