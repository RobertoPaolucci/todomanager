-- Preparata, NON applicata. Nessun backfill storico.
begin;
set local lock_timeout = '5s';

alter table public.bookings add column bokun_booking_reference text;
alter table public.bookings add constraint bookings_bokun_reference_format
  check (bokun_booking_reference is null or
    (bokun_booking_reference = upper(btrim(bokun_booking_reference))
     and bokun_booking_reference ~ '^[A-Z0-9]+-[A-Z0-9]+$'));
alter table public.bookings add constraint bookings_bokun_business_unit_required
  check (bokun_booking_reference is null or business_unit_id is not null);

create unique index bookings_business_unit_bokun_reference_key
  on public.bookings (business_unit_id, bokun_booking_reference)
  where bokun_booking_reference is not null;

comment on column public.bookings.bokun_booking_reference is
  'Booking/cart Bokun, univoco nella business unit. Non il riferimento OTA o prodotto. NULL per righe legacy.';
notify pgrst, 'reload schema';
commit;
