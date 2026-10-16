-- PREPARED ONLY. Compensating rollback retains the approval and its history.
begin;
set local lock_timeout = '5s';
do $repair$
declare
  canonical_snapshot jsonb := null; -- CURRENT_CANONICAL_SNAPSHOT
  staging_snapshot jsonb := null; -- CURRENT_STAGING_SNAPSHOT
  approver text := null; -- REVIEWED_APPROVER
begin
  if (canonical_snapshot->>'id')::bigint is distinct from 1242
    or canonical_snapshot->'cancellation_reconciliation_history'->-1->>'decision_id'
      is distinct from 'kimberly-2051-staging-563-v1'
    or (staging_snapshot->>'id')::bigint is distinct from 563 or approver is null then
    raise exception 'BLOCKED: exact current snapshots and approver required';
  end if;
  perform public.revoke_google_cancellation(canonical_snapshot,staging_snapshot,approver,
    'Rollback of kimberly-2051-staging-563-v1');
end;
$repair$;
rollback;
