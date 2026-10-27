-- PREPARED ONLY. First revert application callers; retain all reconciliation
-- archives/booking links. Removing guards reopens the old duplicate risk.
begin;
set local lock_timeout='5s';
drop trigger guard_viator_google_insert on public.bookings;
drop function public.guard_viator_google_insert();
drop function public.reconcile_viator_google_booking(jsonb,jsonb,jsonb,jsonb);
drop function public.google_has_viator_evidence(bigint);
drop function public.google_title_has_viator_reference(text,text);
drop function public.viator_reference_key(text);
rollback;
