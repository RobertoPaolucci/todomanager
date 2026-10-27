-- PREPARED ONLY. No seed data, booking corrections or replay on installation.
begin;
set local lock_timeout = '5s';

create function public.viator_reference_key(value text) returns text
language sql immutable strict security invoker set search_path=public,pg_temp as $$
  select case when upper(btrim(value)) ~ '^(BR-)?[0-9]+$'
    then regexp_replace(upper(btrim(value)), '^BR-', '') end;
$$;
create function public.google_title_has_viator_reference(title text, reference text) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
  select coalesce(public.viator_reference_key(reference) is not null and
    title ~* ('(^|[^A-Z0-9])(?:BR-)?' || public.viator_reference_key(reference) || '([^A-Z0-9]|$)'), false);
$$;

-- Read-only preflight; false is not a substitute for the INSERT guard below.
create function public.google_has_viator_evidence(p_staging_id bigint) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
  select exists (select 1 from public.google_calendar_import_staging s
    join public.experiences e on e.id=s.experience_id and e.business_unit_id=1
    where s.id=p_staging_id and s.channel_id in (2,6) and (
      exists (select 1 from public.viator_email_imports i where i.business_unit_id=1
        and public.google_title_has_viator_reference(s.original_title,i.booking_reference))
      or exists (select 1 from public.bookings b where b.business_unit_id=1 and b.channel_id=2
        and b.bokun_booking_reference is null
        and public.google_title_has_viator_reference(s.original_title,b.booking_reference))));
$$;

-- Last line of defence, including callers that read before another transaction.
-- Only FMDQ Viator/Google INSERTs; no UPDATEs or BU2/Bokun business logic.
create function public.guard_viator_google_insert() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set lock_timeout='5s' as $$
declare ref text;
begin
  if new.business_unit_id is distinct from 1 or new.bokun_booking_reference is not null
    or coalesce(new.channel_id,0) not in (2,6) then return new; end if;
  ref := public.viator_reference_key(new.booking_reference);
  if ref is null and coalesce(new.booking_reference,'') not like 'GCAL-%' then return new; end if;
  perform pg_advisory_xact_lock(778305, 1);
  if ref is not null and exists (select 1 from public.google_calendar_import_staging s
    where public.viator_reference_key(s.booking_reference)=ref and public.google_has_viator_evidence(s.id)) then
    raise exception 'viator_google_reconciliation_required' using errcode='23514';
  end if;
  if ref is not null and new.channel_id=2 and exists (
    select 1 from public.google_calendar_import_staging s
    join public.experiences e on e.id=s.experience_id and e.business_unit_id=1
    where s.channel_id in (2,6) and public.google_title_has_viator_reference(s.original_title,ref)
  ) then raise exception 'viator_google_reconciliation_required' using errcode='23514'; end if;
  if ref is null and exists (select 1 from public.google_calendar_import_staging s
    where (s.booking_reference=new.booking_reference or new.booking_reference=
      'GCAL-' || left(regexp_replace(s.gcal_uid,'[^a-zA-Z0-9_-]','','g'),48))
      and public.google_has_viator_evidence(s.id)) then
    raise exception 'viator_google_reconciliation_required' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guard_viator_google_insert before insert on public.bookings
for each row execute function public.guard_viator_google_insert();

