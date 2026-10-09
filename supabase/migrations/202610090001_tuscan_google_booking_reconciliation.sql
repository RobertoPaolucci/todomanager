-- PREPARED ONLY. Install only after approval, before deploying the caller.
-- No historical repair or replay. Service-role-only transactional writer.
begin;
set local lock_timeout = '5s';

create or replace function public.reconcile_tuscan_google_booking(
  expected_booking jsonb, expected_staging jsonb, expected_canonical jsonb, proposed jsonb
) returns boolean
language plpgsql security invoker set search_path = public, pg_temp
set lock_timeout = '5s'
as $function$
declare
  b public.bookings;
  s public.google_calendar_import_staging;
  e public.google_calendar_events;
  p public.bookings;
  clients integer;
  rate numeric;
  changed integer;
  allowed text[] := array['experience_id','experience_name','adults','children','infants',
    'non_paying_adults','total_people','pax','booking_date','booking_time','notes',
    'your_unit_price','supplier_unit_cost','public_unit_price','total_to_you',
    'total_supplier_cost','total_customer','total_amount','margin_total'];
begin
  -- Prevent phantom references/links, invoice insertions and concurrent tariff
  -- changes as well as row edits. Short, bounded transaction; no external I/O.
  lock table public.bookings, public.google_calendar_import_staging,
    public.google_calendar_events, public.google_calendar_event_aliases,
    public.fmdq_monthly_invoices, public.experience_channel_prices,
    public.experiences in share row exclusive mode;

  select * into b from public.bookings where id = (expected_booking->>'id')::bigint;
  if not found then return false; end if;
  select * into s from public.google_calendar_import_staging where id = (expected_staging->>'id')::bigint;
  if not found then return false; end if;
  select * into e from public.google_calendar_events where id = (expected_canonical->>'id')::bigint;
  if not found then return false; end if;
  if to_jsonb(b) is distinct from to_jsonb(jsonb_populate_record(null::public.bookings, expected_booking))
    or to_jsonb(s) is distinct from to_jsonb(jsonb_populate_record(null::public.google_calendar_import_staging, expected_staging))
    or to_jsonb(e) is distinct from to_jsonb(jsonb_populate_record(null::public.google_calendar_events, expected_canonical)) then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(proposed) key where not (key = any(allowed)))
    or (select count(*) from jsonb_object_keys(proposed)) <> cardinality(allowed) then
    raise exception 'Unexpected Tuscan reconciliation fields';
  end if;
  if b.channel_id is distinct from 7 or b.business_unit_id is distinct from 1 or b.supplier_id is distinct from 3
    or b.was_modified is distinct from false or b.is_cancelled is distinct from false or b.cancelled_at is not null
    or b.agreed_unit_price is not null or b.total_to_you_source is not null or b.recovery_tag is not null
    or b.bokun_booking_reference is not null or b.customer_phone is not null or b.customer_email is not null
    or b.customer_name not in ('Tuscan','Tuscan Escape') or b.booking_source is distinct from 'Tuscan Escape'
    or b.customer_payment_status is distinct from 'pending' or b.supplier_payment_status is distinct from 'pending'
    or b.supplier_amount_paid is distinct from 0
    or s.channel_id is distinct from 7 or s.imported_booking_id is distinct from b.id
    or s.import_status = 'gcal_cancelled' or upper(s.booking_reference) is distinct from upper(b.booking_reference)
    or upper(b.booking_reference) is distinct from upper('GCAL-' || left(regexp_replace(s.gcal_uid, '[^a-zA-Z0-9_-]', '', 'g'),48))
    or e.identity_namespace is distinct from 'legacy_unscoped' or e.occurrence_id is not null
    or e.gcal_observation_verified is distinct from true or e.gcal_event_status is distinct from 'confirmed'
    or e.attendance_parser_version ~* 'manual[-_]review'
    or e.original_title is distinct from s.original_title or e.event_date is distinct from s.booking_date
    or e.event_time is distinct from s.booking_time or e.gcal_updated_at is distinct from s.gcal_updated_at
    or e.event_classification is distinct from 'customer_event' or e.attendance_quality is distinct from 'parsed'
    or s.original_title !~* '^\d+\s+pranzo\s+tuscan\s+escape\s*$' then
    return false;
  end if;
  if not exists (select 1 from public.google_calendar_event_aliases a where a.event_id = e.id
    and a.original_uid = s.gcal_uid and a.canonical_uid = e.canonical_uid
    and a.identity_namespace = e.identity_namespace and a.occurrence_id is null and a.verified)
    and e.original_uid is distinct from s.gcal_uid and e.gcal_event_id is distinct from s.gcal_uid then return false; end if;
  if (select count(*) from public.bookings where upper(booking_reference) = upper(b.booking_reference)) <> 1
    or exists (select 1 from public.google_calendar_import_staging other where other.id <> s.id
      and (upper(other.booking_reference) = upper(s.booking_reference) or other.imported_booking_id = b.id
        or other.gcal_uid in (select original_uid from public.google_calendar_event_aliases where event_id = e.id)))
    or exists (select 1 from public.fmdq_monthly_invoices where channel_id = 7
      and invoice_month in (date_trunc('month', b.booking_date)::date, date_trunc('month', s.booking_date)::date)) then
    return false;
  end if;
  clients := substring(s.original_title from '^\s*(\d+)')::integer - 1;
  rate := case when clients = 8 then 36 else 38 end;
  if clients < 1 or e.observed_total_guests is distinct from clients + 1
    or e.effective_total_guests is distinct from clients then return false; end if;
  if (select count(*) from public.experience_channel_prices where experience_id = 7 and channel_id = 7) <> 1
    or not exists (select 1 from public.experience_channel_prices where experience_id = 7 and channel_id = 7
      and your_unit_price = 38 and supplier_adult_unit_cost = 38 and public_unit_price = 0)
    or not exists (select 1 from public.experiences where id = 7 and supplier_id = 3
      and supplier_unit_cost = 38 and is_group_pricing = false) then return false; end if;
  p := jsonb_populate_record(b, proposed);
  if p.experience_id is distinct from 7 or p.experience_name is distinct from (select name from public.experiences where id = 7)
    or p.adults is distinct from clients or p.children is distinct from 0 or p.infants is distinct from 0
    or p.non_paying_adults is distinct from 1 or p.total_people is distinct from clients + 1 or p.pax is distinct from clients
    or p.booking_date is distinct from s.booking_date or p.booking_time is distinct from to_char(s.booking_time,'HH24:MI')
    or p.notes is distinct from s.original_title or p.your_unit_price is distinct from rate or p.supplier_unit_cost is distinct from rate
    or p.total_to_you is distinct from clients * rate or p.total_supplier_cost is distinct from clients * rate
    or p.public_unit_price is distinct from 0 or p.total_customer is distinct from 0
    or p.total_amount is distinct from 0 or p.margin_total is distinct from 0 then return false; end if;
  if exists (select 1 from pg_trigger where tgrelid in ('public.bookings'::regclass,'public.google_calendar_import_staging'::regclass)
      and not tgisinternal and tgenabled <> 'D' and (tgtype::integer & 16) <> 0)
    or exists (select 1 from pg_rewrite where ev_class in ('public.bookings'::regclass,'public.google_calendar_import_staging'::regclass)
      and ev_type = '2' and ev_enabled <> 'D') then raise exception 'Review UPDATE hooks before reconciliation'; end if;

  if to_jsonb(b) is distinct from to_jsonb(p) then
    update public.bookings set experience_id=p.experience_id, experience_name=p.experience_name,
      adults=p.adults, children=p.children, infants=p.infants, non_paying_adults=p.non_paying_adults,
      total_people=p.total_people, pax=p.pax, booking_date=p.booking_date, booking_time=p.booking_time, notes=p.notes,
      your_unit_price=p.your_unit_price, supplier_unit_cost=p.supplier_unit_cost, public_unit_price=p.public_unit_price,
      total_to_you=p.total_to_you, total_supplier_cost=p.total_supplier_cost, total_customer=p.total_customer,
      total_amount=p.total_amount, margin_total=p.margin_total where id=b.id;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Expected one booking'; end if;
  end if;
  update public.google_calendar_import_staging set import_status='imported' where id=s.id and import_status <> 'imported';
  if (select to_jsonb(row) from public.bookings row where id=b.id) is distinct from to_jsonb(p) then
    raise exception 'Tuscan reconciliation postcondition failed';
  end if;
  return true;
end;
$function$;
revoke all on function public.reconcile_tuscan_google_booking(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_tuscan_google_booking(jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
