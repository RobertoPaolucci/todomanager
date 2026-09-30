import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as observation from '../lib/google-calendar-observation.mjs';
import * as canonicalSync from '../lib/google-calendar-canonical-sync.mjs';

function harness(existing = null) {
  const writes = [];
  const db = { from(table) {
    let operation = 'select', payload;
    const q = {
      select() { return q; }, eq() { return q; }, in() { return q; },
      order() { return q; }, limit() { return q; },
      update(value) { operation = 'update'; payload = value; return q; },
      insert(value) { operation = 'insert'; payload = value; return q; },
      upsert(value) { operation = 'upsert'; payload = value; return q; },
      single() { return Promise.resolve(run(true)); },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(ok, fail) { return Promise.resolve(run(false)).then(ok, fail); },
    };
    function run(single) {
      if (operation !== 'select') {
        writes.push({ table, operation, payload });
        return { data: { id: 123 }, error: null };
      }
      const rows = {
        google_calendar_import_staging: existing ? [existing] : [],
        bookings: [], channels: [{ id: 7, name: 'Tuscan Escape' }],
        experiences: [{ id: 7, name: 'PRANZO', supplier_id: 3, supplier_unit_cost: 20, is_group_pricing: false }],
        experience_channel_prices: [{ your_unit_price: 40, public_unit_price: 50 }],
      }[table];
      assert.ok(rows, `Unexpected table ${table}`);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return q;
  } };
  function load(file) {
    const mod = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, Date, URLSearchParams,
      process: { env: { GOOGLE_CALENDAR_WEBHOOK_SECRET: 'test', NEXT_PUBLIC_SUPABASE_URL: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' } },
      require(name) {
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        if (name === 'next/cache') return { revalidatePath() {} };
        if (name === 'next/navigation') return { redirect() { throw new Error('redirect'); } };
        if (name === '@supabase/supabase-js') return { createClient: () => db };
        if (name === '@/lib/supabase-server') return { supabaseServer: db };
        if (name === '@/lib/google-calendar-tuscan-escape') return load('lib/google-calendar-tuscan-escape.ts');
        if (name === '@/lib/google-calendar-observation.mjs') return observation;
        if (name === '@/lib/google-calendar-canonical-sync.mjs') return canonicalSync;
        throw new Error(`Unexpected import ${name}`);
      },
    });
    return mod.exports;
  }
  return { load, writes };
}

const { isTuscanEscapeBlockRow, canRetryTuscanEscapeImport } = harness().load('lib/google-calendar-tuscan-escape.ts');

for (const title of ['Tuscan Escape', 'Tuscan Escape t', 'Tuscan Escape - Blocco data']) {
  test(`${title} is a block in both title and notes`, async () => {
    assert.equal(isTuscanEscapeBlockRow({ original_title: title }), true);
    assert.equal(isTuscanEscapeBlockRow({ notes: title }), true);
    const h = harness();
    const response = await h.load('app/api/webhooks/google-calendar/route.ts').POST(request(title));
    assert.equal(response.status, 200);
    const row = h.writes[0].payload;
    assert.equal(row.experience_id, 22);
    assert.equal(row.adults, 1);
    assert.equal(row.customer_name, 'Tuscan Escape');
  });
}

function request(title, extra = {}) {
  return new Request('http://local.test/webhook', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 'test' },
    body: JSON.stringify({ event_id: 'test-event', title, start: '2026-09-30T12:00:00+02:00', ...extra }),
  });
}

for (const total of [9, 7, 8, 12]) {
  test(`${total} pranzo Tuscan Escape follows normal webhook and import pricing`, async () => {
    const title = `${total} pranzo Tuscan Escape`;
    assert.equal(isTuscanEscapeBlockRow({ original_title: title, booking_source: 'Tuscan Escape', customer_name: 'Tuscan Escape', notes: 'Tuscan Escape' }), false);
    const h = harness();
    const response = await h.load('app/api/webhooks/google-calendar/route.ts').POST(request(title, { description: 'Tuscan Escape' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).non_paying_adults, 1);
    const row = h.writes[0].payload;
    assert.equal(row.adults, total - 1);
    assert.equal(row.experience_id, 7);
    assert.equal(row.channel_id, 7);
    assert.equal(row.booking_source, 'Tuscan Escape');
    assert.equal(row.customer_name, 'Tuscan');
    const importing = harness({ ...row, id: 1 });
    const form = new FormData();
    form.set('row_ids', '1');
    await assert.rejects(importing.load('app/import/google-calendar/actions.ts').importSelectedGoogleCalendarRows(form), /redirect/);
    const booking = importing.writes.find(w => w.table === 'bookings').payload;
    assert.equal(booking.experience_id, 7);
    assert.equal(booking.adults, total - 1);
    assert.equal(booking.non_paying_adults, 1);
    assert.equal(booking.total_people, total);
    assert.equal(booking.total_to_you, (total - 1) * 40);
  });
}

test('channel/customer alone never identify blocks; retry is limited to unlinked blocks', () => {
  assert.equal(isTuscanEscapeBlockRow({ booking_source: 'Tuscan Escape', customer_name: 'Tuscan Escape' }), false);
  assert.equal(isTuscanEscapeBlockRow({ original_title: '2 pranzo', notes: 'Tuscan Escape' }), false);
  const retry = { original_title: 'Tuscan Escape t', import_status: 'needs_review', imported_booking_id: null };
  assert.equal(canRetryTuscanEscapeImport(retry), true);
  assert.equal(canRetryTuscanEscapeImport({ ...retry, original_title: '9 pranzo Tuscan Escape', booking_source: 'Tuscan Escape' }), false);
  assert.equal(canRetryTuscanEscapeImport({ ...retry, imported_booking_id: 123 }), false);
  assert.equal(canRetryTuscanEscapeImport({ ...retry, import_status: 'gcal_cancelled' }), false);
});
