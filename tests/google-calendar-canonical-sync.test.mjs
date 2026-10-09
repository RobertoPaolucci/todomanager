import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as observation from "../lib/google-calendar-observation.mjs";
import * as canonicalSync from "../lib/google-calendar-canonical-sync.mjs";
import * as reconciliation from "../lib/google-calendar-tuscan-reconciliation.mjs";

const older = "2026-10-01T10:00:00.000Z";
const newer = "2026-10-02T10:00:00.000Z";
const plain = "569b4a1925014716a1262afe926cd13e";
const encoded = "_6kr3iohkc4ojichl60oj8dph6pgj2chm69gmcp9p68r66p1h6dig";
const attendanceFields = ["observed_total_guests", "effective_total_guests", "attendance_source",
  "attendance_quality", "attendance_parser_version", "event_classification", "exclusion_reason"];
const payload = (extra = {}) => ({ event_id: plain, title: "2 pranzo", status: "confirmed",
  updated: older, start: "2026-10-10T12:00:00+02:00", ...extra });
const clone = value => JSON.parse(JSON.stringify(value));

// Exercise the real route, normalizer and writer without network or credentials.
function harness() {
  const tables = {
    google_calendar_events: [], google_calendar_event_aliases: [], google_calendar_import_staging: [],
    channels: [{ id: 1, name: "Fattoria Madonna della Querce", type: null }],
    bookings: [], experiences: [], experience_channel_prices: [], fmdq_monthly_invoices: [],
  };
  const writes = [];
  const logs = [];
  const db = { beforeWrite: null, readError: null, from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    let operation = "select", values, limit = Infinity;
    const filters = [];
    const query = {
      select() { return query; },
      eq(field, value) { filters.push(row => row[field] === value); return query; },
      is(field, value) { filters.push(row => (row[field] ?? null) === value); return query; },
      gt(field, value) { filters.push(row => row[field] > value); return query; },
      order() { return query; }, limit(value) { limit = value; return query; },
      insert(value) { operation = "insert"; values = clone(value); return query; },
      update(value) { operation = "update"; values = clone(value); return query; },
      upsert(value) { operation = "upsert"; values = clone(value); return query; },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(ok, fail) { return Promise.resolve().then(() => run(false)).then(ok, fail); },
    };
    function run(single) {
      if (operation === "select") {
        if (db.readError && table === "google_calendar_events") return { data: null, error: db.readError };
        const rows = tables[table].filter(row => filters.every(filter => filter(row))).slice(0, limit);
        return { data: clone(single ? rows[0] ?? null : rows), error: null };
      }
      if (table === "google_calendar_events" && db.beforeWrite) {
        const callback = db.beforeWrite;
        db.beforeWrite = null;
        callback();
      }
      let affected = [];
      if (operation === "insert") {
        if (tables[table].some(row => row.identity_namespace === values.identity_namespace
          && row.canonical_uid === values.canonical_uid && row.occurrence_id === values.occurrence_id)) {
          return { data: null, error: { code: "23505" } };
        }
        const row = { id: tables[table].length + 1, ...values };
        tables[table].push(row);
        affected = [row];
      } else if (operation === "update") {
        affected = tables[table].filter(row => filters.every(filter => filter(row)));
        for (const row of affected) Object.assign(row, values);
      } else {
        let row = tables[table].find(row => row.gcal_uid === values.gcal_uid);
        if (row) Object.assign(row, values);
        else { row = { id: tables[table].length + 1, ...values }; tables[table].push(row); }
        affected = [row];
      }
      if (affected.length) writes.push({ table, operation, values });
      return { data: clone(affected), error: null };
    }
    return query;
  } };
  function load(file) {
    const mod = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, Date,
      console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
      process: { env: { GOOGLE_CALENDAR_WEBHOOK_SECRET: "test-secret",
        NEXT_PUBLIC_SUPABASE_URL: "test", SUPABASE_SERVICE_ROLE_KEY: "test" } },
      require(name) {
        if (name === "next/server") return { NextResponse: { json: Response.json } };
        if (name === "next/cache") return { revalidatePath() {} };
        if (name === "@supabase/supabase-js") return { createClient: () => db };
        if (name === "@/lib/google-calendar-observation.mjs") return observation;
        if (name === "@/lib/google-calendar-canonical-sync.mjs") return canonicalSync;
        if (name === "@/lib/google-calendar-tuscan-reconciliation.mjs") return reconciliation;
        if (name === "@/lib/booking-pricing") return load("lib/booking-pricing.ts");
        if (name === "@/lib/google-calendar-tuscan-escape") return load("lib/google-calendar-tuscan-escape.ts");
        throw new Error(`Unexpected import ${name}`);
      },
    });
    return mod.exports;
  }
  const route = load("app/api/webhooks/google-calendar/route.ts");
  return { db, tables, writes, logs,
    canonical: () => tables.google_calendar_events[0],
    canonicalWrites: () => writes.filter(write => write.table === "google_calendar_events"),
    send: (body, secret = "test-secret") => route.POST(new Request("http://local.test/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(body),
    })),
  };
}

