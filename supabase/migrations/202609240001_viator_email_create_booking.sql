-- PREPARED ONLY. Apply separately before enabling VIATOR_EMAIL_PROCESS_BOOKINGS.
-- No historical DML, new booking columns, enums, mappings or Bókun changes.
begin;
set local lock_timeout = '5s';

create function public.create_viator_email_booking(
  p_import_id bigint, p_attempts integer, p_started_at timestamptz
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
declare
  imp public.viator_email_imports%rowtype;
  mapping public.viator_product_mappings%rowtype;
  exp public.experiences%rowtype;
  price public.experience_channel_prices%rowtype;
  parsed jsonb;
  classification jsonb;
  result_status text := 'needs_review';
  reason text;
  new_id bigint;
  candidate_ids bigint[];
  exact_count integer;
  historical_count integer;
  adult_count integer;
  child_count integer;
  infant_count integer;
  people integer;
  net numeric;
  adult_price numeric;
  child_price numeric;
  adult_cost numeric;
  child_cost numeric;
  public_total numeric;
  supplier_total numeric;
  activity_time text;
  diagnostics_code text;
begin
  select * into imp from public.viator_email_imports where id = p_import_id for update;
  if not found then raise exception 'import_not_found'; end if;
  -- A committed result is idempotent, including an RPC response lost in transit.
  if imp.booking_id is not null and imp.parsed_data #>> '{classification,action}' = 'create_booking' then
    return jsonb_build_object('status', imp.status, 'action', 'create_booking', 'booking_id', imp.booking_id);
  end if;
  if imp.status <> 'processing' or imp.attempts is distinct from p_attempts or
      imp.processing_started_at is distinct from p_started_at then
    raise exception 'import_lease_lost';
  end if;
  parsed := imp.parsed_data;
  classification := parsed->'classification';

  -- This block is a subtransaction: INSERT and linking either both succeed or
  -- both roll back. No compensating DELETE/UPDATE ever touches a booking.
  begin
    if imp.business_unit_id <> 1 or
        (imp.raw_payload->>'business_unit_id' is not null and imp.raw_payload->>'business_unit_id' <> '1') or
        (imp.raw_payload->>'channel_id' is not null and imp.raw_payload->>'channel_id' <> '2') or
        classification->>'business_unit_id' is distinct from '1' or
        classification->>'channel_id' is distinct from '2' then
      reason := 'scope_mismatch';
    elsif coalesce(imp.subject, '') ~* 'nuova\s+richiesta\s+di\s+prenotazione' then
      reason := 'booking_request_pending';
    elsif parsed->>'processing_requested' is distinct from 'true' or
        imp.event_type <> 'confirmed' or parsed->>'event_type' is distinct from 'confirmed' or
        classification->>'status' is distinct from 'ready' or
        classification->>'reason' is distinct from 'confirmation_ready_dry_run' or
        classification->>'would_do' is distinct from 'create_booking' or
        parsed->'warnings' is distinct from '[]'::jsonb or
        imp.booking_reference is null or imp.booking_reference !~ '^BR-[0-9]+$' or
        parsed->>'booking_reference' is distinct from imp.booking_reference then
      reason := 'unsafe_confirmation';
    else
      -- Re-read and lock the exact active mapping, experience and prices; a
      -- stale classification is never enough to authorize the INSERT.
      select * into mapping from public.viator_product_mappings
        where business_unit_id = 1 and active
          and viator_product_code = imp.viator_product_code
          and viator_tour_grade_code = imp.viator_tour_grade_code for share;
      if not found then
        result_status := 'needs_mapping'; reason := 'exact_product_mapping_missing';
      elsif mapping.id::text is distinct from classification->>'mapping_id' or
          mapping.experience_id::text is distinct from classification #>> '{proposed_booking,experience_id}' then
        reason := 'mapping_changed';
      else
        select * into exp from public.experiences where id = mapping.experience_id and business_unit_id = 1 for share;
        if not found or not exp.active or nullif(btrim(exp.name), '') is null then
          reason := 'mapping_business_unit_mismatch';
        end if;
      end if;
      if reason is null then
        activity_time := coalesce(parsed->>'activity_time', to_char(mapping.default_time, 'HH24:MI'));
        adult_count := coalesce((parsed->>'adults')::integer, 0);
        child_count := coalesce((parsed->>'children')::integer, 0);
        infant_count := coalesce((parsed->>'infants')::integer, 0);
        people := (parsed->>'total_travellers')::integer;
        net := (parsed->>'net_amount')::numeric;
        if net is null or net < 0 or net <> round(net, 2) or net::text in ('NaN', 'Infinity', '-Infinity') or
            parsed->>'currency' is distinct from 'EUR' or parsed->>'net_amount_basis' is distinct from 'booking_total' then
          reason := 'missing_or_unsafe_net_amount';
        elsif people is null or people <= 0 or adult_count < 0 or child_count < 0 or infant_count < 0 or
            people <> adult_count + child_count + infant_count then
          reason := 'inconsistent_travellers';
        elsif nullif(btrim(parsed->>'lead_traveller'), '') is null or
            parsed->>'activity_date' is null or activity_time is null or activity_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          reason := 'incomplete_confirmation';
        elsif activity_time is distinct from classification #>> '{proposed_booking,booking_time}' then
          reason := 'mapping_changed';
        end if;
      end if;
      if reason is null then
        select * into strict price from public.experience_channel_prices
          where experience_id = exp.id and channel_id = 2 for share;
        -- Same economics as the existing webhook: configured public prices and
        -- supplier costs (adult/child or group); email net is the booking TOTAL.
        adult_price := round(price.public_unit_price, 2);
        child_price := round(coalesce(price.public_child_unit_price, price.public_unit_price), 2);
        adult_cost := round(coalesce(price.supplier_adult_unit_cost, price.your_unit_price), 2);
        child_cost := round(coalesce(price.supplier_child_unit_cost, price.supplier_adult_unit_cost,
          price.your_child_unit_price, price.your_unit_price), 2);
        if price.currency is distinct from 'EUR' or price.your_unit_price is null or price.your_unit_price < 0 or
            adult_price is null or child_price is null or adult_cost is null or child_cost is null or
            least(adult_price, child_price, adult_cost, child_cost) < 0 or
            greatest(price.your_unit_price, adult_price, child_price, adult_cost, child_cost)::text in ('NaN', 'Infinity') then
          reason := 'unsafe_channel_prices';
        else
          public_total := case when exp.is_group_pricing then adult_price else adult_price * adult_count + child_price * child_count end;
          supplier_total := case when exp.is_group_pricing then adult_cost else adult_cost * adult_count + child_cost * child_count end;
        end if;
      end if;
      if reason is null then
        -- Existing schema has no verified UNIQUE on canonical/numeric OTA refs.
        -- Serialize the short final lookup/INSERT, including concurrent writers.
        -- Plain reads remain available. A lock timeout fails closed and is retryable.
        lock table public.bookings in share row exclusive mode;
        select count(*) filter (where booking_reference = imp.booking_reference),
          count(*) filter (where booking_reference = substring(imp.booking_reference from 4)), array_agg(id order by id)
          into exact_count, historical_count, candidate_ids
          from public.bookings where business_unit_id = 1
            and booking_reference in (imp.booking_reference, substring(imp.booking_reference from 4));
        if exact_count > 1 then
          reason := 'multiple_canonical_bookings';
        elsif exact_count + historical_count > 0 then
          result_status := 'duplicate_candidate';
          reason := case when historical_count > 0 then 'historical_numeric_reference' else 'canonical_reference_exists' end;
        else
          insert into public.bookings (
            business_unit_id, channel_id, booking_source, booking_reference,
            experience_id, experience_name, supplier_id, booking_date, booking_time, booking_created_at,
            customer_name, customer_phone, adults, children, infants, total_people, pax,
            your_unit_price, public_unit_price, supplier_unit_cost, total_to_you,
            total_customer, total_amount, total_supplier_cost, margin_total, notes,
            customer_payment_status, supplier_payment_status, is_cancelled, was_modified
          ) values (
            1, 2, 'Viator', imp.booking_reference,
            exp.id, exp.name, exp.supplier_id, (parsed->>'activity_date')::date, activity_time,
            (coalesce(imp.received_at, imp.created_at) at time zone 'UTC')::date,
            parsed->>'lead_traveller', parsed->>'phone', adult_count, child_count, infant_count, people, people,
            round(price.your_unit_price, 2), adult_price, adult_cost, net,
            public_total, public_total, supplier_total, net - supplier_total,
            'Viator email FMDQ | import_id=' || imp.id || ' | net_amount_basis=booking_total' ||
              case when nullif(parsed->>'special_requests', '') is not null then E'\n' || (parsed->>'special_requests') else '' end,
            'pending', 'pending', false, false
          ) returning id into new_id;
          result_status := 'ready'; reason := 'booking_created';
        end if;
      end if;
    end if;

    classification := classification || jsonb_build_object(
      'status', result_status, 'reason', reason, 'would_do', 'none',
      'action', case when new_id is not null then 'create_booking' else 'none' end,
      'booking_writes_enabled', new_id is not null, 'booking_id', new_id
    );
    if candidate_ids is not null then
      classification := classification || jsonb_build_object('candidate_booking_ids', candidate_ids);
    end if;
    update public.viator_email_imports set
      status = result_status, booking_id = new_id, error_message = null,
      parsed_data = parsed || jsonb_build_object('classification', classification,
        'booking_writes_blocked_reason', case when new_id is null then reason else null end),
      processed_at = now(), processing_started_at = null where id = imp.id;
  exception
    when no_data_found or too_many_rows then
      diagnostics_code := 'channel_prices_missing_or_ambiguous';
    when others then
      -- SQLSTATE only, never raw DB messages containing email/customer data.
      diagnostics_code := 'booking_creation_failed:' || SQLSTATE;
  end;
  if diagnostics_code is not null then
    update public.viator_email_imports set status = 'processing_failed', booking_id = null,
      error_message = diagnostics_code, processed_at = null, processing_started_at = null where id = imp.id;
    return jsonb_build_object('status', 'processing_failed', 'action', 'none');
  end if;
  return jsonb_build_object('status', result_status, 'action', case when new_id is not null then 'create_booking' else 'none' end,
    'booking_id', new_id);
end;
$$;

revoke all on function public.create_viator_email_booking(bigint, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.create_viator_email_booking(bigint, integer, timestamptz) to service_role;
comment on function public.create_viator_email_booking(bigint, integer, timestamptz) is
  'Phase 2: confirmed FMDQ only; atomic create/link. ready + booking_id + classification.action=create_booking means created. Never updates an existing booking.';
notify pgrst, 'reload schema';
commit;
