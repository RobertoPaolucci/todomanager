-- PREPARED ONLY. Apply separately; no historical DML or changes to the create RPC.
begin;
set local lock_timeout = '5s';

create function public.cancel_viator_email_booking(
  p_import_id bigint, p_attempts integer, p_started_at timestamptz
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
declare
  imp public.viator_email_imports%rowtype;
  parsed jsonb;
  classification jsonb;
  result_status text := 'needs_review';
  reason text;
  matched_id bigint;
  candidate_ids bigint[];
  diagnostics_code text;
begin
  select * into imp from public.viator_email_imports where id = p_import_id for update;
  if not found then raise exception 'import_not_found'; end if;
  -- A retry after a lost response returns the committed result without UPDATE.
  if imp.booking_id is not null and imp.parsed_data #>> '{classification,action}' = 'cancel_booking' then
    return jsonb_build_object('status', imp.status, 'action', 'cancel_booking', 'booking_id', imp.booking_id);
  end if;
  if imp.status <> 'processing' or imp.attempts is distinct from p_attempts or
      imp.processing_started_at is distinct from p_started_at then
    raise exception 'import_lease_lost';
  end if;
  parsed := imp.parsed_data;
  classification := parsed->'classification';

  -- Subtransaction: cancellation and import link both commit or both roll back.
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
        imp.event_type <> 'cancelled' or parsed->>'event_type' is distinct from 'cancelled' or
        classification->>'status' is distinct from 'cancelled' or
        classification->>'reason' is distinct from 'cancellation_booking_found_dry_run' or
        classification->>'would_do' is distinct from 'cancel_booking' or
        parsed->'warnings' is distinct from '[]'::jsonb or
        imp.booking_reference is null or imp.booking_reference !~ '^BR-[0-9]+$' or
        parsed->>'booking_reference' is distinct from imp.booking_reference then
      reason := 'unsafe_cancellation';
    else
      -- Same serialization as Phase 2. Row locks alone cannot prevent a second
      -- matching row being inserted by another writer between count and UPDATE.
      lock table public.bookings in share row exclusive mode;
      select array_agg(id order by id) into candidate_ids
        from public.bookings where business_unit_id = 1 and channel_id = 2
          and booking_reference in (imp.booking_reference, substring(imp.booking_reference from 4));
      if coalesce(cardinality(candidate_ids), 0) = 0 then
        result_status := 'cancellation_unmatched'; reason := 'cancellation_booking_not_found';
      elsif cardinality(candidate_ids) > 1 then
        reason := 'multiple_cancellation_bookings';
      else
        matched_id := candidate_ids[1];
        -- No notes, timestamps or economic fields. Already cancelled = no UPDATE.
        update public.bookings set is_cancelled = true
          where id = matched_id and business_unit_id = 1 and channel_id = 2
            and is_cancelled is distinct from true;
        result_status := 'cancelled'; reason := 'booking_cancelled';
      end if;
    end if;

    classification := coalesce(classification, '{}'::jsonb) || jsonb_build_object(
      'status', result_status, 'reason', reason, 'would_do', 'none',
      'action', case when matched_id is not null then 'cancel_booking' else 'none' end,
      'booking_writes_enabled', matched_id is not null, 'booking_id', matched_id,
      'candidate_booking_ids', coalesce(candidate_ids, '{}'::bigint[])
    );
    update public.viator_email_imports set
      status = result_status, booking_id = matched_id, error_message = null,
      parsed_data = parsed || jsonb_build_object('classification', classification,
        'booking_writes_blocked_reason', case when matched_id is null then reason else null end),
      processed_at = now(), processing_started_at = null where id = imp.id;
  exception when others then
    -- Controlled SQLSTATE only; the subtransaction rolled back the booking UPDATE.
    diagnostics_code := 'booking_cancellation_failed:' || SQLSTATE;
  end;
  if diagnostics_code is not null then
    update public.viator_email_imports set status = 'processing_failed', booking_id = null,
      error_message = diagnostics_code, processed_at = null, processing_started_at = null where id = imp.id;
    return jsonb_build_object('status', 'processing_failed', 'action', 'none');
  end if;
  return jsonb_build_object('status', result_status,
    'action', case when matched_id is not null then 'cancel_booking' else 'none' end, 'booking_id', matched_id);
end;
$$;

revoke all on function public.cancel_viator_email_booking(bigint, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_viator_email_booking(bigint, integer, timestamptz) to service_role;
comment on function public.cancel_viator_email_booking(bigint, integer, timestamptz) is
  'FMDQ cancelled only; BU1/channel2 canonical or numeric unique match. Atomic is_cancelled/link; no economics or notes updates.';
notify pgrst, 'reload schema';
commit;
