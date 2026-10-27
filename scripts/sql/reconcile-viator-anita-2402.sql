-- PREPARED ONLY: run only after explicit production authorization.
-- Default is a rehearsal: ROLLBACK. Review output before authorizing COMMIT.
-- Requires 20261027174815_viator_google_reconciliation.sql installed separately.
begin;
set local lock_timeout='5s';
lock table public.bookings, public.google_calendar_import_staging, public.google_calendar_events,
  public.google_calendar_event_aliases, public.viator_email_imports, public.viator_product_mappings,
  public.experiences, public.fmdq_monthly_invoices in share row exclusive mode;
do $$
declare i jsonb; b jsonb; s jsonb; e jsonb;
begin
  if not exists (select 1 from experiences where id=15 and business_unit_id=1 and active) then
    raise exception 'Expected active FMDQ experience 15'; end if;
  insert into viator_product_mappings(business_unit_id,viator_product_code,viator_tour_grade_code,experience_id,default_time,active)
    values(1,'200401P11','TG1',15,null,true)
    on conflict (business_unit_id,viator_product_code,viator_tour_grade_code) do nothing;
  if not exists (select 1 from viator_product_mappings where business_unit_id=1 and viator_product_code='200401P11'
    and viator_tour_grade_code='TG1' and experience_id=15 and active and default_time is null) then
    raise exception 'Mapping conflicts with reviewed product; do not overwrite'; end if;
  select to_jsonb(x) into strict i from viator_email_imports x where id=61;
  select to_jsonb(x) into strict b from bookings x where id=2402;
  select to_jsonb(x) into strict s from google_calendar_import_staging x where id=716;
  select to_jsonb(x) into strict e from google_calendar_events x where id=1363;
  if i->>'booking_reference' is distinct from 'BR-1460201663' or i->>'business_unit_id' is distinct from '1'
    or i->>'viator_product_code' is distinct from '200401P11' or i->>'viator_tour_grade_code' is distinct from 'TG1'
    or i#>>'{parsed_data,lead_traveller}' is distinct from 'Anita Dreise'
    or i#>>'{parsed_data,activity_date}' is distinct from '2026-10-28'
    or i#>>'{parsed_data,activity_time}' is not null
    or (i#>>'{parsed_data,net_amount}')::numeric is distinct from 50.70
    or i#>>'{parsed_data,currency}' is distinct from 'EUR'
    or i#>>'{parsed_data,net_amount_basis}' is distinct from 'booking_total'
    or b->>'booking_date' is distinct from '2026-10-28' or b->>'booking_time' is distinct from '09:30'
    or b->>'business_unit_id' is distinct from '1' or b->>'experience_id' is distinct from '15'
    or b->>'adults' is distinct from '1' or b->>'children' is distinct from '0' or b->>'infants' is distinct from '0'
    or (b->>'total_amount')::numeric is distinct from 65 or (b->>'total_to_you')::numeric is distinct from 60
    or (b->>'total_supplier_cost')::numeric is distinct from 60 or (b->>'margin_total')::numeric is distinct from 0
    or s->>'imported_booking_id' is distinct from '2402'
    or s->>'gcal_uid' is distinct from '_ccrm4cr474sm8cr2cks38c9i74sm8c1hc5i66ohhcgr62dpn6kqg'
    or s->>'original_title' is distinct from '1 e-bike noleggio 1460201663 Anita Dreise' then
    raise exception 'Anita reviewed facts changed'; end if;
  raise notice '%', public.reconcile_viator_google_booking(i,b,s,e);
end;
$$;
select id,customer_name,channel_id,booking_reference,booking_date,booking_time,total_to_you,total_amount,
  total_supplier_cost,margin_total from bookings where id=2402;
select id,booking_id,status,parsed_data->'google_reconciliation' as reconciliation from viator_email_imports where id=61;
-- ECONOMICS ARE STILL PENDING. No payment, public price, cost or margin is asserted here.
rollback;
