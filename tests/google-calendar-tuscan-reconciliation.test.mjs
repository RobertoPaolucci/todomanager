import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { planTuscanBookingReconciliation as plan, reconcileTuscanBooking } from "../lib/google-calendar-tuscan-reconciliation.mjs";
import { planGoogleCalendarObservation } from "../lib/google-calendar-canonical-plan.mjs";
import { normalizeGoogleCalendarObservation } from "../lib/google-calendar-observation.mjs";
import { parseGoogleCalendarAttendance } from "../lib/google-calendar-attendance.mjs";
import { prepareTuscanOctoberTargets, renderTuscanOctoberSql } from "../scripts/prepare-tuscan-october-correction.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/tuscan-october-2026-readonly.json", import.meta.url)));
const google = JSON.parse(readFileSync(new URL("./fixtures/tuscan-october-2026-google.json", import.meta.url)));
const code = ts.transpileModule(readFileSync("lib/booking-pricing.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pricing = { exports: {} };
vm.runInNewContext(code, { module: pricing, exports: pricing.exports });
const rateForAttendance = attendance => pricing.exports.effectiveFmdqInvoiceRates({ price: null, directFmdq: true,
  isGroupPricing: false, adult: 38, child: 16, channelId: 7, payingClients: attendance.effective_total_guests,
  guideEvidence: attendance }).adult;

export function scenario(total = 6) {
  const booking = structuredClone(snapshot.bookings.find(row => row.id === 2142));
  const incoming = structuredClone(snapshot.google_calendar_import_staging.find(row => row.id === 615));
  incoming.original_title = incoming.notes = `${total} pranzo Tuscan escape`;
  incoming.adults = total - 1;
  const previous = { ...incoming, original_title: "Tuscan escape", notes: "Tuscan escape", adults: 1,
    experience_id: 22, import_status: "imported", gcal_updated_at: "2026-10-01T10:00:00Z" };
  const old = { ...structuredClone(snapshot.google_calendar_events.find(row => row.id === 1294)),
    ...parseGoogleCalendarAttendance("Tuscan escape"), original_title: "Tuscan escape", gcal_event_status: "confirmed",
    gcal_updated_at: previous.gcal_updated_at, gcal_observation_verified: true };
  const current = { ...old, ...parseGoogleCalendarAttendance(incoming), original_title: incoming.original_title,
    gcal_updated_at: incoming.gcal_updated_at };
  // Parser diagnostics are not persisted columns.
  for (const row of [old, current]) for (const field of ["excluded_staff", "activity", "review_reasons"]) delete row[field];
  return { previous, incoming, canonical: { previous: old, current }, booking, bookings: [booking], observations: [incoming],
    experience: snapshot.experiences[0], price: { your_unit_price: 38, public_unit_price: 0, supplier_adult_unit_cost: 38 },
    invoices: [], rateForAttendance };
}

test("verified block becomes lunch with included guide, paying pax and existing EUR36/38 tariff", () => {
  for (const [total, clients, rate] of [[6,5,38], [8,7,38], [9,8,36]]) {
    const input = scenario(total), before = structuredClone(input.booking);
    const result = plan(input);
    assert.equal(result.action, "safe_update");
    assert.deepEqual([result.values.adults, result.values.non_paying_adults, result.values.total_people,
      result.values.pax, result.values.experience_id], [clients,1,total,clients,7]);
    assert.equal(result.values.total_to_you, clients * rate);
    assert.equal(result.values.total_supplier_cost, clients * rate);
    assert.deepEqual(input.booking, before);
  }
});

test("replay is unchanged; a subsequent verified lunch change recalculates the same booking", () => {
  const input = scenario(9);
  Object.assign(input.booking, plan(input).values);
  input.canonical.previous = structuredClone(input.canonical.current);
  assert.equal(plan(input).action, "unchanged");
  input.incoming.original_title = input.incoming.notes = "6 pranzo Tuscan escape";
  input.incoming.gcal_updated_at = "2026-10-09T10:00:00Z";
  Object.assign(input.canonical.current, { ...parseGoogleCalendarAttendance(input.incoming),
    original_title: input.incoming.original_title, gcal_updated_at: input.incoming.gcal_updated_at });
  const changed = plan(input);
  assert.equal(changed.action, "safe_update");
  assert.equal(changed.values.total_to_you, 190);
});

test("manual, incongruent, paid, agreed, invoiced, cancelled and ambiguous identities never auto-update", () => {
  const mutations = [s => s.booking.was_modified = true, s => s.booking.adults = 2,
    s => s.booking.notes = "Manual note", s => s.booking.customer_payment_status = "paid",
    s => s.booking.agreed_unit_price = 30, s => s.booking.total_to_you = 10,
    s => s.booking.is_cancelled = true, s => s.canonical.current.gcal_event_status = "cancelled",
    s => s.canonical.previous.gcal_event_status = "cancelled", s => s.previous.import_status = "gcal_cancelled",
    s => s.canonical.current.attendance_parser_version += "+manual-review",
    s => s.canonical.previous.attendance_parser_version = "unknown-parser",
    s => s.invoices.push({ invoice_month: "2026-10-01" }),
    s => s.bookings.push({ ...s.booking, id: 999 }), s => s.observations.push({ ...s.incoming, id: 999 }),
    s => s.incoming.gcal_uid = "wrong", s => s.price.your_unit_price = 40,
    s => s.canonical.current.original_title = "9 pranzo Tuscan escape"];
  for (const mutate of mutations) {
    const s = scenario(); mutate(s);
    assert.equal(plan(s).action, "needs_review");
    assert.equal(plan(s).values, null);
  }
});

test("legacy canonical chronology stays blocked even with a newer authenticated payload", () => {
  const s = scenario(); s.canonical.previous.gcal_observation_verified = false;
  assert.deepEqual(plan(s).review_reasons, ["unverified_google_chronology"]);
  const observation = { gcal_uid: s.incoming.gcal_uid, original_title: s.incoming.original_title,
    event_date: s.incoming.booking_date, event_time: s.incoming.booking_time,
    google_observation: normalizeGoogleCalendarObservation({ event_id: s.incoming.gcal_uid,
      status: "confirmed", updated: s.incoming.gcal_updated_at }, { sourceVerified: true }) };
  const canonicalPlan = planGoogleCalendarObservation(observation, [s.canonical.previous]);
  assert.equal(canonicalPlan.eligible_for_sync, false);
  assert.ok(canonicalPlan.review_reasons.includes("unverified_google_chronology"));
});

test("blocks, other channels, and corrected September invoices are preserved", () => {
  const block = scenario(); block.incoming.original_title = "Tuscan escape";
  assert.equal(plan(block).values, null);
  const other = scenario(); other.incoming.channel_id = 6;
  assert.equal(plan(other).action, "not_applicable");
  const september = scenario(9); september.invoices.push({ invoice_month: "2026-09-01" });
  september.booking.booking_date = "2026-09-12";
  assert.equal(plan(september).action, "needs_review");
  assert.equal(september.booking.adults, 1);
});

test("missing RPC/read failure yields review; transaction receives exact snapshots and no inserts", async () => {
  const s = scenario();
  const tables = { bookings: s.bookings, google_calendar_import_staging: s.observations,
    experiences: [s.experience], experience_channel_prices: [{ ...s.price, id: 1, experience_id: 7, channel_id: 7 }],
    fmdq_monthly_invoices: [] };
  let requests = 0;
  const db = { from(table) { let last = 0; const q = { select: () => q, gt: (_,id) => { last=id; return q; },
    order: () => q, limit: () => q, then: resolve => resolve({ data: tables[table].filter(row => row.id > last), error: null }) }; return q; },
    async rpc(name, args) { requests++; assert.equal(name,"reconcile_tuscan_google_booking");
      assert.deepEqual(args.expected_booking,s.booking); assert.deepEqual(args.expected_canonical,s.canonical.current);
      return { data: null, error: { code: "PGRST202" } }; } };
  assert.equal((await reconcileTuscanBooking(db,s)).action,"needs_review");
  assert.equal(requests,1);
  db.rpc = async () => ({ data:true, error:null });
  assert.equal((await reconcileTuscanBooking(db,s)).action,"updated");
  db.from = () => { throw Error("read failed"); };
  assert.equal((await reconcileTuscanBooking(db,s)).action,"needs_review");
});

test("October offline preparation targets exactly six, preserves money and verified canonical 1322", () => {
  const targets = prepareTuscanOctoberTargets(snapshot,google);
  assert.deepEqual(targets.map(t=>t.before.id),[2145,2144,2143,2142,2141,2190]);
  for (const t of targets) {
    for (const field of ["your_unit_price","supplier_unit_cost","total_to_you","total_supplier_cost",
      "public_unit_price","total_customer","total_amount","margin_total","agreed_unit_price"]) assert.equal(t.before[field],t.after[field]);
    assert.equal(t.after.was_modified,true);
    assert.equal(t.canonical_before.gcal_observation_verified,t.canonical_after.gcal_observation_verified);
    assert.equal(t.canonical_before.gcal_updated_at,t.canonical_after.gcal_updated_at);
  }
  const existing = targets.find(t=>t.before.id===2190);
  assert.deepEqual(existing.canonical_after,existing.canonical_before);
  assert.equal(
    renderTuscanOctoberSql(targets).replace(/\r\n/g, "\n"),
    readFileSync("supabase/migrations/202610090002_tuscan_escape_october_reviewed.sql","utf8").replace(/\r\n/g, "\n"),
  );
  const cancelled = structuredClone(google); cancelled.events[0].status="cancelled";
  assert.throws(()=>prepareTuscanOctoberTargets(snapshot,cancelled));
});

// Real PostgreSQL in isolated memory. No Supabase/client/env/network is used.
const engine = resolve(".tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js");
const PGlite = existsSync(engine) ? (await import(pathToFileURL(engine).href)).PGlite : null;
const sqlOptions = { skip: !PGlite && "Local isolated PGlite installation is unavailable" };
function columnType(table, key, value) {
  if (key === "booking_time") return table === "bookings" ? "text" : "time";
  if (["created_at","updated_at","cancelled_at","gcal_updated_at"].includes(key)) return "timestamptz";
  if (["booking_date","booking_created_at","invoice_month","invoice_date"].includes(key)) return "date";
  if (key === "id" || key.endsWith("_id")) return "bigint";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || key === "agreed_unit_price") return "numeric";
  return "text";
}
async function database() {
  const db = await PGlite.create();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const [table, example] of Object.entries({ bookings: snapshot.bookings[0],
    google_calendar_import_staging: snapshot.google_calendar_import_staging[0], experiences: snapshot.experiences[0],
    experience_channel_prices: { id: 1, experience_id:7, channel_id:7, your_unit_price:38, public_unit_price:0, supplier_adult_unit_cost:38 },
    fmdq_monthly_invoices: { id:1, channel_id:7, invoice_month:"2026-10-01", is_invoiced:true, invoice_date:"2026-10-09", invoice_number:"test" } })) {
    await db.exec(`create table public.${table} (${Object.entries(example).map(([key,value])=>
      `${key} ${columnType(table,key,value)}${key === "id" ? " primary key" : ""}`).join(",")});`);
  }
  await db.exec(readFileSync("supabase/migrations/202609170001_google_calendar_canonical_phase1.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609300001_google_calendar_verified_observation.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202610090001_tuscan_google_booking_reconciliation.sql","utf8"));
  return db;
}
async function insert(db, table, row) {
  await db.query(`insert into public.${table} overriding system value select * from jsonb_populate_record(null::public.${table},$1::jsonb)`,[JSON.stringify(row)]);
}
async function get(db, table, id) {
  return (await db.query(`select to_jsonb(row) as value from public.${table} row where id=$1`,[id])).rows[0]?.value;
}
async function call(db, s, values) {
  const args = [await get(db,"bookings",s.booking.id), await get(db,"google_calendar_import_staging",s.incoming.id),
    await get(db,"google_calendar_events",s.canonical.current.id), values];
  return { args, run: async () => (await db.query("select public.reconcile_tuscan_google_booking($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) as ok",args.map(JSON.stringify))).rows[0].ok };
}
async function seedScenario(db,s) {
  await insert(db,"bookings",s.booking);
  await insert(db,"google_calendar_import_staging",s.incoming);
  await insert(db,"google_calendar_events",s.canonical.current);
  await insert(db,"experiences",s.experience);
  await insert(db,"experience_channel_prices",{ id:1, experience_id:7, channel_id:7, ...s.price });
}