test("new verified event writes canonical and verified marker only after authentication", async () => {
  const h = harness();
  assert.equal((await h.send(payload(), "wrong")).status, 401);
  assert.equal(h.writes.length, 0);
  assert.equal((await h.send(payload())).status, 200);
  assert.equal(h.canonical().canonical_uid, plain);
  assert.equal(h.canonical().uid_semantics, "event_id");
  assert.equal(h.canonical().gcal_event_status, "confirmed");
  assert.equal(h.canonical().gcal_updated_at, older);
  assert.equal(h.canonical().gcal_observation_verified, true);
  assert.equal(h.canonical().effective_total_guests, 2);
  assert.equal(h.tables.google_calendar_import_staging.length, 1);
  assert.ok(!Object.hasOwn(h.canonical(), "google_observation"));
  assert.ok(!JSON.stringify(h.canonical()).includes("test-secret"));
});

async function linkedTuscanHarness({ rpcAvailable = true } = {}) {
  const h = harness();
  await h.send(payload({ title: "Tuscan escape" }));
  const stage = h.tables.google_calendar_import_staging[0];
  Object.assign(stage, { import_status: "imported", imported_booking_id: 2142 });
  const fixture = JSON.parse(readFileSync("tests/fixtures/tuscan-october-2026-readonly.json", "utf8"));
  const booking = structuredClone(fixture.bookings.find(row => row.id === 2142));
  Object.assign(booking, { booking_date: stage.booking_date, booking_time: stage.booking_time,
    booking_reference: stage.booking_reference });
  h.tables.bookings.push(booking);
  h.tables.channels.push({ id: 7, name: "Tuscan Escape", type: null });
  h.tables.experiences.push(fixture.experiences[0]);
  h.tables.experience_channel_prices.push({ id: 1, experience_id: 7, channel_id: 7,
    your_unit_price: 38, public_unit_price: 0, supplier_adult_unit_cost: 38 });
  if (rpcAvailable) h.db.rpc = async (name, args) => {
    assert.equal(name, "reconcile_tuscan_google_booking");
    assert.deepEqual(args.expected_booking, booking);
    assert.deepEqual(args.expected_staging, stage);
    assert.deepEqual(args.expected_canonical, h.canonical());
    Object.assign(booking, args.proposed);
    stage.import_status = "imported";
    h.writes.push({ table: "bookings", operation: "rpc", values: args.proposed });
    return { data: true, error: null };
  };
  return { ...h, booking, stage };
}

