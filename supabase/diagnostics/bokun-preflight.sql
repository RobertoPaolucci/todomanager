-- SOLA LETTURA. Eseguire prima della migration e conservare il risultato.
select c.conname, c.contype, c.conrelid::regclass as tabella,
       pg_get_constraintdef(c.oid) as definizione
from pg_constraint c
where c.conrelid = 'public.bookings'::regclass
   or c.confrelid = 'public.bookings'::regclass;

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'bookings';

select t.tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid)
from pg_trigger t
where t.tgrelid = 'public.bookings'::regclass and not t.tgisinternal;

select id, booking_reference, booking_date, booking_time, is_cancelled,
       channel_id, booking_source, experience_id, created_at, updated_at
from public.bookings
where booking_reference in ('GYGBLHFXQZ7B', 'GET-101955189', 'GET-103074524',
                            'TOD-T143778845', 'TOD-T145243238');