test("transaction SQL updates one existing booking, replays and rejects concurrent edits/invoices without partial writes",sqlOptions,async()=>{
  const db=await database(), s=scenario(9);
  try {
    await seedScenario(db,s);
    const values=plan(s).values;
    let tx=await call(db,s,values);
    // A manual edit made after the server snapshot defeats the transaction.
    await db.exec("update bookings set notes='manual' where id=2142");
    assert.equal(await tx.run(),false);
    assert.equal((await get(db,"bookings",2142)).adults,1);
    await db.exec("update bookings set notes='Tuscan escape' where id=2142");
    tx=await call(db,s,values);
    await db.exec("insert into fmdq_monthly_invoices(id,channel_id,invoice_month,is_invoiced) values(1,7,'2026-10-01',true)");
    assert.equal(await tx.run(),false);
    assert.equal((await get(db,"google_calendar_import_staging",615)).import_status,"needs_review");
    await db.exec("delete from fmdq_monthly_invoices");
    assert.equal(await tx.run(),true);
    const after=await get(db,"bookings",2142);
    assert.equal(after.adults,8); assert.equal(after.non_paying_adults,1); assert.equal(after.pax,8);
    assert.equal(after.total_to_you,288); assert.equal(after.experience_id,7);
    assert.equal((await get(db,"google_calendar_import_staging",615)).import_status,"imported");
    // Old snapshot fails; a fresh identical replay succeeds without touching money.
    assert.equal(await tx.run(),false);
    assert.equal(await (await call(db,s,values)).run(),true);
    assert.deepEqual(await get(db,"bookings",2142),after);
    assert.equal((await db.query("select count(*)::int as n from bookings")).rows[0].n,1);
    await db.exec("update google_calendar_events set gcal_event_status='cancelled' where id=1294");
    assert.equal(await (await call(db,s,values)).run(),false);
    assert.deepEqual(await get(db,"bookings",2142),after);
    const grants=await db.query("select has_function_privilege('anon','public.reconcile_tuscan_google_booking(jsonb,jsonb,jsonb,jsonb)','EXECUTE') as anon");
    assert.equal(grants.rows[0].anon,false);
  } finally { await db.close(); }
});

