-- PREPARED ONLY: apply manually before deploying this feature. No backfill.
begin;
set local lock_timeout = '5s';

alter table public.bookings
  add column agreed_unit_price numeric(12,2) default null;

alter table public.bookings add constraint bookings_agreed_unit_price_check
  check (agreed_unit_price is null or
    (agreed_unit_price >= 0 and agreed_unit_price < 'Infinity'::numeric
     and agreed_unit_price <> 'NaN'::numeric));

comment on column public.bookings.agreed_unit_price is
  'Per-paying-person agreement (adults + children; excludes infants and separate non-paying adults). NULL uses automatic pricing; zero is valid. Overrides booking income, and also supplier cost/invoice tariff for compatible direct FMDQ monthly-invoice bookings with matching standard income/cost rates. Not allowed for group pricing. Never modifies price lists.';

notify pgrst, 'reload schema';
commit;
