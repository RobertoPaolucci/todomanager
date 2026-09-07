-- NON eseguito. Intervento storico separato dalla migration.
-- Dopo verifica documentale e autorizzazione: associa SOLO la vecchia riga 1999
-- al booking GET-101955189 e corregge SOLO il suo canale. Non la riattiva,
-- non cambia orario, importi, pagamenti o reference GYG. Default: ROLLBACK.
begin;
do $$
declare affected integer;
begin
  update public.bookings
  set bokun_booking_reference = 'GET-101955189',
      channel_id = 3, booking_source = 'GetYourGuide'
  where id = 1999
    and booking_reference = 'GYGBLHFXQZ7B'
    and booking_date = date '2026-10-24'
    and booking_time in ('10:00', '10:00:00')
    and is_cancelled = true
    and experience_id = 1
    and channel_id = 1 and booking_source = 'Direct'
    and bokun_booking_reference is null;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Attesa esattamente la riga storica verificata, trovate %: nessuna modifica applicata', affected;
  end if;
end $$;
select id, booking_reference, bokun_booking_reference, booking_date,
       booking_time, is_cancelled, channel_id, booking_source
from public.bookings where id = 1999;
rollback;
-- Sostituire ROLLBACK con COMMIT esclusivamente dopo autorizzazione.
-- Poi ripetere la conferma originale GET-103074524 con i dati completi.
