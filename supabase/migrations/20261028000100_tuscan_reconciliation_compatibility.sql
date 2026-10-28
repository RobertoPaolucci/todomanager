-- Todo Manager / FMDQ — 2026-10-28
-- Safe compatibility patch for the EXISTING Tuscan Escape reconciliation function.
-- No booking, staging, canonical, invoice, payment or cancellation row is updated.
-- Preserve the 2026-10-12 staging guard and all other pre-existing checks.
-- Stop if the function/trigger differs from the audited production versions.

DO $tuscan_compat_20261028$
DECLARE
  target regprocedure := to_regprocedure('public.reconcile_tuscan_google_booking(jsonb,jsonb,jsonb,jsonb)');
  definition text;
  new_definition text;
  old_title text := $old_title$or s.original_title !~* '^\d+\s+pranzo\s+tuscan\s+escape\s*$'$old_title$;
  new_title text := $new_title$or s.original_title !~* '^\d+\s+pranzo(\s+\(2 pasta al posto della ribollita\))?\s+tuscan\s+escape\s*$'$new_title$;
  old_guard text := $old_guard$and not (tgrelid='public.google_calendar_import_staging'::regclass and tgname='guard_reconciled_google_staging' and tgfoid is not distinct from to_regprocedure('public.guard_reconciled_google_staging()') and tgtype=19 and tgnargs=0 and tgqual is null) and not tgisinternal$old_guard$;
  new_guard text;
  cancellation_trigger_ddl text := $trigger_ddl$CREATE TRIGGER track_booking_cancellation_alert_revision AFTER INSERT OR UPDATE OF is_cancelled, booking_date, booking_time, total_people, customer_name, experience_id, experience_name, channel_id, booking_source ON public.bookings FOR EACH ROW WHEN ((new.is_cancelled IS TRUE)) EXECUTE FUNCTION track_booking_cancellation_alert_revision()$trigger_ddl$;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'Tuscan compatibility: function missing, no change made';
  END IF;

  -- Require the exact audited cancellation-alert trigger, including its WHEN clause.
  -- It cannot run for non-cancelled Tuscan bookings; no general trigger bypass is added.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.bookings'::regclass
      AND t.tgname = 'track_booking_cancellation_alert_revision'
      AND t.tgenabled = 'O'
      AND NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure('public.track_booking_cancellation_alert_revision()')
      AND t.tgtype = 21
      AND t.tgnargs = 0
      AND pg_get_triggerdef(t.oid) = cancellation_trigger_ddl
  ) THEN
    RAISE EXCEPTION 'Tuscan compatibility: unexpected cancellation trigger, no change made';
  END IF;

  definition := pg_get_functiondef(target);
  new_guard :=
    'and not (tgrelid=''public.bookings''::regclass and tgname=''track_booking_cancellation_alert_revision'' and tgfoid is not distinct from to_regprocedure(''public.track_booking_cancellation_alert_revision()'') and tgtype=21 and tgnargs=0 and pg_get_triggerdef(oid) = ' || quote_literal(cancellation_trigger_ddl) || ') ' || old_guard;

  -- Exact once-only replacements. Any unknown DB evolution must be reviewed manually.
  IF (length(definition)-length(replace(definition,old_title,'')))/length(old_title) <> 1
     OR (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1
     OR position(new_title in definition) > 0
     OR position(new_guard in definition) > 0 THEN
    RAISE EXCEPTION 'Tuscan compatibility: unexpected current function body, no change made';
  END IF;

  new_definition := replace(replace(definition,old_title,new_title),old_guard,new_guard);
  EXECUTE new_definition; -- CREATE OR REPLACE FUNCTION: preserves existing owner and grants.

  IF (SELECT pg_get_functiondef(target)) IS DISTINCT FROM new_definition THEN
    -- pg_get_functiondef may normalize whitespace; verify safety markers instead.
    IF position(new_title in (SELECT pg_get_functiondef(target))) = 0
       OR position(new_guard in (SELECT pg_get_functiondef(target))) = 0 THEN
      RAISE EXCEPTION 'Tuscan compatibility: unexpected post-update function body';
    END IF;
  END IF;
END;
$tuscan_compat_20261028$;
