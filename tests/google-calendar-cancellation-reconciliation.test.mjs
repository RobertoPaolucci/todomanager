// Synthetic scenarios using the confirmed IDs/facts, NOT production snapshots.
// Real PostgreSQL semantics in local memory; no Supabase, env files or network.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { syncGoogleCalendarObservation } from "../lib/google-calendar-canonical-sync.mjs";
import { normalizeGoogleCalendarObservation } from "../lib/google-calendar-observation.mjs";

const engine = resolve(process.env.GCAL_TEST_PGLITE_MODULE || ".tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js");
const PGlite = existsSync(engine) ? (await import(pathToFileURL(engine).href)).PGlite : null;
const test = (name, run) => nodeTest(name, { skip: !PGlite && "Set GCAL_TEST_PGLITE_MODULE to isolated PGlite" }, run);
const migration = readFileSync("supabase/migrations/202610120001_google_calendar_cancellation_reconciliation.sql", "utf8");
const repair = readFileSync("scripts/sql/reconcile-kimberly-2051.sql", "utf8");
const rollback = readFileSync("scripts/sql/rollback-kimberly-2051.sql", "utf8");
const get = async (db, table, id) => (await db.query(`select to_jsonb(r) as row from public.${table} r where id=$1`, [id])).rows[0]?.row;

