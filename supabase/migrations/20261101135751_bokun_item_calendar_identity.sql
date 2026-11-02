-- PREPARED ONLY: no historical backfill or production data repair.
begin;
set local lock_timeout = '5s';

alter table public.bookings add column bokun_item_reference text;
alter table public.bookings add column superseded_by_booking_id bigint references public.bookings(id);
alter table public.bookings add column duplicate_reconciliation_audit jsonb;
create index bookings_superseded_by_booking_idx on public.bookings(superseded_by_booking_id)
  where superseded_by_booking_id is not null;
alter table public.bookings add constraint bookings_bokun_item_identity check (
  bokun_item_reference is null or (bokun_item_reference ~ '^TOD-T[0-9]+$'
    and bokun_booking_reference is not null and business_unit_id is not null));
create unique index bookings_business_unit_bokun_item_key
  on public.bookings(business_unit_id, bokun_item_reference) where bokun_item_reference is not null;
alter table public.bookings add constraint bookings_superseded_inactive check (
  superseded_by_booking_id is null or (superseded_by_booking_id <> id and is_cancelled is true
    and jsonb_typeof(duplicate_reconciliation_audit) = 'object' and duplicate_reconciliation_audit is not null));

-- Protect archived duplicates across ALL restore/delete paths, including direct
-- calls and webhook replays. No change to normal cancellations or rebookings.
create function public.guard_bokun_duplicate_identity() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target public.bookings;
begin
  if tg_op <> 'INSERT' and old.superseded_by_booking_id is not null then
    if tg_op='DELETE' then raise exception 'Preserve duplicate reconciliation history'; end if;
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'Archived duplicate is immutable; explicit audited repair required';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and old.bokun_item_reference is not null and
    (new.bokun_item_reference is distinct from old.bokun_item_reference
      or new.business_unit_id is distinct from old.business_unit_id
      or new.bokun_booking_reference is distinct from old.bokun_booking_reference) then
    raise exception 'Bokun item identity is immutable';
  end if;
  if new.superseded_by_booking_id is not null then
    select * into strict target from public.bookings where id=new.superseded_by_booking_id for update;
    if target.business_unit_id is distinct from new.business_unit_id or target.bokun_item_reference is null
      or target.bokun_booking_reference is null or target.is_cancelled is distinct from false
      or target.superseded_by_booking_id is not null then
      raise exception 'Duplicate target must be an active Bokun booking in the same business unit';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_bokun_duplicate_identity before insert or update or delete on public.bookings
for each row execute function public.guard_bokun_duplicate_identity();

-- Calendar product codes are reconciliation-only. No application SELECT/INSERT
-- race can create a second booking, including when Calendar arrives first.
create function public.guard_google_bokun_insert() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.business_unit_id=1 and new.bokun_booking_reference is null
    and (coalesce(new.notes,'') ~* '(^|[^A-Z0-9-])(TOD-)?T[0-9]+([^A-Z0-9-]|$)'
      or coalesce(new.booking_reference,'') ~* '^TOD-T[0-9]+$')
    and coalesce(new.booking_reference,'') ~* '^(GCAL-|TOD-T)' then
    raise exception 'google_bokun_item_reconciliation_required' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guard_google_bokun_insert before insert on public.bookings
for each row execute function public.guard_google_bokun_insert();

comment on column public.bookings.bokun_item_reference is
  'Verified product booking confirmation code (TOD-T...), not catalogue product ID. No inferred historical backfill.';
comment on column public.bookings.superseded_by_booking_id is
  'Audited inactive duplicate; cannot be restored or deleted. Google staging links must point at the surviving booking.';
revoke all on function public.guard_bokun_duplicate_identity(), public.guard_google_bokun_insert() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
