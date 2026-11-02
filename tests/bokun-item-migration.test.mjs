// Isolated PostgreSQL, no credentials or live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js';
const migration = readFileSync('supabase/migrations/20261102110358_bokun_item_calendar_identity.sql', 'utf8');
const repair = readFileSync('supabase/diagnostics/bokun-2415-2419-repair-preview.sql', 'utf8');
const existingCancellationTrigger = `create function track_booking_cancellation_alert_revision()
    returns trigger language plpgsql as $ begin return new; end; $;
  create trigger track_booking_cancellation_alert_revision
    after update on bookings for each row
    execute function track_booking_cancellation_alert_revision();`;

test('item identity, race guard and immutable archived duplicates, without historical backfill', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table bookings (id bigint primary key, business_unit_id bigint, bokun_booking_reference text,
        is_cancelled boolean, booking_reference text, notes text, booking_date date, booking_time text,
        total_people integer, customer_name text, experience_id bigint, experience_name text,
        channel_id bigint, booking_source text);
      insert into bookings(id,business_unit_id,bokun_booking_reference,is_cancelled,booking_reference,notes)
        values (1,1,'TOD-108037806',false,null,null),
          (2,1,null,false,'GCAL-original','2+1 neonato pranzo T151827070 Test');`);
    const before = (await db.query('select * from bookings order by id')).rows;
    await db.exec(existingCancellationTrigger);
    await db.exec(migration);
    const after = (await db.query('select * from bookings order by id')).rows;
    for (const row of after) {
      assert.equal(row.bokun_item_reference, null); assert.equal(row.superseded_by_booking_id, null);
      delete row.bokun_item_reference; delete row.superseded_by_booking_id; delete row.duplicate_reconciliation_audit;
    }
    assert.deepEqual(after, before);
    await db.exec("update bookings set bokun_item_reference='TOD-T151827070' where id=1");
    await assert.rejects(db.exec(`insert into bookings(id,business_unit_id,bokun_booking_reference,bokun_item_reference)
      values(3,1,'TOD-OTHER','TOD-T151827070')`), e => e.code === '23505');
    await db.exec(`insert into bookings(id,business_unit_id,bokun_booking_reference,bokun_item_reference)
      values(3,2,'TOD-OTHER','TOD-T151827070')`);
    await assert.rejects(db.exec("update bookings set bokun_item_reference='TOD-T999999' where id=1"), /immutable/);
    // Both orders: Google before/after Bókun are blocked, regardless of date.
    for (const code of ['T151827070', 'T999999999']) {
      await assert.rejects(db.exec(`insert into bookings(id,business_unit_id,booking_reference,notes)
        values(4,1,'GCAL-new','2 pranzo ${code}')`), /reconciliation_required/);
    }
    await assert.rejects(db.exec("update bookings set superseded_by_booking_id=1, is_cancelled=true where id=2"));
    await db.exec(`update bookings set superseded_by_booking_id=1, is_cancelled=true,
      duplicate_reconciliation_audit='{"reason":"verified_duplicate","booking_before":{"id":2}}' where id=2`);
    await assert.rejects(db.exec("update bookings set is_cancelled=false where id=2"), /immutable/);
    await assert.rejects(db.exec("update bookings set superseded_by_booking_id=null where id=2"), /immutable/);
    await assert.rejects(db.exec("delete from bookings where id=2"), /Preserve/);
    await db.exec("update bookings set is_cancelled=true where id=1");
    assert.equal((await db.query('select is_cancelled from bookings where id=2')).rows[0].is_cancelled, true);
    // Ordinary manual bookings and other business units remain usable.
    await db.exec(`insert into bookings(id,business_unit_id,booking_reference,notes) values
      (4,1,'MANUAL-123','2 pranzo T999999999'),(5,2,'GCAL-other-unit','2 pranzo T999999999')`);
  } finally { await db.close(); }
});

test('case repair refuses missing evidence, preserves snapshots/canonical, relinks staging and prevents restoration', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table bookings(id bigint primary key,business_unit_id int,channel_id int,experience_id int,
        bokun_booking_reference text,booking_date date,booking_time text,adults int,children int,infants int,
        total_people int,total_to_you numeric,total_customer numeric,total_supplier_cost numeric,margin_total numeric,
        total_amount numeric,pax int,agreed_unit_price numeric,price_tier_snapshot jsonb,customer_payment_status text,
        supplier_payment_status text,supplier_amount_paid numeric,is_cancelled boolean,cancelled_at timestamptz,
        booking_reference text,notes text,customer_name text,experience_name text,booking_source text);
      create table google_calendar_import_staging(id bigint primary key,imported_booking_id bigint,
        import_status text,gcal_uid text,original_title text,booking_date date,booking_time time);
      create table google_calendar_events(id bigint primary key,original_uid text,original_title text,event_date date,event_time time,
        gcal_event_status text,historical_booking_id bigint,staging_id bigint,cancellation_reconciliation_history jsonb);
      create table google_calendar_event_aliases(historical_booking_id bigint);
      create table viator_email_imports(booking_id bigint);
      create table fmdq_monthly_invoices(channel_id int,invoice_month date,is_invoiced boolean);
      insert into bookings(id,business_unit_id,channel_id,experience_id,bokun_booking_reference,booking_date,booking_time,
        adults,children,infants,total_people,total_to_you,total_customer,total_supplier_cost,margin_total,
        customer_payment_status,supplier_payment_status,supplier_amount_paid,is_cancelled)
      values(2415,1,6,7,'TOD-108037806','2026-11-23','12:00',3,0,0,3,114,135,114,0,'pending','pending',0,false),
        (2419,1,6,7,null,'2026-11-24','12:00',2,0,1,3,76,90,76,0,'pending','pending',0,false);
      update bookings set pax=case id when 2415 then 1 else 2 end,
        total_amount=case id when 2415 then 0 else 90 end,
        customer_name=case id when 2415 then 'Andie Beustring' else 'Beustring' end;
      insert into google_calendar_import_staging values(724,2419,'needs_review','offline-uid',
        '2+1 neonato pranzo T151827070 Beustring','2026-11-23','12:00');
      insert into google_calendar_events values(1373,'offline-uid','2+1 neonato pranzo T151827070 Beustring',
        '2026-11-23','12:00','confirmed',null,null,'[]');`);
    await db.exec(existingCancellationTrigger);
    await db.exec(migration);
    const canonical = (await db.query('select * from google_calendar_events')).rows;
    await assert.rejects(db.exec(repair), /evidence required/);
    await db.exec('rollback');
    assert.match(repair, /rollback;\s*$/i, 'production artifact defaults to rollback');
    // Commit only in this isolated in-memory database to inspect resulting state.
    const authorized = repair.replace("set_config('todomanager.repair_evidence', '', true)",
      "set_config('todomanager.repair_evidence', 'offline verified fixture', true)").replace(/rollback;\s*$/i, 'commit;');
    await db.exec(authorized);
    const rows = (await db.query('select * from bookings order by id')).rows;
    assert.equal(rows[0].adults, 2); assert.equal(rows[0].infants, 1); assert.equal(Number(rows[0].total_to_you), 76);
    assert.equal(Number(rows[0].total_customer), 90); assert.equal(rows[0].bokun_item_reference, 'TOD-T151827070');
    assert.equal(rows[1].is_cancelled, true); assert.equal(Number(rows[1].superseded_by_booking_id), 2415);
    assert.equal(rows[1].duplicate_reconciliation_audit.survivor_before.adults, 3);
    assert.equal(rows[1].duplicate_reconciliation_audit.staging_before.imported_booking_id, 2419);
    assert.deepEqual((await db.query('select * from google_calendar_events')).rows, canonical);
    const staging = (await db.query('select * from google_calendar_import_staging')).rows[0];
    assert.equal(Number(staging.imported_booking_id), 2415); assert.equal(staging.import_status, 'already_exists');
    await assert.rejects(db.exec('update bookings set is_cancelled=false where id=2419'), /immutable/);
    await assert.rejects(db.exec('delete from bookings where id=2419'), /Preserve/);
  } finally { await db.close(); }
});