test("linked Tuscan webhook updates existing booking, replays, follows later changes and routes cancellation to review", async () => {
  const h = await linkedTuscanHarness();
  const lunch = payload({ title: "9 pranzo Tuscan escape", updated: newer });
  const result = await (await h.send(lunch)).json();
  assert.equal(result.booking_reconciliation.action, "updated");
  assert.equal(result.import_status, "imported");
  assert.equal(h.booking.adults, 8); assert.equal(h.booking.non_paying_adults, 1);
  assert.equal(h.booking.total_to_you, 288); assert.equal(h.booking.experience_id, 7);
  assert.equal(h.canonical().event_classification, "customer_event");
  const replay = await (await h.send(lunch)).json();
  assert.equal(replay.booking_reconciliation.action, "unchanged");
  assert.equal(h.tables.bookings.length, 1);
  await h.send(payload({ title: "6 pranzo Tuscan escape", updated: "2026-10-03T10:00:00Z" }));
  assert.equal(h.booking.adults, 5); assert.equal(h.booking.total_to_you, 190);
  const before = clone(h.booking);
  await h.send({ event_id: plain, status: "cancelled", updated: "2026-10-04T10:00:00Z" });
  assert.equal(h.stage.import_status, "gcal_cancelled");
  assert.equal(h.canonical().gcal_event_status, "cancelled");
  assert.deepEqual(h.booking, before);
  await h.send(payload({ title: "6 pranzo Tuscan escape", updated: newer }));
  assert.deepEqual(h.booking, before);
});

test("linked Tuscan legacy chronology, manual edits and missing transaction stay in review with no booking writes", async () => {
  for (const kind of ["legacy", "manual", "no_rpc"]) {
    const h = await linkedTuscanHarness({ rpcAvailable: kind !== "no_rpc" });
    if (kind === "legacy") h.canonical().gcal_observation_verified = false;
    if (kind === "manual") h.booking.notes = "Manual approval";
    const before = clone(h.booking);
    const response = await (await h.send(payload({ title: "6 pranzo Tuscan escape", updated: newer }))).json();
    assert.equal(response.booking_reconciliation.action, "needs_review");
    assert.equal(h.stage.import_status, "needs_review");
    assert.deepEqual(h.booking, before);
    assert.equal(h.tables.bookings.length, 1);
    if (kind === "legacy") assert.equal(h.canonical().event_classification, "operational_block");
  }
});

test("identical replay, encoded identity, verified alias and concurrent insert are idempotent", async () => {
  const h = harness();
  await h.send(payload());
  const before = clone(h.canonical());
  await h.send(payload());
  await h.send(payload({ event_id: encoded }));
  h.tables.google_calendar_event_aliases.push({ id: 1, event_id: before.id,
    identity_namespace: "legacy_unscoped", occurrence_id: null,
    original_uid: "alternate", canonical_uid: plain, verified: true });
  await h.send(payload({ event_id: "alternate" }));
  assert.deepEqual(h.canonical(), before);
  assert.equal(h.canonicalWrites().length, 1);
  assert.equal(h.tables.google_calendar_events.length, 1);
  // Equal Google version with different content must stay a review conflict.
  await h.send(payload({ title: "5 pranzo" }));
  assert.deepEqual(h.canonical(), before);
  assert.ok(JSON.stringify(h.logs).includes("equal_timestamp_conflict"));

  const racing = harness();
  racing.db.beforeWrite = () => racing.tables.google_calendar_events.push(clone(before));
  await racing.send(payload());
  assert.equal(racing.tables.google_calendar_events.length, 1);
  assert.equal(racing.canonicalWrites().length, 0);
});

test("newer verified update and reactivation update the same identity, preserving history", async () => {
  const h = harness();
  await h.send(payload());
  Object.assign(h.canonical(), { historical_booking_id: 99, historical_total_guests: 7,
    historical_source: "google_calendar_ics", historical_snapshot_at: older });
  const id = h.canonical().id;
  await h.send(payload({ title: "4 pranzo", updated: newer, start: "2026-10-11T13:00:00+02:00" }));
  assert.equal(h.canonical().id, id);
  assert.equal(h.canonical().effective_total_guests, 4);
  assert.equal(h.canonical().event_date, "2026-10-11");
  assert.equal(h.canonical().historical_total_guests, 7);
  assert.ok(h.canonicalWrites().every(write => !Object.keys(write.values).some(key => key.startsWith("historical_"))));
  await h.send(payload({ status: "cancelled", updated: "2026-10-03T10:00:00Z" }));
  await h.send(payload({ title: "6 pranzo", updated: "2026-10-04T10:00:00Z" }));
  assert.equal(h.canonical().id, id);
  assert.equal(h.canonical().gcal_event_status, "confirmed");
  assert.equal(h.canonical().effective_total_guests, 6);
  assert.equal(h.tables.google_calendar_events.length, 1);
});

