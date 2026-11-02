-- PREVIEW ONLY. Requires the prepared item-identity migration.
-- Never run until the native Bókun/Make evidence establishes that TOD-T151827070
-- belongs to TOD-108037806 and confirms the 2/0/1 categories.
-- Keep the final ROLLBACK for preview. Export snapshots before an authorized COMMIT.
begin;
set local lock_timeout = '5s';
-- Operator must replace the empty value with a reference to reviewed evidence.
select set_config('todomanager.repair_evidence', '', true);

do $$
declare b public.bookings; d public.bookings; s public.google_calendar_import_staging;
  e public.google_calendar_events; after_booking jsonb; evidence text;
begin
  evidence := current_setting('todomanager.repair_evidence',true);
  if coalesce(evidence,'')='' then raise exception 'Reviewed Bókun/Make evidence required'; end if;
  lock table public.bookings, public.google_calendar_import_staging, public.google_calendar_events,
    public.google_calendar_event_aliases, public.viator_email_imports, public.fmdq_monthly_invoices
    in share row exclusive mode;
  select * into strict b from public.bookings where id=2415;
  select * into strict d from public.bookings where id=2419;
  select * into strict s from public.google_calendar_import_staging where id=724;
  select * into strict e from public.google_calendar_events where id=1373;
  if b.business_unit_id is distinct from 1 or d.business_unit_id is distinct from 1
    or b.channel_id is distinct from 6 or d.channel_id is distinct from 6
    or b.experience_id is distinct from 7 or d.experience_id is distinct from 7
    or b.bokun_booking_reference is distinct from 'TOD-108037806'
    or b.bokun_item_reference is not null or d.bokun_booking_reference is not null
    or b.superseded_by_booking_id is not null or d.superseded_by_booking_id is not null
    or b.is_cancelled is distinct from false or d.is_cancelled is distinct from false
    or b.booking_date is distinct from date '2026-11-23' or b.booking_time is distinct from time '12:00'
    or d.booking_date is distinct from date '2026-11-24'
    or b.adults is distinct from 3 or b.children is distinct from 0 or b.infants is distinct from 0
    or b.total_people is distinct from 3 or b.total_to_you is distinct from 114
    or b.total_customer is distinct from 135 or b.total_supplier_cost is distinct from 114
    or b.agreed_unit_price is not null or b.price_tier_snapshot is not null
    or d.adults is distinct from 2 or d.infants is distinct from 1
    or d.total_to_you is distinct from 76 or d.total_customer is distinct from 90
    or b.customer_payment_status is distinct from 'pending' or b.supplier_payment_status is distinct from 'pending'
    or d.customer_payment_status is distinct from 'pending' or d.supplier_payment_status is distinct from 'pending'
    or coalesce(b.supplier_amount_paid,0)<>0 or coalesce(d.supplier_amount_paid,0)<>0
    or s.imported_booking_id is distinct from d.id or s.import_status is distinct from 'imported'
    or s.gcal_uid is distinct from e.original_uid
    or s.original_title is distinct from '2+1 neonato pranzo T151827070 Beustring'
    or e.original_title is distinct from s.original_title
    or e.event_date is distinct from date '2026-11-24' or e.gcal_event_status is distinct from 'confirmed'
    or e.historical_booking_id is not null or e.staging_id is not null
    or e.cancellation_reconciliation_history is distinct from '[]'::jsonb then
    raise exception 'Case changed: reread and review; no repair applied';
  end if;
  if exists(select 1 from public.google_calendar_import_staging where imported_booking_id in (b.id,d.id) and id<>s.id)
    or exists(select 1 from public.google_calendar_events where historical_booking_id in (b.id,d.id))
    or exists(select 1 from public.google_calendar_event_aliases where historical_booking_id in (b.id,d.id))
    or exists(select 1 from public.viator_email_imports where booking_id in (b.id,d.id))
    or exists(select 1 from public.fmdq_monthly_invoices where channel_id=6 and invoice_month=date '2026-11-01' and is_invoiced)
    or exists(select 1 from public.bookings where business_unit_id=1 and bokun_item_reference='TOD-T151827070') then
    raise exception 'Additional links, invoice or item owner require explicit review';
  end if;

  update public.bookings set adults=2, children=0, infants=1, total_people=3, pax=2,
    total_to_you=76, total_customer=90, total_amount=90, total_supplier_cost=76, margin_total=0,
    bokun_item_reference='TOD-T151827070' where id=b.id;
  select to_jsonb(row) into after_booking from public.bookings row where id=b.id;
  update public.bookings set is_cancelled=true, cancelled_at=clock_timestamp(),
    superseded_by_booking_id=b.id,
    notes='Duplicato riconciliato con prenotazione Bókun; consultare duplicate_reconciliation_audit.',
    duplicate_reconciliation_audit=jsonb_build_object('reason','verified_bokun_google_duplicate',
      'evidence',evidence,'actor',current_user,'at',clock_timestamp(),
      'survivor_before',to_jsonb(b),'survivor_after',after_booking,'duplicate_before',to_jsonb(d),
      'staging_before',to_jsonb(s),'canonical_before',to_jsonb(e)) where id=d.id;
  -- Google's incorrect date remains an observation to review. No rescheduling.
  update public.google_calendar_import_staging set imported_booking_id=b.id, import_status='needs_review' where id=s.id;
  if (select to_jsonb(row) from public.google_calendar_events row where id=e.id) is distinct from to_jsonb(e) then
    raise exception 'Unexpected canonical mutation';
  end if;
end;
$$;

select id, business_unit_id, booking_date, adults, children, infants, total_people,
  total_to_you, total_customer, is_cancelled, bokun_booking_reference,
  bokun_item_reference, superseded_by_booking_id from public.bookings where id in (2415,2419) order by id;
select id, imported_booking_id, import_status, booking_date from public.google_calendar_import_staging where id=724;
rollback;
