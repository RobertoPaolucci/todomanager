// PostgreSQL in local memory only: synthetic fixtures, no Supabase connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = resolve(process.env.GCAL_TEST_PGLITE_MODULE || '.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js');
const PGlite = existsSync(engine) ? (await import(pathToFileURL(engine).href)).PGlite : null;
const sqlTest = (name, fn) => test(name, { skip: !PGlite && 'Local PGlite is required' }, fn);
const migration = readdirSync('supabase/migrations').find(file => file.endsWith('_booking_cancellation_dashboard_acknowledgements.sql'));
const actor = '00000000-0000-4000-8000-000000000001';
const otherActor = '00000000-0000-4000-8000-000000000002';

async function setup() {
  const db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table bookings(id bigint primary key, booking_reference text, is_cancelled boolean,
      customer_name text, cancelled_at timestamptz, total_to_you numeric, notes text, booking_date date,
      booking_time time, total_people int, experience_id bigint, experience_name text,
      channel_id bigint, booking_source text, updated_at timestamptz, supplier_id bigint,
      supplier_amount_paid numeric, commission numeric);
    grant select, insert, update on bookings to service_role;
    insert into bookings(id,booking_reference,is_cancelled,customer_name,notes,booking_date,
      booking_time,total_people,experience_id,experience_name,channel_id,booking_source,total_to_you,
      supplier_id,supplier_amount_paid,commission) values
      (1,'SHARED-REF',true,'Ociesa Ewelina','🔴 Prenotazione cancellata','2026-10-21',
        '10:00',2,9,'Horseback Riding',2,'Viator',120,8,20,5),
      (2,'SHARED-REF',true,'Other','🔴 Prenotazione cancellata','2026-10-21',
        '11:00',2,9,'Horseback Riding',2,'Viator',140,8,0,6),
      (3,'GREEN',false,'New','🟢 Nuova prenotazione','2026-10-21',null,1,9,'Horseback Riding',2,'Viator',0,8,0,0),
      (4,'YELLOW',false,'Modified','🟡 Prenotazione modificata','2026-10-21',null,1,9,'Horseback Riding',2,'Viator',0,8,0,0);
    create table google_calendar_import_staging(id bigint primary key, gcal_uid text,
      imported_booking_id bigint, import_status text, booking_reference text, original_title text,
      notes text, booking_date date, booking_time time, gcal_updated_at timestamptz,
      customer_name text, adults int, children int, infants int, experience_id bigint,
      channel_id bigint, booking_source text, import_origin text, gcal_html_link text);
    grant select on google_calendar_import_staging to service_role;
    insert into google_calendar_import_staging (id,gcal_uid,imported_booking_id,import_status,import_origin)
      values (1,'gcal-test',1,'gcal_cancelled','make');`);
  for (const file of ['202609170001_google_calendar_canonical_phase1.sql',
    '202609300001_google_calendar_verified_observation.sql', '202610120001_google_calendar_cancellation_reconciliation.sql',
    '20261021115634_google_calendar_dashboard_acknowledgements.sql', migration]) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  return db;
}
const alert = async (db, id = 1) => (await db.query('select * from booking_dashboard_alerts where id=$1', [id])).rows[0];
const ack = async (db, version, id = 1, user = actor) => (await db.query(
  'select acknowledge_booking_cancellation_alert($1,$2,$3) as saved', [id, version, user])).rows[0].saved;
const receipts = async db => (await db.query('select * from booking_cancellation_dashboard_acknowledgements order by booking_id,event_version')).rows;
const snapshot = async db => {
  const result = {};
  for (const table of ['bookings', 'google_calendar_import_staging', 'google_calendar_events', 'google_calendar_event_aliases']) {
    result[table] = (await db.query(`select * from ${table} order by id`)).rows;
  }
  return result;
};

sqlTest('one receipt persists across new sessions, is independent and idempotent, and changes no booking data', async () => {
  const db = await setup();
  try {
    const before = await snapshot(db);
    const version = (await alert(db)).dashboard_event_version;
    assert.match(version, /^v1:[0-9a-f]{32}$/);
    await db.exec('set role service_role');
    assert.equal(await ack(db, version), true);
    const original = await receipts(db);
    assert.equal(original.length, 1);
    assert.equal(original[0].acknowledged_by, actor);
    assert.ok(original[0].acknowledged_at);
    assert.equal(original[0].event_snapshot.kind, 'booking_cancelled');
    assert.equal(await ack(db, version, 1, otherActor), true);
    assert.deepEqual(await receipts(db), original); // first reader/time are never overwritten
    await db.exec('reset role; set role service_role'); // a new authenticated session sees shared receipts
    assert.equal((await alert(db)).dashboard_acknowledged, true);
    assert.equal((await alert(db, 2)).dashboard_acknowledged, false);
    assert.equal((await db.query('select count(*)::int as n from booking_dashboard_alerts where not dashboard_acknowledged')).rows[0].n, 3);
    await db.exec('reset role');
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

sqlTest('technical updates, money, notes and identical cancellation replay keep the version read', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    await ack(db, version);
    await db.exec(`set role service_role;
      update bookings set updated_at=clock_timestamp(),cancelled_at=clock_timestamp(),
        is_cancelled=true,booking_time='10:00:00',customer_name='  OCIESA   EWELINA  ',
        total_to_you=200,supplier_amount_paid=100,commission=8,supplier_id=10,
        booking_reference='CHANGED-REF',notes=E'🔴 Prenotazione cancellata\nNota tecnica' where id=1;`);
    assert.equal((await alert(db)).dashboard_event_version, version);
    assert.equal((await alert(db)).dashboard_acknowledged, true);
    assert.equal((await db.query('select revision from booking_cancellation_alert_revisions where booking_id=1')).rows[0].revision, 1);
  } finally { await db.close(); }
});

sqlTest('meaningful changes reopen the individual alert; stale clients cannot acknowledge new evidence', async () => {
  const db = await setup();
  try {
    const originalVersion = (await alert(db)).dashboard_event_version;
    await ack(db, originalVersion);
    for (const change of ["booking_date='2026-10-22'", "booking_time='15:00'", 'total_people=3',
      'experience_id=10', "experience_name='Different tour'", "customer_name='Different customer'", 'channel_id=3']) {
      await db.exec('begin');
      await db.exec(`update bookings set ${change} where id=1`);
      const next = await alert(db);
      assert.notEqual(next.dashboard_event_version, originalVersion, change);
      assert.equal(next.dashboard_acknowledged, false);
      assert.equal(await ack(db, originalVersion), false);
      assert.equal(await ack(db, next.dashboard_event_version), true);
      await db.exec('rollback');
    }
    // Returning to an earlier schedule is itself a new operational change.
    await db.exec("update bookings set booking_date='2026-10-22' where id=1; update bookings set booking_date='2026-10-21' where id=1;");
    assert.notEqual((await alert(db)).dashboard_event_version, originalVersion);
    assert.equal((await alert(db)).dashboard_acknowledged, false);
  } finally { await db.close(); }
});

sqlTest('restore and cancel again creates a new version even without a Dashboard visit in between', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    await ack(db, version);
    await db.exec('set role service_role; update bookings set is_cancelled=false where id=1');
    assert.equal((await alert(db)).dashboard_event_version, null);
    assert.equal(await ack(db, version), false);
    await db.exec('update bookings set is_cancelled=true where id=1');
    assert.notEqual((await alert(db)).dashboard_event_version, version);
    assert.equal((await alert(db)).dashboard_acknowledged, false);
    assert.equal((await alert(db, 2)).dashboard_acknowledged, false);
    assert.equal((await receipts(db)).length, 1);
    // Future cancelled inserts are tracked, too.
    await db.exec("insert into bookings(id,is_cancelled,notes) values (10,true,'🔴 Prenotazione cancellata')");
    assert.ok((await alert(db, 10)).dashboard_event_version);
  } finally { await db.close(); }
});

sqlTest('other red messages, mixed, yellow, green and stale cancellations cannot be acknowledged', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    for (const [notes, cancelled] of [
      ['🔴 Pagamento da verificare', true], ['🔴 Prenotazione cancellata\n🟡 Altro avviso', true],
      ['🔴 Prenotazione cancellata\n🔴 Altro problema', true],
      ['🟡 Prenotazione modificata', true], ['🟢 Nuova prenotazione', false],
      ['🔴 Prenotazione cancellata', false], ['🔴 Prenotazione cancellata', null],
    ]) {
      await db.query('update bookings set notes=$1,is_cancelled=$2 where id=1', [notes, cancelled]);
      assert.equal((await alert(db)).dashboard_event_version, null, notes);
      assert.equal(await ack(db, version), false);
    }
    for (const id of [3, 4, 999]) assert.equal(await ack(db, version, id), false);
    assert.deepEqual(await receipts(db), []);
  } finally { await db.close(); }
});

sqlTest('browser roles are denied; audit cannot be overwritten or deleted; null actor is rejected', async () => {
  const db = await setup();
  try {
    const version = (await alert(db)).dashboard_event_version;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of ['booking_cancellation_dashboard_acknowledgements', 'booking_cancellation_alert_revisions',
        'booking_dashboard_alerts', 'booking_cancellation_alert_versions']) {
        await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      }
      await assert.rejects(ack(db, version), /permission denied/);
      await assert.rejects(db.query('insert into booking_cancellation_alert_revisions values (999,1)'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(ack(db, version, 1, null), /Authenticated actor/);
    assert.equal(await ack(db, version), true);
    await assert.rejects(db.query('delete from booking_cancellation_dashboard_acknowledgements'), /permission denied/);
    await assert.rejects(db.query('update booking_cancellation_dashboard_acknowledgements set acknowledged_by=$1', [otherActor]), /permission denied/);
    assert.equal(await ack(db, 'v1:' + '0'.repeat(32)), false);
  } finally { await db.close(); }
});

sqlTest('Google Calendar receipts coexist independently even when staging and booking IDs coincide', async () => {
  const db = await setup();
  try {
    const gcal = () => db.query('select * from google_calendar_dashboard_alerts where id=1').then(r => r.rows[0]);
    const googleBefore = await gcal();
    const protectedBefore = await snapshot(db);
    await ack(db, (await alert(db)).dashboard_event_version);
    assert.deepEqual(await gcal(), googleBefore);
    assert.equal((await db.query('select count(*)::int as n from google_calendar_dashboard_acknowledgements')).rows[0].n, 0);
    assert.equal((await db.query('select acknowledge_google_calendar_dashboard_alert(1,$1,$2) as saved',
      [googleBefore.dashboard_event_version, actor])).rows[0].saved, true);
    assert.equal((await alert(db)).dashboard_acknowledged, true);
    assert.equal((await gcal()).dashboard_acknowledged, true);
    assert.deepEqual(await snapshot(db), protectedBefore);
  } finally { await db.close(); }
});