async function seedOctober(db) {
  for (const table of ["bookings","google_calendar_import_staging","google_calendar_events","google_calendar_event_aliases","experiences"])
    for (const row of snapshot[table]) await insert(db,table,row);
  for (const id of [2140,2138,2137,2292,2075,1417]) await insert(db,"bookings",{
    ...snapshot.bookings[0],id,booking_reference:`untouched-${id}`,notes:`untouched-${id}` });
}
const historicalSql=readFileSync("supabase/migrations/202610090002_tuscan_escape_october_reviewed.sql","utf8");
test("historical SQL corrects precisely six, preserves money/blocks/September/May and is idempotent",sqlOptions,async()=>{
  const db=await database();
  try {
    await seedOctober(db);
    const before=(await db.query("select to_jsonb(row) as value from bookings row order by id")).rows;
    const canonical1322=await get(db,"google_calendar_events",1322);
    await db.exec(historicalSql);
    const targets=prepareTuscanOctoberTargets(snapshot,google);
    for (const t of targets) {
      const actual=await get(db,"bookings",t.before.id);
      assert.equal(actual.adults,t.after.adults); assert.equal(actual.experience_id,7);
      assert.equal(actual.pax,t.after.adults); assert.equal(actual.total_to_you,0);
      assert.equal(actual.was_modified,true);
    }
    assert.deepEqual(await get(db,"google_calendar_events",1322),canonical1322);
    for (const id of [2140,2138,2137,2292,2075,1417]) assert.deepEqual(await get(db,"bookings",id),before.find(row=>row.value.id===id).value);
    const after=(await db.query("select to_jsonb(row) as value from bookings row order by id")).rows;
    await db.exec(historicalSql);
    assert.deepEqual((await db.query("select to_jsonb(row) as value from bookings row order by id")).rows,after);
  } finally { await db.close(); }
});

