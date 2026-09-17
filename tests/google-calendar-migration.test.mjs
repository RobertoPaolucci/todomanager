// PostgreSQL integration in isolated memory only; never uses Supabase/env files.
// Optional test engine lives outside the repository, supplied explicitly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { prepareHistoricalGoogleCalendarBackfill, renderHistoricalGoogleCalendarBackfillSql } from "../lib/google-calendar-historical-backfill.mjs";

const enginePath = process.env.GCAL_TEST_PGLITE_MODULE;
const PGlite = enginePath ? (await import(pathToFileURL(enginePath).href)).PGlite : null;
const options = { skip: !PGlite && "Set GCAL_TEST_PGLITE_MODULE to an isolated PGlite installation" };
const migration = readFileSync(new URL("../supabase/migrations/202609170001_google_calendar_canonical_phase1.sql", import.meta.url), "utf8");

const historical = (overrides = {}) => ({
  id: 1, google_uid: "569b4a1925014716a1262afe926cd13e", booking_date: "2026-05-08", booking_time: "12:00:00",
  original_title: "2 Pranzo", total_guests: 2, status: "CONFIRMED", source: "google_calendar_ics", experience_name: "Pranzo", ...overrides,
});

async function database(rows = []) {
  const db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.historical_bookings (
      id bigint primary key, google_uid text, booking_date date, booking_time time,
      original_title text, total_guests integer, status text, source text, experience_name text);
    create table public.bookings (id bigint primary key, notes text);
    create table public.google_calendar_import_staging (id bigint primary key, import_status text);
    insert into public.bookings values (1, 'operational row');
    insert into public.google_calendar_import_staging values (1, 'ignored');
  `);
  for (const row of rows) {
    await db.query(`insert into public.historical_bookings
      (id, google_uid, booking_date, booking_time, original_title, total_guests, status, source, experience_name)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.id, row.google_uid, row.booking_date, row.booking_time, row.original_title, row.total_guests, row.status ?? null, row.source, row.experience_name]);
  }
  return db;
}

async function oldRows(db) {
  return Promise.all(["bookings", "historical_bookings", "google_calendar_import_staging"].map(async table =>
    (await db.query(`select * from public.${table} order by id`)).rows));
}

test("migration preserves old tables; nullable scopes are unique; aliases share one event; RLS protects data", options, async () => {
  const db = await database([historical()]);
  try {
    const before = await oldRows(db);
    await db.exec(migration);
    assert.deepEqual(await oldRows(db), before);
    assert.equal((await db.query("select count(*)::int as n from pg_trigger where not tgisinternal")).rows[0].n, 0);
    await db.exec(`insert into public.google_calendar_events(canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('uid-1', 'uid-1', 'google', 'historical_bookings')`);
    await assert.rejects(db.exec(`insert into public.google_calendar_events(canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('uid-1', 'different-raw', 'google', 'historical_bookings')`), e => e.code === "23505");
    await db.exec(`insert into public.google_calendar_events(calendar_id, identity_namespace, canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('another-calendar', 'calendar:verified-other', 'uid-1', 'uid-1', 'google', 'historical_bookings');
      insert into public.google_calendar_events(uid_semantics, occurrence_id, canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('ical_uid', 'another-occurrence', 'uid-1', 'uid-1', 'google', 'historical_bookings');
      insert into public.google_calendar_event_aliases(event_id, original_uid, canonical_uid, alias_type, reconciliation_method, verified)
      values (1, 'uid-1', 'uid-1', 'google_uid', 'identity', true),
             (1, '_encoded-counterpart', 'uid-1', 'base32hex', 'base32hex_roundtrip', true);`);
    assert.equal((await db.query("select count(distinct event_id)::int as n from public.google_calendar_event_aliases")).rows[0].n, 1);
    await assert.rejects(db.exec(`insert into public.google_calendar_event_aliases(event_id, original_uid, canonical_uid, alias_type, reconciliation_method)
      values (1, 'wrong', 'wrong-parent-uid', 'google_uid', 'identity')`), e => e.code === "23503");
    await assert.rejects(db.exec(`insert into public.google_calendar_events(canonical_uid, original_uid, uid_kind, last_observation_source, gcal_event_status)
      values ('invalid-state', 'invalid-state', 'google', 'historical_bookings', 'imported')`), e => e.code === "23514");
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from public.google_calendar_events_monthly_control"), e => e.code === "42501");
    await db.exec("reset role; set role service_role");
    assert.equal((await db.query("select * from public.google_calendar_events_monthly_control")).rows.length, 1);
    await assert.rejects(db.exec("delete from public.google_calendar_events_monthly_control"));
  } finally { await db.close(); }
});

