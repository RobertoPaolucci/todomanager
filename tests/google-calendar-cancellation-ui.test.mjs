
import test from "node:test";
import * as bookingLink from "../lib/google-calendar-booking-link.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const tuscanModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync("lib/google-calendar-tuscan-escape.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: tuscanModule, exports: tuscanModule.exports });
const tuscan = tuscanModule.exports;

function harness({ reconciled = true, reopened = false, past = false, receiptsUnavailable = false } = {}) {
  const date = past ? "2025-01-01" : "2026-10-20";
  const stage = { id: 563, booking_date: date, booking_time: "12:00", booking_reference: "GCAL-test",
    customer_name: "Kimberly Shoup", adults: 2, children: 0, infants: 0, experience_id: 7, channel_id: 1,
    booking_source: "test", notes: "Cancellazione T144976349", gcal_uid: "test-event",
    original_title: "2 pranzo T144976349 Kimberly Shoup", import_status: "gcal_cancelled", import_origin: "make",
    imported_booking_id: 2051, gcal_updated_at: null, gcal_html_link: null,
    cancellation_reconciled: reconciled, cancellation_review_required: reopened,
    observed_google_status: "unknown", google_observation_verified: false,
    dashboard_acknowledged: false,
    cancellation_history: [{ state: "approved", actor: "Operatore test", reason: "Annullamento verificato",
      recorded_at: "2026-10-12T10:00:00Z" }] };
  const bookings = [2051,2322,2300].map(id=>({ id,booking_reference:id===2051?"TOD-T144976349":`OTHER-${id}`,
    booking_date:date,booking_time:"12:00",experience_id:7,channel_id:1,adults:2,children:0,infants:0,
    customer_name:id===2300?"Francesco":"Kimberly Shoup",experience_name:"Pranzo",booking_source:"test",
    notes:null,business_unit_id:1,is_cancelled:id===2051 }));
  const tables = { google_calendar_import_review:[stage], google_calendar_dashboard_alerts:[stage], bookings,
    google_calendar_operational_events:[{id:9000,event_date:date,effective_total_guests:4}],
    business_units:[{id:1,name:"FMDQ"}], experiences:[{id:7,name:"Pranzo"}], channels:[{id:1,name:"test"}] };
  const calls=[];
  const db={from(table) {
    calls.push(table); assert.ok(table in tables,`Unexpected table ${table}`);
    const filters=[]; let start=0,end=Infinity;
    const q={select:()=>q,returns:()=>q,order:()=>q,eq:(key,value)=>{filters.push(r=>r[key]===value);return q;},
      in:(key,values)=>{filters.push(r=>values.includes(r[key]));return q;},
      gte:(key,value)=>{filters.push(r=>r[key]>=value);return q;},
      lt:(key,value)=>{filters.push(r=>r[key]<value);return q;},
      neq:(key,value)=>{filters.push(r=>r[key]!==value);return q;},not:()=>q,
      range:(a,b)=>{start=a;end=b+1;return q;},limit:n=>{end=n;return q;},
      or:expression=>{const cutoff=expression.match(/booking_date.gte.([\d-]+)/)?.[1];
        filters.push(r=>r.cancellation_review_required || r.booking_date>=cutoff);return q;},
      then:(ok,fail)=>Promise.resolve(table==='google_calendar_dashboard_alerts' && receiptsUnavailable
        ? {data:null,error:{message:'Receipt view unavailable'}}
        : {data:tables[table].filter(r=>filters.every(f=>f(r))).slice(start,end),error:null}).then(ok,fail)};
    return q;
  }};
  function load(file) {
    const mod={exports:{}};
    const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(code,{module:mod,exports:mod.exports,Date,URLSearchParams,console,
      require(name) {
        if(name==="@/lib/google-calendar-booking-link.mjs") return bookingLink;
        if(name==="react/jsx-runtime") return jsx;
        if(name==="next/link") return {default:({children,href})=>jsx.jsx("a",{href,children})};
        if(name==="@/lib/supabase-server") return {supabaseServer:db};
        if(name==="@/lib/google-calendar-tuscan-escape") return tuscan;
        if(name==="@/lib/dashboard-agenda") return {buildDashboardAgenda:()=>[]};
        if(name==="@/lib/dashboard") return {getDashboardStats:async()=>({bookingsByChannel:[],channelStartDate:null})};
        if(name==="@/lib/bokun-booking-identity") return {getBookingHistoryIdentity:row=>String(row.id)};
        if(name.includes("actions")) return new Proxy({},{get:()=>async()=>{throw Error("No action execution in UI test");}});
        if(name.startsWith("@/components/")) return {default:({children})=>jsx.jsx("div",{children})};
        throw Error(`Unexpected import ${name}`);
      }});
    return mod.exports.default;
  }
  return {stage,calls,tables,render:async file=>renderToStaticMarkup(await load(file)({searchParams:Promise.resolve({date})}))};
}