-- Reviewed reconciliation: snapshots are mandatory, money is deliberately NOT
-- rewritten. The archived net and economics_pending flag accompany the link.
-- This function never creates a booking and never writes a canonical event.
create function public.reconcile_viator_google_booking(
  expected_import jsonb, expected_booking jsonb, expected_staging jsonb, expected_canonical jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp set lock_timeout='5s' as $$
declare
  i public.viator_email_imports;
  b public.bookings;
  s public.google_calendar_import_staging;
  e public.google_calendar_events;
  m public.viator_product_mappings;
  p jsonb;
  audit jsonb;
  result jsonb;
begin
  lock table public.bookings, public.google_calendar_import_staging, public.google_calendar_events,
    public.google_calendar_event_aliases, public.viator_email_imports, public.viator_product_mappings,
    public.experiences, public.fmdq_monthly_invoices in share row exclusive mode;
  select * into strict i from public.viator_email_imports where id=(expected_import->>'id')::bigint;
  select * into strict b from public.bookings where id=(expected_booking->>'id')::bigint;
  select * into strict s from public.google_calendar_import_staging where id=(expected_staging->>'id')::bigint;
  select * into strict e from public.google_calendar_events where id=(expected_canonical->>'id')::bigint;
  audit := i.parsed_data->'google_reconciliation';
  if audit is not null and i.booking_id=b.id and s.imported_booking_id=b.id
    and audit->'booking_after'=to_jsonb(b) and audit->'staging_after'=to_jsonb(s)
    and audit->'canonical_before'=to_jsonb(e) then
    return jsonb_build_object('action','already_reconciled','booking_id',b.id,'economics_pending',true);
  end if;
  if to_jsonb(i) is distinct from expected_import or to_jsonb(b) is distinct from expected_booking
    or to_jsonb(s) is distinct from expected_staging or to_jsonb(e) is distinct from expected_canonical then
    raise exception 'reconciliation_snapshot_changed';
  end if;
  p := i.parsed_data;
  if i.business_unit_id<>1 or b.business_unit_id<>1 or i.booking_id is not null
    or i.event_type<>'confirmed' or i.status not in ('needs_mapping','needs_review','duplicate_candidate','ready')
    or p->>'event_type' is distinct from 'confirmed' or p->'warnings' is distinct from '[]'::jsonb
    or p->>'booking_reference' is distinct from i.booking_reference
    or p->>'product_code' is distinct from i.viator_product_code
    or p->>'tour_grade' is distinct from i.viator_tour_grade_code
    or public.viator_reference_key(i.booking_reference) is null
    or nullif(btrim(p->>'lead_traveller'),'') is null
    or (i.raw_payload->>'business_unit_id' is not null and i.raw_payload->>'business_unit_id'<>'1')
    or (i.raw_payload->>'channel_id' is not null and i.raw_payload->>'channel_id'<>'2')
    or coalesce(i.subject,'') ~* 'nuova\s+richiesta\s+di\s+prenotazione'
    or coalesce(b.channel_id,0) not in (2,6) or coalesce(s.channel_id,0) not in (2,6)
    or b.bokun_booking_reference is not null or b.agreed_unit_price is not null
    or b.total_to_you_source is not null or b.recovery_tag is not null
    or b.was_modified is distinct from false or b.is_cancelled is distinct from false or b.cancelled_at is not null
    or b.customer_payment_status is distinct from 'pending' or b.supplier_payment_status is distinct from 'pending'
    or lower(btrim(b.customer_name)) not in ('da verificare',lower(btrim(p->>'lead_traveller')))
    or coalesce(b.supplier_amount_paid,0)<>0 or s.imported_booking_id is distinct from b.id
    or s.import_status not in ('imported','already_exists','needs_review')
    or b.booking_reference is distinct from s.booking_reference
    or b.booking_reference is distinct from ('GCAL-' || left(regexp_replace(s.gcal_uid,'[^a-zA-Z0-9_-]','','g'),48))
    or not public.google_title_has_viator_reference(s.original_title,i.booking_reference) then
    raise exception 'unsafe_viator_google_identity';
  end if;
  select * into strict m from public.viator_product_mappings where business_unit_id=1 and active
    and viator_product_code=i.viator_product_code and viator_tour_grade_code=i.viator_tour_grade_code;
  if m.experience_id is distinct from b.experience_id or m.experience_id is distinct from s.experience_id
    or not exists (select 1 from public.experiences x where x.id=m.experience_id and x.business_unit_id=1
      and x.active and x.supplier_id is not distinct from b.supplier_id)
    or b.booking_date is distinct from (p->>'activity_date')::date or s.booking_date is distinct from b.booking_date
    or s.booking_time is null or b.booking_time is null
    or left(b.booking_time,5) is distinct from to_char(s.booking_time,'HH24:MI')
    or (p->>'activity_time' is not null and p->>'activity_time' is distinct from left(b.booking_time,5))
    or b.adults is distinct from coalesce((p->>'adults')::int,0)
    or b.children is distinct from coalesce((p->>'children')::int,0)
    or coalesce(b.infants,0) is distinct from coalesce((p->>'infants')::int,0)
    or b.adults is distinct from s.adults or b.children is distinct from s.children
    or coalesce(b.infants,0) is distinct from coalesce(s.infants,0)
    or b.non_paying_adults<>0 or b.total_people is distinct from (p->>'total_travellers')::int
    or b.total_people<>b.adults+b.children+coalesce(b.infants,0)
    or b.total_people<=0 then raise exception 'viator_google_details_mismatch'; end if;
  if e.gcal_observation_verified is distinct from true or e.gcal_event_status is distinct from 'confirmed'
    or e.event_date is distinct from b.booking_date or e.event_time is distinct from s.booking_time
    or e.original_title is distinct from s.original_title or e.gcal_updated_at is distinct from s.gcal_updated_at
    or e.cancellation_reconciliation_history is distinct from '[]'::jsonb
    or e.occurrence_id is not null or e.identity_namespace is distinct from 'legacy_unscoped'
    or (e.original_uid is distinct from s.gcal_uid and e.gcal_event_id is distinct from s.gcal_uid
      and not exists (select 1 from public.google_calendar_event_aliases a where a.event_id=e.id
        and a.original_uid=s.gcal_uid and a.verified and a.identity_namespace=e.identity_namespace
        and a.canonical_uid=e.canonical_uid and a.occurrence_id is null)) then
    raise exception 'unverified_google_event';
  end if;
  if exists (select 1 from public.bookings other where other.business_unit_id=1 and other.id<>b.id
      and (public.viator_reference_key(other.booking_reference)=public.viator_reference_key(i.booking_reference)
        or other.booking_reference=b.booking_reference))
    or exists (select 1 from public.google_calendar_import_staging other where other.id<>s.id
      and (other.imported_booking_id=b.id or other.gcal_uid=s.gcal_uid
        or other.gcal_uid in (select original_uid from public.google_calendar_event_aliases where event_id=e.id) or
        (other.channel_id in (2,6) and public.google_title_has_viator_reference(other.original_title,i.booking_reference))))
    or exists (select 1 from public.viator_email_imports other where other.id<>i.id and other.business_unit_id=1
      and other.booking_reference<>i.booking_reference
      and public.google_title_has_viator_reference(s.original_title,other.booking_reference))
    or exists (select 1 from public.viator_email_imports other where other.id<>i.id and other.business_unit_id=1
      and other.booking_reference=i.booking_reference and
        (other.booking_id is not null or other.event_type in ('modified','cancelled')
          or (other.event_type='confirmed' and (other.parsed_data->>'activity_date' is distinct from p->>'activity_date'
            or other.parsed_data->'activity_time' is distinct from p->'activity_time'
            or other.parsed_data->'currency' is distinct from p->'currency'
            or other.parsed_data->>'lead_traveller' is distinct from p->>'lead_traveller'
            or other.viator_product_code is distinct from i.viator_product_code
            or other.viator_tour_grade_code is distinct from i.viator_tour_grade_code
            or other.parsed_data->'adults' is distinct from p->'adults'
            or other.parsed_data->'children' is distinct from p->'children'
            or other.parsed_data->'infants' is distinct from p->'infants'
            or other.parsed_data->'net_amount' is distinct from p->'net_amount'))))
    or exists (select 1 from public.fmdq_monthly_invoices where channel_id in (b.channel_id,2)
      and invoice_month=date_trunc('month',b.booking_date)::date) then
    raise exception 'ambiguous_or_invoiced_viator_google_booking';
  end if;
  if exists (select 1 from pg_trigger where tgrelid in ('public.bookings'::regclass,
      'public.google_calendar_import_staging'::regclass,'public.viator_email_imports'::regclass)
      and not tgisinternal and tgenabled<>'D' and (tgtype::int & 16)<>0
      and pg_get_triggerdef(oid) not in (
        'CREATE TRIGGER guard_reconciled_google_staging BEFORE UPDATE ON public.google_calendar_import_staging FOR EACH ROW EXECUTE FUNCTION guard_reconciled_google_staging()',
        'CREATE TRIGGER track_booking_cancellation_alert_revision AFTER INSERT OR UPDATE OF is_cancelled, booking_date, booking_time, total_people, customer_name, experience_id, experience_name, channel_id, booking_source ON public.bookings FOR EACH ROW WHEN ((new.is_cancelled IS TRUE)) EXECUTE FUNCTION track_booking_cancellation_alert_revision()'))
    or exists (select 1 from pg_rewrite where ev_class in ('public.bookings'::regclass,
      'public.google_calendar_import_staging'::regclass,'public.viator_email_imports'::regclass)
      and ev_type='2' and ev_enabled<>'D') then
    raise exception 'review_update_hooks_before_reconciliation';
  end if;
  update public.bookings set customer_name=p->>'lead_traveller', channel_id=2, booking_source='Viator',
    booking_reference=i.booking_reference,
    notes=coalesce(b.notes,'') || E'\nViator email FMDQ | import_id=' || i.id ||
      ' | original_reference=' || b.booking_reference || ' | economics_pending_review' where id=b.id;
  update public.google_calendar_import_staging set customer_name=p->>'lead_traveller', channel_id=2,
    booking_source='Viator', booking_reference=i.booking_reference, import_status='imported' where id=s.id;
  audit := jsonb_build_object('version',1,'import_before',to_jsonb(i),'booking_before',to_jsonb(b),
    'staging_before',to_jsonb(s),'canonical_before',to_jsonb(e),'economics_pending',true,
    'booking_after',(select to_jsonb(x) from public.bookings x where id=b.id),
    'staging_after',(select to_jsonb(x) from public.google_calendar_import_staging x where id=s.id));
  update public.viator_email_imports set booking_id=b.id, status='needs_review',
    parsed_data=p || jsonb_build_object('google_reconciliation',audit,
      'processing_mode','reconcile_google_booking','booking_writes_blocked_reason','economics_pending_review',
      'classification',coalesce(p->'classification','{}'::jsonb) || jsonb_build_object(
        'status','needs_review','reason','google_reconciled_economics_pending','action','reconcile_google_booking',
        'would_do','none','booking_id',b.id,'booking_writes_enabled',true)),
    error_message=null, processed_at=now() where id=i.id;
  result := jsonb_build_object('action','reconciled','booking_id',b.id,'economics_pending',true);
  return result;
end;
$$;

revoke all on function public.viator_reference_key(text), public.google_title_has_viator_reference(text,text),
 public.google_has_viator_evidence(bigint), public.guard_viator_google_insert(),
 public.reconcile_viator_google_booking(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.viator_reference_key(text), public.google_title_has_viator_reference(text,text),
 public.google_has_viator_evidence(bigint), public.guard_viator_google_insert(),
 public.reconcile_viator_google_booking(jsonb,jsonb,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