test("actual SQL backfill preserves NULL and excluded counts, aggregates control view and replays without overwrites", options, async () => {
  const rows = [historical(), historical({ id: 2, google_uid: "uid-null", total_guests: null, status: null }),
    historical({ id: 3, google_uid: "uid-block", total_guests: 1, experience_name: "Tuscan Escape - Blocco data" }),
    historical({ id: 4, google_uid: "uid-cancelled", total_guests: 9, status: "CANCELLED" })];
  const db = await database(rows);
  try {
    const before = await oldRows(db);
    await db.exec(migration);
    const sql = renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill(rows));
    await db.exec(sql);
    const events = (await db.query("select * from public.google_calendar_events order by id")).rows;
    const aliases = (await db.query("select * from public.google_calendar_event_aliases order by id")).rows;
    assert.equal(events.length, 4);
    assert.equal(events[1].effective_total_guests, null);
    assert.equal(events[2].effective_total_guests, 1);
    assert.equal(events[2].exclusion_reason, "explicit_tuscan_escape_block");
    const view = (await db.query("select * from public.google_calendar_events_monthly_control")).rows[0];
    assert.equal(Number(view.canonical_events), 4);
    assert.equal(Number(view.eligible_events), 2);
    assert.equal(Number(view.effective_presences), 2);
    for (const field of ["excluded_events", "cancelled_events", "null_attendance_events", "eligible_null_attendance_events", "unknown_status_events"]) assert.equal(Number(view[field]), 1);
    await db.exec(sql);
    assert.deepEqual((await db.query("select * from public.google_calendar_events order by id")).rows, events);
    assert.deepEqual((await db.query("select * from public.google_calendar_event_aliases order by id")).rows, aliases);
    assert.deepEqual(await oldRows(db), before);
  } finally { await db.close(); }
});

test("existing canonical enrichment blocks repeat backfill and rolls back all new rows", options, async () => {
  const rows = [historical(), historical({ id: 2, google_uid: "uid-new" })];
  const db = await database(rows);
  try {
    await db.exec(migration);
    await db.exec(renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill([rows[0]])));
    await db.exec("update public.google_calendar_events set effective_total_guests = 42 where historical_booking_id = 1");
    const before = (await db.query("select * from public.google_calendar_events")).rows;
    await assert.rejects(db.exec(renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill(rows))), /Canonical conflict/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select * from public.google_calendar_events")).rows, before);
  } finally { await db.close(); }
});

test("changed historical source invalidates an already generated plan without canonical writes", options, async () => {
  const row = historical();
  const db = await database([row]);
  try {
    await db.exec(migration);
    const sql = renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill([row]));
    await db.exec("update public.historical_bookings set total_guests = 3 where id = 1");
    await assert.rejects(db.exec(sql), /Historical source changed/);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int as n from public.google_calendar_events")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("verified/manual alias changes are never reset by repeat backfill", options, async () => {
  const rows = [historical()];
  const db = await database(rows);
  try {
    await db.exec(migration);
    const sql = renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill(rows));
    await db.exec(sql);
    await db.exec("update public.google_calendar_event_aliases set verified = false");
    const before = (await db.query("select * from public.google_calendar_event_aliases")).rows;
    await assert.rejects(db.exec(sql), /Alias conflict/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select * from public.google_calendar_event_aliases")).rows, before);
  } finally { await db.close(); }
});

test("titles containing quotes/backslashes/newlines remain literal; all-NULL attendance is not zero", options, async () => {
  const row = historical({ total_guests: null, status: null, original_title: "O'Reilly \\ title\n$gcal_preflight$; literal" });
  const db = await database([row]);
  try {
    await db.exec(migration);
    await db.exec(renderHistoricalGoogleCalendarBackfillSql(prepareHistoricalGoogleCalendarBackfill([row])));
    assert.equal((await db.query("select original_title from public.google_calendar_events")).rows[0].original_title, row.original_title);
    assert.equal((await db.query("select effective_presences from public.google_calendar_events_monthly_control")).rows[0].effective_presences, null);
  } finally { await db.close(); }
});