test("older verified update never overwrites, including a concurrent newer update", async () => {
  const h = harness();
  await h.send(payload({ updated: newer, title: "4 pranzo" }));
  const before = clone(h.canonical());
  await h.send(payload());
  assert.deepEqual(h.canonical(), before);
  assert.equal(h.canonicalWrites().length, 1);
  h.db.beforeWrite = () => Object.assign(h.canonical(), {
    gcal_updated_at: "2026-10-04T10:00:00.000Z", original_title: "8 pranzo",
    observed_total_guests: 8, effective_total_guests: 8,
  });
  await h.send(payload({ updated: "2026-10-03T10:00:00Z", title: "6 pranzo" }));
  assert.equal(h.canonical().effective_total_guests, 8);
  assert.equal(h.canonicalWrites().length, 1);
});

test("verified minimal cancellation preserves attendance, date and title", async () => {
  const h = harness();
  await h.send(payload());
  const before = clone(h.canonical());
  const cancellation = { event_id: plain, status: "cancelled", updated: newer };
  await h.send(cancellation);
  assert.equal(h.canonical().gcal_event_status, "cancelled");
  assert.equal(h.canonical().gcal_observation_verified, true);
  for (const field of [...attendanceFields, "event_date", "event_time", "original_title"]) {
    assert.equal(h.canonical()[field], before[field]);
  }
  assert.equal(h.tables.google_calendar_import_staging[0].import_status, "gcal_cancelled");
  const cancelled = clone(h.canonical());
  await h.send(cancellation);
  assert.deepEqual(h.canonical(), cancelled);
  assert.equal(h.canonicalWrites().length, 2);
});

test("missing/invalid status or updated never writes canonical, while staging continues", async () => {
  for (const invalid of [{ status: undefined }, { updated: undefined }, { status: "canceled" },
    { updated: "2026-10-01" }, { updated: "2026-02-30T10:00:00Z" }, { status: "unknown" },
    { event_id: undefined, uid: plain }, { id: "conflicting-id" }]) {
    const h = harness();
    await h.send(payload({ ...invalid, gcal_observation_verified: true,
      google_observation: { sourceVerified: true, googleStatus: "confirmed", googleUpdatedAt: newer } }));
    assert.equal(h.canonicalWrites().length, 0);
    if (invalid.status !== "canceled") assert.equal(h.tables.google_calendar_import_staging.length, 1);
  }
  const h = harness();
  h.db.readError = { code: "42703", message: "missing schema" };
  assert.equal((await h.send(payload())).status, 200);
  assert.equal(h.canonicalWrites().length, 0);
  assert.equal(h.tables.google_calendar_import_staging.length, 1);
  assert.ok(JSON.stringify(h.logs).includes("canonical sync failed"));
});

test("manual-review protects fields even when approved concurrently with the live update", async () => {
  for (const concurrent of [false, true]) {
    const h = harness();
    await h.send(payload());
    const protect = () => Object.assign(h.canonical(), {
      effective_total_guests: 9, attendance_parser_version: "farm-attendance-v1+manual-review",
      attendance_source: "historical", attendance_quality: "historical_reference",
      event_classification: "unclassified", exclusion_reason: "manual decision",
    });
    if (concurrent) h.db.beforeWrite = protect;
    else protect();
    await h.send(payload({ title: "4 pranzo", updated: newer }));
    assert.equal(h.canonical().observed_total_guests, 4);
    assert.equal(h.canonical().effective_total_guests, 9);
    assert.equal(h.canonical().attendance_parser_version, "farm-attendance-v1+manual-review");
    assert.equal(h.canonical().attendance_source, "historical");
    assert.equal(h.canonical().attendance_quality, "historical_reference");
    assert.equal(h.canonical().event_classification, "unclassified");
    assert.equal(h.canonical().exclusion_reason, "manual decision");
    assert.ok(JSON.stringify(h.logs).includes("manual_attendance_approval_required"));
  }
});