test("day history shows reconciled cancellation, real Google uncertainty and distinct active 2322/Francesco",async()=>{
  const h=harness(); const html=await h.render("app/import/google-calendar/page.tsx");
  assert.match(html,/Cancellazione riconciliata/);
  assert.match(html,/unknown.*osservazione non verificata/);
  assert.match(html,/Operatore test/);
  assert.match(html,/prenotazioni\/2051\/modifica/);
  assert.match(html,/prenotazioni\/2322\/modifica/);
  assert.match(html,/prenotazioni\/2300\/modifica/);
  assert.match(html,/disabled=""[^>]*>Ignora/);
  assert.match(html,/disabled=""[^>]*>Rimetti da importare/);
  assert.equal(h.stage.import_status,"gcal_cancelled");
});

test("dashboard closes only approved alert and reads the operational presence view",async()=>{
  const h=harness(); const html=await h.render("app/page.tsx");
  assert.match(html,/0 da controllare/);
  assert.ok(h.calls.includes("google_calendar_operational_events"));
  assert.ok(!h.calls.includes("google_calendar_events"));
});

test("reopened legacy cancellation stays visible even with a past date and matching active customer",async()=>{
  const h=harness({reconciled:false,reopened:true,past:true});
  const dashboard=await h.render("app/page.tsx");
  assert.match(dashboard,/1 da controllare/);
  assert.match(dashboard,/Da verificare/);
  const history=await h.render("app/import/google-calendar/page.tsx");
  assert.match(history,/Riconciliazione da rivedere/);
  assert.match(history,/Operatore test/);
});

test('Dashboard filters only acknowledged versions and updates both counters; refreshed reads remain filtered',async()=>{
  const h=harness({reconciled:false,reopened:true});
  h.tables.google_calendar_dashboard_alerts.push({...h.stage,id:625,original_title:'2 tour a piedi 1446709553 Jan',notes:'Jan',
    imported_booking_id:2152,dashboard_acknowledged:false});
  const before=await h.render('app/page.tsx');
  assert.match(before,/2 da controllare/);
  assert.match(before,/2 richiedono attenzione/);
  h.tables.google_calendar_dashboard_alerts[1].dashboard_acknowledged=true;
  for(let i=0;i<2;i++) {
    const after=await h.render('app/page.tsx');
    assert.match(after,/1 da controllare/);
    assert.match(after,/1 richiedono attenzione/);
    assert.doesNotMatch(after,/>Jan</);
    assert.match(after,/T144976349/); // Kimberly review stays independent.
  }
});

test('missing migration/load error falls back to existing alerts with visible warning',async()=>{
  const h=harness({reconciled:false,reopened:true,receiptsUnavailable:true});
  const html=await h.render('app/page.tsx');
  assert.match(html,/1 da controllare/);
  assert.match(html,/Presa visione temporaneamente non disponibile/);
  assert.match(html,/T144976349/);
});