test("calendar enrichment and recurrence metadata cannot create a second resource-id event", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, uid_semantics, last_observation_source, gcal_event_id)
      values ('instance-id', 'instance-id', 'google', 'event_id', 'google_calendar', 'instance-id');
      insert into public.google_calendar_event_aliases
      (event_id, original_uid, canonical_uid, alias_type, reconciliation_method)
      values (1, 'instance-id', 'instance-id', 'google_uid', 'identity');
      update public.google_calendar_events set calendar_id = 'verified-calendar', recurring_event_id = 'series-id',
        original_start_at = '2026-09-17T10:00:00Z', event_date = '2026-09-18' where id = 1;
      update public.google_calendar_event_aliases set calendar_id = 'verified-calendar' where event_id = 1;`);
    await assert.rejects(db.exec(`insert into public.google_calendar_events
      (calendar_id, canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('verified-calendar', 'instance-id', 'instance-id', 'google', 'google_calendar')`), e => e.code === "23505");
    await assert.rejects(db.exec(`update public.google_calendar_events set occurrence_id = '2026-09-17T10:00:00Z' where id = 1`), e => e.code === "23514");
    await assert.rejects(db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, last_observation_source, gcal_event_id)
      values ('other-representation', 'other-representation', 'google', 'google_calendar', 'instance-id')`), e => e.code === "23505");
    await assert.rejects(db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, last_observation_source, recurring_event_id, original_start_at)
      values ('moved-instance', 'moved-instance', 'google', 'google_calendar', 'series-id', '2026-09-17T10:00:00Z')`), e => e.code === "23505");
    assert.equal((await db.query("select count(*)::int as n from public.google_calendar_events")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("verified series iCalUID occurrences stay distinct, moved events retain identity, all-day original start is preserved", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, uid_semantics, occurrence_id, recurring_event_id,
       original_start_date, last_observation_source)
      values ('series@google.com', 'series@google.com', 'google', 'ical_uid', 'date:2026-09-17', 'series-id', '2026-09-17', 'google_calendar'),
             ('series@google.com', 'series@google.com', 'google', 'ical_uid', 'date:2026-09-18', 'series-id', '2026-09-18', 'google_calendar');
      update public.google_calendar_events set event_date = '2026-09-20' where id = 1;`);
    await assert.rejects(db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, uid_semantics, occurrence_id, last_observation_source)
      values ('series@google.com', 'series@google.com', 'google', 'ical_uid', 'date:2026-09-17', 'google_calendar')`), e => e.code === "23505");
    await assert.rejects(db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, last_observation_source, recurring_event_id, original_start_date)
      values ('another-id', 'another-id', 'google', 'google_calendar', 'series-id', '2026-09-17')`), e => e.code === "23505");
    await assert.rejects(db.exec(`update public.google_calendar_events set original_start_at = '2026-09-17T00:00:00Z' where id = 1`), e => e.code === "23514");
    assert.equal((await db.query("select count(*)::int as n from public.google_calendar_events")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("identity namespace cannot disagree between event and alias; unknown-calendar scope cannot be bypassed by calendar_id", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(`insert into public.google_calendar_events(canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('uid', 'uid', 'google', 'historical_bookings')`);
    await assert.rejects(db.exec(`insert into public.google_calendar_events(calendar_id, canonical_uid, original_uid, uid_kind, last_observation_source)
      values ('different-calendar', 'uid', 'uid', 'google', 'google_calendar')`), e => e.code === "23505");
    await assert.rejects(db.exec(`insert into public.google_calendar_event_aliases
      (event_id, identity_namespace, original_uid, canonical_uid, alias_type, reconciliation_method)
      values (1, 'other-scope', 'uid', 'uid', 'google_uid', 'identity')`), e => e.code === "23503");
  } finally { await db.close(); }
});

test("monthly exclusion follows classification, never the presence of an audit reason", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(`insert into public.google_calendar_events
      (canonical_uid, original_uid, uid_kind, last_observation_source, event_date, effective_total_guests,
       event_classification, exclusion_reason, gcal_event_status)
      values ('audit', 'audit', 'google', 'historical_bookings', '2026-09-17', 5, 'customer_event', 'audit_only', 'confirmed'),
             ('test', 'test', 'synthetic', 'historical_bookings', '2026-09-17', 9, 'test', 'explicit_test', 'cancelled'),
             ('null', 'null', 'google', 'historical_bookings', '2026-09-17', null, 'unclassified', null, 'unknown');`);
    const row = (await db.query("select * from public.google_calendar_events_monthly_control")).rows[0];
    assert.equal(Number(row.canonical_events), 3);
    assert.equal(Number(row.eligible_events), 2);
    assert.equal(Number(row.effective_presences), 5);
    for (const field of ["excluded_events", "cancelled_events", "null_attendance_events", "eligible_null_attendance_events", "unknown_status_events"]) assert.equal(Number(row[field]), 1);
    await assert.rejects(db.exec("update public.google_calendar_events set exclusion_reason = null where event_classification = 'test'"), e => e.code === "23514");
  } finally { await db.close(); }
});
