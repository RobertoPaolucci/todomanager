-- Preparata, NON applicata. Prima eseguire diagnostics/bokun-preflight.sql.
-- Non aggiorna né associa automaticamente alcuna prenotazione storica.
begin;
set local lock_timeout = '5s';
lock table public.bookings in access exclusive mode;

alter table public.bookings add column bokun_booking_reference text;
alter table public.bookings add constraint bookings_bokun_reference_format
  check (bokun_booking_reference is null or
    (bokun_booking_reference = upper(btrim(bokun_booking_reference))
     and bokun_booking_reference ~ '^[A-Z0-9]+-[A-Z0-9]+$'));

-- Convert ONLY ordinary, single-column UNIQUE booking_reference indexes.
-- Keep their exact key definition and name; restrict them to legacy rows.
-- Unknown composite/expression/partial constraints stop the transaction for
-- review. Never CASCADE away foreign keys or other dependent objects.
do $$
declare
  ref_att smallint;
  idx record;
begin
  select attnum into strict ref_att from pg_attribute
  where attrelid = 'public.bookings'::regclass and attname = 'booking_reference';

  for idx in
    select i.*, ci.relname as index_name, c.conname, c.contype,
           pg_get_indexdef(i.indexrelid) as definition
    from pg_index i
    join pg_class ci on ci.oid = i.indexrelid
    left join pg_constraint c on c.conindid = i.indexrelid
      and c.conrelid = i.indrelid
    where i.indrelid = 'public.bookings'::regclass and i.indisunique
      and (ref_att = any(i.indkey)
           or pg_get_expr(i.indexprs, i.indrelid) like '%booking_reference%')
  loop
    if idx.indisprimary or idx.indnkeyatts <> 1 or idx.indexprs is not null
       or idx.indpred is not null or idx.indkey[0] <> ref_att
       or (idx.contype is not null and idx.contype <> 'u') then
      raise exception 'Indice % non standard: verificare il preflight, nessuna modifica applicata', idx.index_name;
    end if;
    if idx.conname is not null then
      execute format('alter table public.bookings drop constraint %I', idx.conname);
    else
      execute format('drop index public.%I', idx.index_name);
    end if;
    execute idx.definition || ' WHERE bokun_booking_reference IS NULL';
  end loop;
end $$;

create unique index bookings_bokun_booking_reference_key
  on public.bookings (bokun_booking_reference)
  where bokun_booking_reference is not null;
create index bookings_external_reference_lookup on public.bookings (booking_reference);

comment on column public.bookings.bokun_booking_reference is
  'Identità booking/cart Bókun, es. GET-103074524. Non è il codice prodotto né il riferimento esterno GYG. NULL per righe legacy/non riconciliate.';
notify pgrst, 'reload schema';
commit;
