// Real PostgreSQL in local memory. Synthetic fixtures from the reported facts;
// no production snapshots, credentials or network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = resolve(process.env.GCAL_TEST_PGLITE_MODULE || '.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js');
const PGlite = existsSync(engine) ? (await import(pathToFileURL(engine).href)).PGlite : null;
const sqlTest = (name, fn) => test(name, { skip: !PGlite && 'Local PGlite is required' }, fn);
const migration = readdirSync('supabase/migrations').find(file => file.endsWith('_google_calendar_dashboard_acknowledgements.sql'));
const actor = '00000000-0000-4000-8000-000000000001';

async function setup() {
  const db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table bookings(id bigint primary key, booking_reference text, is_cancelled boolean,
      customer_name text, cancelled_at timestamptz, total_to_you numeric, notes text, booking_date date);
    create table google_calendar_import_staging(id bigint primary key, gcal_uid text,
      imported_booking_id bigint, import_status text, booking_reference text, original_title text,
      notes text, booking_date date, booking_time time, gcal_updated_at timestamptz,
      customer_name text, adults int, children int, infants int, experience_id bigint,
      channel_id bigint, booking_source text, import_origin text, gcal_html_link text);
    grant select on bookings, google_calendar_import_staging to service_role;
    insert into bookings values(2119,'1446709553',true,'Jan',null,100,'Preserve','2026-09-01'),
      (2051,'TOD-T144976349',true,'Kimberly',null,0,'Preserve','2026-10-20');
    insert into google_calendar_import_staging
      (id,gcal_uid,imported_booking_id,import_status,booking_reference,original_title,booking_date,booking_time,
       customer_name,adults,children,infants,experience_id,channel_id,booking_source,import_origin)
    values(625,'jan-google',2152,'gcal_cancelled','1446709553','2 tour a piedi 1446709553 Jan','2026-10-21','10:00','Jan',2,0,0,9,2,'Viator','make'),
      (626,'other-google',null,'pending','GCAL-other','Another event','2026-10-22','11:00','Other',1,0,0,7,1,'Direct','make'),
      (563,'kimberly-google',2051,'gcal_cancelled','GCAL-kimberly','2 pranzo T144976349 Kimberly','2026-10-20','12:00','Kimberly',2,0,0,7,4,'Todointheworld','make');`);
  for (const file of ['202609170001_google_calendar_canonical_phase1.sql',
    '202609300001_google_calendar_verified_observation.sql', '202610120001_google_calendar_cancellation_reconciliation.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(`insert into google_calendar_events(id,canonical_uid,original_uid,uid_kind,last_observation_source,
      staging_id,original_title,event_date,event_time,gcal_event_status)
    overriding system value values(1304,'jan-google','jan-google','google','google_calendar',625,
      '2 tour a piedi 1446709553 Jan','2026-10-21','10:00','cancelled'),
      (1242,'kimberly-google','kimberly-google','google','historical_bookings',563,
      '2 pranzo T144976349 Kimberly','2026-10-20','12:00','unknown');
    insert into google_calendar_event_aliases(event_id,original_uid,canonical_uid,alias_type,reconciliation_method,verified)
      values(1242,'kimberly-google','kimberly-google','google_uid','identity',true);`);
  const snapshot = async (table, id) => (await db.query(`select to_jsonb(r) as row from ${table} r where id=$1`, [id])).rows[0].row;
  await db.query(`select approve_google_cancellation('kimberly-test','test-reviewer','confirmed cancellation',$1,$2,$3,$4)`,
    [JSON.stringify(await snapshot('bookings',2051)), JSON.stringify(await snapshot('google_calendar_import_staging',563)),
      JSON.stringify(await snapshot('google_calendar_events',1242)), JSON.stringify((await db.query('select to_jsonb(a) as row from google_calendar_event_aliases a where event_id=1242 order by id')).rows.map(r=>r.row))]);
  await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  return db;
}
const alert = async (db, id=625) => (await db.query('select * from google_calendar_dashboard_alerts where id=$1', [id])).rows[0];
const ack = async (db, version, id=625, user=actor) => (await db.query('select acknowledge_google_calendar_dashboard_alert($1,$2,$3) as saved', [id,version,user])).rows[0].saved;
async function protectedSnapshot(db) {
  const result = {};
  for (const table of ['bookings','google_calendar_import_staging','google_calendar_events','google_calendar_event_aliases']) {
    result[table] = (await db.query(`select * from ${table} order by id`)).rows;
  }
  return result;
}

sqlTest('625/1304 read receipt persists, is idempotent and independent; orphan 2152/other-date 2119 are never touched', async () => {
  const db = await setup();
  try {
    const before = await protectedSnapshot(db);
    const v = (await alert(db)).dashboard_event_version;
    await db.exec('set role service_role');
    assert.equal(await ack(db,v),true);
    assert.equal(await ack(db,v),true);
    assert.equal((await alert(db)).dashboard_acknowledged,true);
    assert.equal((await alert(db,626)).dashboard_acknowledged,false);
    const receipts = (await db.query('select * from google_calendar_dashboard_acknowledgements')).rows;
    assert.equal(receipts.length,1);
    assert.equal(receipts[0].staging_id,625);
    assert.equal(receipts[0].acknowledged_by,actor);
    assert.ok(receipts[0].acknowledged_at);
    assert.equal(receipts[0].event_snapshot.canonical[0].id,1304);
    await db.exec('reset role');
    assert.deepEqual(await protectedSnapshot(db),before);
    assert.equal((await alert(db,563)).cancellation_reconciled,true);
    assert.equal(await ack(db,(await alert(db,563)).dashboard_event_version,563),false);
  } finally { await db.close(); }
});

sqlTest('timestamps, imported link changes and repeated deliveries stay read; meaningful stage or canonical changes reappear', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    await ack(db,version);
    await db.exec(`update google_calendar_import_staging set gcal_updated_at='2026-10-22',imported_booking_id=9999 where id=625;
      update google_calendar_events set gcal_updated_at='2026-10-22',gcal_received_at='2026-10-23',updated_at='2026-10-23' where id=1304;`);
    assert.equal((await alert(db)).dashboard_event_version,version);
    assert.equal((await alert(db)).dashboard_acknowledged,true);
    for (const sql of [
      "update google_calendar_import_staging set original_title='3 tour a piedi Jan' where id=625",
      "update google_calendar_import_staging set booking_date='2026-10-23' where id=625",
      "update google_calendar_import_staging set booking_time='15:30' where id=625",
      "update google_calendar_import_staging set adults=3 where id=625",
      "update google_calendar_events set gcal_event_status='confirmed' where id=1304",
      "update google_calendar_events set original_title='Canonical changed only' where id=1304",
      "update google_calendar_events set event_date='2026-10-24' where id=1304",
    ]) {
      await db.exec('begin'); await db.exec(sql);
      assert.notEqual((await alert(db)).dashboard_event_version,version);
      assert.equal((await alert(db)).dashboard_acknowledged,false);
      assert.equal(await ack(db,version),false); // stale browser cannot hide this version
      await db.exec('rollback');
    }
    assert.equal((await alert(db)).dashboard_acknowledged,true);
  } finally { await db.close(); }
});

sqlTest('browser roles cannot read receipts or invoke RPC; service cannot erase audit or write existing operational tables', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from google_calendar_dashboard_acknowledgements'),/permission denied/);
      await assert.rejects(db.query('select * from google_calendar_dashboard_alerts'),/permission denied/);
      await assert.rejects(ack(db,version),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal(await ack(db,version),true);
    await assert.rejects(db.query('delete from google_calendar_dashboard_acknowledgements'),/permission denied/);
    await assert.rejects(db.query('update google_calendar_dashboard_acknowledgements set acknowledged_by=$1',[actor]),/permission denied/);
    await db.exec('reset role');
    await assert.rejects(ack(db,version,625,null),/Authenticated actor/);
    assert.equal(await ack(db,version,999999),false);
  } finally { await db.close(); }
});

sqlTest('read receipt is separate from Kimberly reconciliation and a new reopened observation remains unread', async () => {
  const db = await setup();
  try {
    await db.query(`select observe_reconciled_google_cancellation(1242,$1)`, [JSON.stringify({status:'confirmed',updated:'2026-10-22T10:00:00Z'})]);
    const row = await alert(db,563);
    assert.equal(row.cancellation_review_required,true);
    assert.equal(await ack(db,row.dashboard_event_version,563),true);
    const before = await protectedSnapshot(db);
    assert.equal((await alert(db,563)).dashboard_acknowledged,true);
    assert.deepEqual(await protectedSnapshot(db),before);
    assert.equal((await db.query('select is_cancelled from bookings where id=2051')).rows[0].is_cancelled,true);
    // A later substantive Google change also reopens an acknowledged review.
    await db.exec("update google_calendar_events set original_title='new significant title' where id=1242");
    assert.equal((await alert(db,563)).dashboard_acknowledged,false);
  } finally { await db.close(); }
});