async function database() {
  const db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table bookings(id bigint primary key, booking_reference text, is_cancelled boolean,
      customer_name text, cancelled_at timestamptz, total_to_you numeric, notes text);
    create table google_calendar_import_staging(id bigint primary key, gcal_uid text,
      imported_booking_id bigint, import_status text, booking_reference text, original_title text,
      notes text, booking_date date, booking_time time, gcal_updated_at timestamptz);
    insert into bookings values (2051,'TOD-T144976349',true,'Kimberly Shoup','2026-09-01',0,'cancellation recorded'),
      (2322,'TOD-OTHER',false,'Kimberly Shoup',null,99,'distinct active booking'),
      (2300,'TOD-FRANCESCO',false,'Francesco',null,50,'protected'),(9000,'OTHER',true,'Other',null,0,'sentinel');
    insert into google_calendar_import_staging values
      (563,'synthetic-test-google-id',null,'gcal_cancelled','GCAL-test','2 pranzo T144976349 Kimberly Shoup',
        'legacy cancellation evidence','2026-10-20','12:00','2026-09-01');`);
  await db.exec(readFileSync("supabase/migrations/202609170001_google_calendar_canonical_phase1.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202609300001_google_calendar_verified_observation.sql", "utf8"));
  await db.exec(`insert into google_calendar_events(id,canonical_uid,original_uid,uid_kind,last_observation_source,
      event_date,event_time,original_title,effective_total_guests,historical_total_guests,gcal_updated_at)
    overriding system value values(1242,'synthetic-test-google-id','synthetic-test-google-id','google','historical_bookings',
      '2026-10-20','12:00','2 pranzo T144976349 Kimberly Shoup',2,3,'2026-09-01'),
      (9000,'unrelated','unrelated','google','historical_bookings','2026-10-20','13:00','4 pranzo',4,4,null);
    insert into google_calendar_event_aliases(id,event_id,original_uid,canonical_uid,alias_type,reconciliation_method,verified)
    overriding system value values
      (1579,1242,'synthetic-test-google-id','synthetic-test-google-id','google_uid','identity',true),
      (1580,1242,'synthetic-test-alias','synthetic-test-google-id','base32hex','manual_verified',true);`);
  await db.exec(migration);
  return db;
}
async function snapshot(db) {
  return { booking: await get(db,"bookings",2051), staging: await get(db,"google_calendar_import_staging",563),
    canonical: await get(db,"google_calendar_events",1242),
    aliases: (await db.query("select to_jsonb(a) as row from google_calendar_event_aliases a where event_id=1242 order by id")).rows.map(r=>r.row),
    protected_2300: await get(db,"bookings",2300), protected_2322: await get(db,"bookings",2322) };
}
const literal = value => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
function caseSql(s) {
  return repair.replace("null; -- REVIEWED_SNAPSHOT",`${literal(s)}; -- REVIEWED_SNAPSHOT`)
    .replace("null; -- REVIEWED_APPROVER","'test-approver'; -- REVIEWED_APPROVER")
    .replace(/rollback;\s*$/, "commit;"); // local memory ONLY
}
async function approve(db,s,id="test-decision") {
  return (await db.query("select approve_google_cancellation($1,'test-approver','reviewed cancellation',$2,$3,$4,$5) as result",
    [id,...[s.booking,s.staging,s.canonical,s.aliases].map(JSON.stringify)])).rows[0].result;
}
async function observe(db, extra={}) {
  return (await db.query("select observe_reconciled_google_cancellation(1242,$1) as history", [JSON.stringify({
    status:"cancelled",updated:"2026-10-02T10:00:00Z",...extra,
  })])).rows[0].history;
}
async function state(db) {
  return (await db.query("select * from google_calendar_cancellation_state where event_id=1242")).rows[0];
}

test("Kimberly SQL links only 563 to 2051, preserves all bookings/Google/history, changes counts and is idempotent", async()=>{
  const db=await database();
  try {
    const s=await snapshot(db);
    const bookings=(await db.query("select * from bookings order by id")).rows;
    const other=await get(db,"google_calendar_events",9000);
    const before=(await db.query("select * from google_calendar_events_monthly_control")).rows[0];
    assert.equal(before.effective_presences,6);
    await db.exec(caseSql(s));
    assert.deepEqual((await db.query("select * from bookings order by id")).rows,bookings);
    assert.deepEqual(await get(db,"google_calendar_events",9000),other);
    const after=await snapshot(db);
    assert.deepEqual(after.staging,{...s.staging,imported_booking_id:2051});
    assert.deepEqual({...after.canonical,cancellation_reconciliation_history:[]},s.canonical);
    assert.deepEqual(after.aliases,s.aliases);
    assert.equal((await state(db)).reconciled,true);
    const history=(await db.query("select * from google_calendar_import_review where id=563")).rows[0];
    assert.equal(history.import_status,"gcal_cancelled");
    assert.equal(history.cancellation_history.length,1);
    assert.equal((await db.query("select count(*)::int as n from google_calendar_import_review where not cancellation_reconciled")).rows[0].n,0);
    assert.deepEqual((await db.query("select id from google_calendar_operational_events order by id")).rows,[{id:9000}]);
    const counts=(await db.query("select * from google_calendar_events_monthly_control")).rows[0];
    assert.equal(counts.effective_presences,4); assert.equal(counts.canonical_events,2);
    assert.equal(counts.unknown_status_events,2); assert.equal(counts.cancelled_events,0);
    await db.exec(caseSql(s));
    assert.deepEqual(await snapshot(db),after);
    await db.exec(migration);
    assert.deepEqual(await snapshot(db),after);
  } finally { await db.close(); }
});

test("missing production snapshots block the prepared correction and rollback",async()=>{
  const db=await database();
  try {
    await assert.rejects(db.exec(repair),/BLOCKED/); await db.exec("rollback");
    await assert.rejects(db.exec(rollback),/BLOCKED/); await db.exec("rollback");
    assert.equal((await snapshot(db)).staging.imported_booking_id,null);
  } finally { await db.close(); }
});

test("snapshot races, wrong aliases, active 2322, duplicate references and name-only matches abort atomically",async()=>{
  const db=await database();
  try {
    const s=await snapshot(db);
    for (const mutation of ["update bookings set notes='concurrent' where id=2051",
      "update google_calendar_import_staging set notes='concurrent' where id=563",
      "update google_calendar_events set historical_total_guests=9 where id=1242",
      "update google_calendar_event_aliases set verified=false where id=1579",
      "update bookings set booking_reference='TOD-T144976349' where id=2322"]) {
      await db.exec("begin"); await db.exec(mutation);
      await assert.rejects(approve(db,s)); await db.exec("rollback");
      assert.equal((await snapshot(db)).staging.imported_booking_id,null);
    }
    await assert.rejects(approve(db,{...s,booking:s.protected_2322}));
    await db.exec("update google_calendar_import_staging set original_title='2 pranzo Kimberly Shoup', notes='Kimberly Shoup' where id=563");
    await assert.rejects(approve(db,await snapshot(db)),/identity/);
    await db.exec("update google_calendar_import_staging set booking_reference=null where id=563");
    await assert.rejects(approve(db,await snapshot(db)),/identity/);
    assert.equal((await state(db)).history.length,0);
  } finally { await db.close(); }
});

test("identical/minimal cancellation replay and later compatible cancellation keep review closed",async()=>{
  const db=await database();
  try {
    const s=await snapshot(db); await approve(db,s);
    const before=await snapshot(db);
    for (const extra of [{},{},{title:s.staging.original_title,date:s.staging.booking_date,time:"12:00"},
      {updated:"2027-01-01T00:00:00Z"}]) assert.equal((await observe(db,extra)).length,1);
    assert.deepEqual(await snapshot(db),before);
    assert.equal((await state(db)).reconciled,true);
  } finally { await db.close(); }
});

test("legacy chronology never hides incompatible Google observations, including timestamp ties; reopened replay is idempotent",async()=>{
  const db=await database();
  try {
    await approve(db,await snapshot(db));
    const canonical=await get(db,"google_calendar_events",1242);
    for (const extra of [{status:"confirmed",updated:"2026-08-01T00:00:00Z"},
      {status:"tentative",updated:canonical.gcal_updated_at},{title:"6 pranzo"},{date:"2026-11-01"},{time:"15:00"}]) {
      await db.exec("begin");
      const history=await observe(db,extra);
      assert.equal(history.length,2); assert.equal(history[1].state,"reopened");
      assert.deepEqual(await observe(db,extra),history);
      assert.equal((await state(db)).reconciled,false);
      assert.equal((await state(db)).operationally_excluded,true);
      const review=(await db.query("select * from google_calendar_import_review where id=563")).rows[0];
      assert.equal(review.cancellation_review_required,true);
      const after=await get(db,"google_calendar_events",1242);
      assert.deepEqual({...after,cancellation_reconciliation_history:canonical.cancellation_reconciliation_history},canonical);
      await db.exec("rollback");
    }
  } finally { await db.close(); }
});

test("future cancellations need their own approval; verified stale reactivations do not reopen",async()=>{
  const db=await database();
  try {
    await db.exec("update google_calendar_events set gcal_event_status='cancelled',gcal_observation_verified=true where id=1242");
    assert.equal((await state(db)).reconciled,false);
    await approve(db,await snapshot(db));
    assert.equal((await observe(db,{status:"confirmed",updated:"2026-08-01T00:00:00Z"})).length,1);
    assert.equal((await state(db)).reconciled,true);
    assert.equal((await observe(db,{status:"confirmed",updated:"2026-11-01T00:00:00Z"})).length,2);
  } finally { await db.close(); }
});

test("unknown attendance remains NULL; exclusion changes only eligible counters and a new decision retains earlier audit",async()=>{
  const db=await database();
  try {
    await db.exec("update google_calendar_events set effective_total_guests=null where id=1242");
    await approve(db,await snapshot(db));
    let counts=(await db.query("select * from google_calendar_events_monthly_control")).rows[0];
    assert.equal(counts.effective_presences,4); assert.equal(counts.null_attendance_events,1);
    assert.equal(counts.eligible_null_attendance_events,0);
    await observe(db,{title:"changed cancellation"});
    await db.exec("update google_calendar_import_staging set original_title='changed cancellation T144976349' where id=563");
    assert.equal(await approve(db,await snapshot(db),"new-reviewed-decision"),"approved");
    assert.equal((await state(db)).history.length,3);
    assert.equal((await state(db)).reconciled,true);
    counts=(await db.query("select * from google_calendar_events_monthly_control")).rows[0];
    assert.equal(counts.effective_presences,4);
    assert.equal((await snapshot(db)).canonical.effective_total_guests,null);
  } finally { await db.close(); }
});

test("Ignore/reset cannot erase the link; restored booking or changed staging reopens projection without recounting",async()=>{
  const db=await database();
  try {
    await approve(db,await snapshot(db));
    await assert.rejects(db.exec("update google_calendar_import_staging set import_status='ignored',imported_booking_id=null where id=563"),/rollback required/);
    await db.exec("update bookings set is_cancelled=false where id=2051");
    assert.equal((await state(db)).reconciled,false);
    assert.equal((await state(db)).operationally_excluded,true);
    await db.exec("update bookings set is_cancelled=true where id=2051; update google_calendar_import_staging set original_title='different cancellation' where id=563");
    assert.equal((await state(db)).reconciled,false);
    await assert.rejects(db.exec("update google_calendar_events set cancellation_reconciliation_history='[]' where id=1242"),/append-only|Invalid cancellation audit/);
    await assert.rejects(db.exec("delete from google_calendar_events where id=1242"),/Preserve cancellation audit/);
    await assert.rejects(db.exec("delete from google_calendar_import_staging where id=563"),/Preserve cancellation staging/);
  } finally { await db.close(); }
});

test("compensating rollback preserves audit/Google/bookings, restores counts and is repeatable; changed staging is protected",async()=>{
  const db=await database();
  try {
    const before=await snapshot(db); await approve(db,before);
    const s=await snapshot(db);
    const args=[s.canonical,s.staging].map(JSON.stringify);
    const run=()=>db.query("select revoke_google_cancellation($1,$2,'reviewer','rollback test') as result",args);
    await db.exec("update google_calendar_import_staging set notes='new evidence' where id=563");
    await assert.rejects(run(),/snapshot mismatch/);
    await db.query("update google_calendar_import_staging set notes=$1 where id=563",[s.staging.notes]);
    assert.equal((await run()).rows[0].result,"revoked");
    assert.equal((await run()).rows[0].result,"unchanged");
    const after=await snapshot(db);
    assert.deepEqual(after.staging,before.staging); assert.deepEqual(after.booking,before.booking);
    assert.equal(after.canonical.cancellation_reconciliation_history.length,2);
    assert.equal((await state(db)).operationally_excluded,false);
    assert.equal((await db.query("select effective_presences from google_calendar_events_monthly_control")).rows[0].effective_presences,6);
  } finally { await db.close(); }
});

test("review views and observer are server-only; approval/revoke are not callable by service-role webhook",async()=>{
  const db=await database();
  try {
    for (const role of ["anon","authenticated","service_role"]) {
      const r=(await db.query(`select has_function_privilege($1,'approve_google_cancellation(text,text,text,jsonb,jsonb,jsonb,jsonb)','execute') as approve,
        has_function_privilege($1,'observe_reconciled_google_cancellation(bigint,jsonb)','execute') as observe`,[role])).rows[0];
      assert.equal(r.approve,false); assert.equal(r.observe,role==="service_role");
    }
  } finally { await db.close(); }
});

test("live canonical writer invokes reconciliation before legacy chronology blocks canonical updates",async()=>{
  const db=await database();
  try {
    await approve(db,await snapshot(db));
    let writes=0;
    const client={ from(table) { let last=0; const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,
      gt:(_,id)=>{last=id;return q;},update:()=>{writes++;throw Error("unexpected canonical write");},
      then: (ok,fail)=>db.query(`select to_jsonb(r) as row from ${table} r where id>$1 order by id`,[last])
        .then(result=>({data:result.rows.map(r=>r.row),error:null})).then(ok,fail)};return q; },
      async rpc(name,args) { assert.equal(name,"observe_reconciled_google_cancellation");
        const result=await db.query("select observe_reconciled_google_cancellation($1,$2) as data",[args.event_id,JSON.stringify(args.observation)]);
        return {data:result.rows[0].data,error:null}; } };
    const incoming={gcal_uid:"synthetic-test-google-id",uid_semantics:"event_id",original_title:"2 pranzo",
      google_observation:normalizeGoogleCalendarObservation({event_id:"synthetic-test-google-id",status:"confirmed",updated:"2026-10-12T10:00:00Z"},{sourceVerified:true})};
    const result=await syncGoogleCalendarObservation(client,incoming);
    assert.equal(result.written,false); assert.equal(writes,0);
    assert.equal((await state(db)).decision_state,"reopened");
    assert.equal((await snapshot(db)).canonical.gcal_event_status,"unknown");
    await syncGoogleCalendarObservation(client,incoming);
    assert.equal((await state(db)).history.length,2);
  } finally { await db.close(); }
});


test("approval rejects unknown hooks impersonating either reviewed guard",async()=>{
  const db=await database();
  try {
    const s=await snapshot(db);
    for(const mutation of [
      "create function public.unreviewed() returns trigger language plpgsql as 'begin return new; end'; drop trigger guard_google_cancellation_history on google_calendar_events; create trigger guard_google_cancellation_history before update on google_calendar_events for each row execute function public.unreviewed()",
      "create function public.unreviewed() returns trigger language plpgsql as 'begin return new; end'; drop trigger guard_reconciled_google_staging on google_calendar_import_staging; create trigger guard_reconciled_google_staging before update on google_calendar_import_staging for each row execute function public.unreviewed()",
    ]) {
      await db.exec("begin"); await db.exec(mutation);
      await assert.rejects(approve(db,s),/Review UPDATE hooks/);
      await db.exec("rollback");
      assert.deepEqual(await snapshot(db),s);
    }
  } finally { await db.close(); }
});