test("historical SQL aborts all six on manual edits, cancellations, duplicate references, invoice or partial repair",sqlOptions,async()=>{
  const db=await database();
  try {
    await seedOctober(db);
    const mutations=["update bookings set agreed_unit_price=30 where id=2142",
      "update bookings set is_cancelled=true where id=2142",
      "update google_calendar_events set gcal_event_status='cancelled' where id=1294",
      "update google_calendar_import_staging set original_title='7 pranzo Tuscan escape' where id=615",
      "update bookings set booking_reference=(select booking_reference from bookings where id=2142) where id=1417",
      "insert into fmdq_monthly_invoices(id,channel_id,invoice_month,is_invoiced) values(1,7,'2026-10-01',true)",
      "update bookings set adults=5 where id=2142"];
    for (const mutation of mutations) {
      await db.exec("begin"); await db.exec(mutation);
      // Run DO body inside our transaction; the original migration wraps the
      // exact same body in BEGIN/COMMIT when applied independently.
      const body=historicalSql.slice(historicalSql.indexOf("do $correction$"),historicalSql.lastIndexOf("commit;"));
      await assert.rejects(db.exec(body)); await db.exec("rollback");
      assert.equal((await get(db,"bookings",2145)).adults,1);
      assert.equal((await get(db,"google_calendar_events",1291)).event_classification,"operational_block");
    }
  } finally { await db.close(); }
});
