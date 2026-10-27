-- PREPARED ONLY. Compensating rollback refuses subsequent operational edits.
-- The default ROLLBACK makes this a rehearsal. Preserve exported audit first.
begin;
set local lock_timeout='5s';
lock table public.bookings, public.google_calendar_import_staging, public.google_calendar_events,
  public.viator_email_imports, public.fmdq_monthly_invoices in share row exclusive mode;
do $$
declare i public.viator_email_imports; a jsonb; b public.bookings; s public.google_calendar_import_staging;
begin
  select * into strict i from viator_email_imports where id=61;
  a:=i.parsed_data->'google_reconciliation';
  if a is null then raise exception 'Missing reconciliation audit'; end if;
  if i.booking_id is distinct from 2402 or a#>>'{booking_before,id}' is distinct from '2402'
    or a#>>'{staging_before,id}' is distinct from '716'
    or (select to_jsonb(x) from bookings x where id=2402) is distinct from a->'booking_after'
    or (select to_jsonb(x) from google_calendar_import_staging x where id=716) is distinct from a->'staging_after'
    or (select to_jsonb(x) from google_calendar_events x where id=1363) is distinct from a->'canonical_before'
    or i.status is distinct from 'needs_review'
    or i.parsed_data#>>'{classification,action}' is distinct from 'reconcile_google_booking'
    or (to_jsonb(i)-'parsed_data'-'booking_id'-'status'-'processed_at'-'error_message')
      is distinct from ((a->'import_before')-'parsed_data'-'booking_id'-'status'-'processed_at'-'error_message')
    or i.parsed_data->>'processing_mode' is distinct from 'reconcile_google_booking'
    or i.parsed_data->>'booking_writes_blocked_reason' is distinct from 'economics_pending_review'
    or (i.parsed_data-'google_reconciliation'-'classification'-'processing_mode'-'booking_writes_blocked_reason')
      is distinct from ((a#>'{import_before,parsed_data}')-'classification'-'processing_mode'-'booking_writes_blocked_reason')
    or exists (select 1 from viator_email_imports where id<>61 and booking_id=2402)
    or exists (select 1 from fmdq_monthly_invoices where channel_id in (2,6) and invoice_month='2026-10-01') then
    raise exception 'Rollback snapshot changed; review manually'; end if;
  b:=jsonb_populate_record(null::public.bookings,a->'booking_before');
  s:=jsonb_populate_record(null::public.google_calendar_import_staging,a->'staging_before');
  update bookings set customer_name=b.customer_name,channel_id=b.channel_id,booking_source=b.booking_source,
    booking_reference=b.booking_reference,notes=b.notes where id=2402;
  update google_calendar_import_staging set customer_name=s.customer_name,channel_id=s.channel_id,
    booking_source=s.booking_source,booking_reference=s.booking_reference,import_status=s.import_status where id=716;
  -- Keep a durable history of the reverted decision in the original archive.
  update viator_email_imports set booking_id=null,status=a#>>'{import_before,status}',
    processed_at=(a#>>'{import_before,processed_at}')::timestamptz,
    error_message=a#>>'{import_before,error_message}',
    parsed_data=(a#>'{import_before,parsed_data}') || jsonb_build_object('google_reconciliation_rollback',a)
    where id=61;
  if (select to_jsonb(x) from bookings x where id=2402) is distinct from a->'booking_before'
    or (select to_jsonb(x) from google_calendar_import_staging x where id=716) is distinct from a->'staging_before' then
    raise exception 'Rollback postcondition failed'; end if;
end;
$$;
-- Mapping is intentionally retained: it is valid independently of this booking.
rollback;
