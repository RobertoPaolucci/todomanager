import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real TypeScript route/actions with only Next and database I/O
// replaced. No secrets, network, live database, or additional test dependency.
const routeFile = 'app/api/webhooks/prenotazioni/route.ts';
const auth = readFileSync(routeFile, 'utf8').match(/authHeader !== "([^"]+)"/)[1];
function harness(seed = []) {
  const tables = {
    bookings: structuredClone(seed),
    channels: [{ id: 1, name: 'Direct' }, { id: 3, name: 'GetYourGuide' }],
    experiences: [{ id: 1, bokun_id: '100', name: 'Tour', supplier_id: 1, business_unit_id: 2 }],
    experience_channel_prices: [1, 2, 3, 4, 5, 6].map(channel_id => ({
      id: channel_id, experience_id: 1, channel_id, your_unit_price: 20,
      public_unit_price: 30, supplier_adult_unit_cost: 10,
    })),
    import_logs: [], payment_reconciliation_imports: [],
  };
  let forcedInsertError = null;
  const db = { from(table) {
    let predicates = [], maximum = Infinity, sorting = null, operation = 'select', payload;
    const q = {
      select() { return q; },
      eq(k, v) { predicates.push(row => row[k] === v); return q; },
      in(k, values) { predicates.push(row => values.includes(row[k])); return q; },
      is(k, v) { predicates.push(row => (row[k] ?? null) === v); return q; },
      not(k, op, v) {
        assert.equal(op, 'is'); assert.equal(v, null);
        predicates.push(row => row[k] != null); return q;
      },
      order(k, options = {}) { sorting = [k, options.ascending !== false]; return q; },
      limit(n) { maximum = n; return q; },
      insert(data) { operation = 'insert'; payload = data; return q; },
      update(data) { operation = 'update'; payload = data; return q; },
      async single() { return execute(true); },
      async maybeSingle() { return execute(true); },
      then(ok, fail) { return Promise.resolve().then(() => execute(false)).then(ok, fail); },
    };
    function execute(single) {
      let rows = tables[table].filter(row => predicates.every(p => p(row)));
      if (sorting) rows.sort((a, b) => (a[sorting[0]] - b[sorting[0]]) * (sorting[1] ? 1 : -1));
      rows = rows.slice(0, maximum);
      if (operation === 'insert') {
        if (forcedInsertError && table === 'bookings') return { data: null, error: forcedInsertError };
        if (table === 'bookings' && tables.bookings.some(row =>
          payload.bokun_booking_reference
            ? row.bokun_booking_reference === payload.bokun_booking_reference
            : !row.bokun_booking_reference && row.booking_reference === payload.booking_reference
        )) return { data: null, error: { code: '23505', message: 'unique constraint' } };
        const row = { id: Math.max(0, ...tables[table].map(r => r.id)) + 1, ...structuredClone(payload) };
        tables[table].push(row); rows = [row];
      }
      if (operation === 'update') rows.forEach(row => Object.assign(row, structuredClone(payload)));
      if (single && rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
    }
    return q;
  } };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: path,
    });
    const requireMock = name => {
      if (name === '@/lib/supabase-server') return { supabaseServer: db };
      if (name === 'next/cache') return { revalidatePath() {} };
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name === '@/lib/bokun-booking-identity') return load(resolve('lib/bokun-booking-identity.ts'));
      throw new Error(`Unexpected dependency: ${name}`);
    };
    vm.runInNewContext(outputText, {
      exports: loadedModule.exports, module: loadedModule, require: requireMock,
      console: { log() {}, error() {} }, Date, Set, Map, Error,
    }, { filename: path });
    cache.set(path, loadedModule.exports);
    return loadedModule.exports;
  }
  const route = load(resolve(routeFile));
  return {
    tables, load,
    failInsert(error) { forcedInsertError = error; },
    async send(overrides = {}) {
      const response = await route.POST(new Request('http://localhost/api/webhooks/prenotazioni', {
        method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          bokun_id: '100', bokun_booking_reference: 'GET-101955189',
          externalBookingReference: 'GYGBLHFXQZ7B', status: 'CONFIRMED',
          customer_name: 'Test customer', booking_date: '2026-10-24',
          booking_time: '10:00', adults: 2, channel_id: 1, booking_source: 'Direct',
          ...overrides,
        }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('normal CONFIRMED retains external ref, stores Bókun identity and uses GYG prices', async () => {
  const h = harness();
  const result = await h.send();
  assert.equal(result.status, 200); assert.equal(result.body.action, 'created');
  const row = h.tables.bookings[0];
  assert.equal(row.booking_reference, 'GYGBLHFXQZ7B');
  assert.equal(row.bokun_booking_reference, 'GET-101955189');
  assert.equal(row.channel_id, 3); assert.equal(row.booking_source, 'GetYourGuide');
  assert.equal(row.total_customer, 60);
});

for (const event of [{ action: 'MODIFIED' }, { status: 'MODIFIED' }, { action: 'BOOKING_MODIFIED' }]) {
  test(`modification updates same Bókun row: ${JSON.stringify(event)}`, async () => {
    const h = harness(); await h.send();
    const result = await h.send({ ...event, booking_time: '11:00' });
    assert.equal(result.body.action, 'updated');
    assert.equal(h.tables.bookings.length, 1);
    assert.equal(h.tables.bookings[0].booking_time, '11:00');
  });
}

test('cancel, rebook, duplicate old cancellation only affect their own Bókun reference', async () => {
  const h = harness(); await h.send(); await h.send({ status: 'CANCELLED' });
  const old = structuredClone(h.tables.bookings[0]);
  const result = await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00', notes: 'Has been rebooked by GetYourGuide from GET-101955189' });
  assert.equal(result.body.action, 'created');
  assert.equal(h.tables.bookings.length, 2);
  await h.send({ status: 'CANCELLED' });
  assert.deepEqual(h.tables.bookings[0], old);
  assert.equal(h.tables.bookings[1].is_cancelled, false);
  assert.equal(h.tables.bookings[1].booking_time, '17:00');
  assert.equal(h.tables.bookings[0].booking_reference, h.tables.bookings[1].booking_reference);
});

test('late old cancellation after new booking does not cancel replacement', async () => {
  const h = harness(); await h.send();
  await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  await h.send({ action: 'BOOKING_ITEM_CANCELLED' });
  assert.equal(h.tables.bookings[0].is_cancelled, true);
  assert.equal(h.tables.bookings[1].is_cancelled, false);
});

test('cancellation with only cart ID preserves known GYG channel', async () => {
  const h = harness(); await h.send();
  const result = await h.send({ status: 'CANCELLED', externalBookingReference: '', channel_id: 1, booking_source: 'Direct' });
  assert.equal(result.status, 200);
  assert.equal(h.tables.bookings[0].is_cancelled, true);
  assert.equal(h.tables.bookings[0].booking_source, 'GetYourGuide');
  assert.equal(h.tables.bookings[0].channel_id, 3);
});

test('same event repeated is unchanged and creates no additional row', async () => {
  const h = harness(); await h.send();
  const result = await h.send();
  assert.equal(result.body.action, 'unchanged'); assert.equal(h.tables.bookings.length, 1);
});

test('external reference arriving later is preserved on the identified booking', async () => {
  const h = harness();
  await h.send({ externalBookingReference: '', channel_id: 3, booking_source: 'GetYourGuide' });
  assert.equal(h.tables.bookings[0].booking_reference, 'GET-101955189');
  await h.send();
  assert.equal(h.tables.bookings[0].booking_reference, 'GYGBLHFXQZ7B');
  assert.equal(h.tables.bookings.length, 1);
});

test('concurrent confirmations create exactly one row; conflict can be retried', async () => {
  const h = harness();
  const results = await Promise.all([h.send(), h.send()]);
  assert.equal(h.tables.bookings.length, 1);
  assert.ok(results.every(r => [200, 409].includes(r.status)));
  assert.equal((await h.send()).body.action, 'unchanged');
});

test('missing Bókun ID cannot update, cancel or insert using only GYG ref', async () => {
  const h = harness(); await h.send(); const before = structuredClone(h.tables.bookings);
  for (const status of ['CONFIRMED', 'MODIFIED', 'CANCELLED']) {
    assert.equal((await h.send({ bokun_booking_reference: '', status })).status, 409);
  }
  assert.deepEqual(h.tables.bookings, before);
});

test('legacy ambiguity requires explicit reconciliation without historical changes', async () => {
  const legacy = { id: 1999, booking_reference: 'GYGBLHFXQZ7B', is_cancelled: true, booking_time: '10:00', booking_source: 'Direct' };
  const h = harness([legacy]);
  const result = await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  assert.equal(result.status, 409); assert.match(result.body.error, /1999/);
  assert.deepEqual(h.tables.bookings, [legacy]);
});

test('unmatched cancellation or modification never uses another cart with same external ref', async () => {
  const h = harness(); await h.send();
  for (const status of ['CANCELLED', 'MODIFIED']) {
    const result = await h.send({ bokun_booking_reference: 'GET-999999', status });
    assert.equal(result.body.skipped, true);
  }
  assert.equal(h.tables.bookings.length, 1); assert.equal(h.tables.bookings[0].is_cancelled, false);
});

test('identity parser accepts explicit/cart aliases, rejects conflicts and product-only identity', () => {
  const h = harness(); const lib = h.load(resolve('lib/bokun-booking-identity.ts'));
  assert.equal(lib.getBokunBookingReference({ confirmationCode: 'GET-103074524' }), 'GET-103074524');
  assert.equal(lib.getBokunBookingReference({ 'Cart confirmation code': 'GET-103074524' }), 'GET-103074524');
  assert.equal(lib.getBokunBookingReference({ productConfirmationCode: 'TOD-T145243238', notes: 'from GET-101955189' }), '');
  assert.throws(() => lib.getBokunBookingReference({ bokun_booking_reference: 'TOD-T145243238' }));
  assert.throws(() => lib.getBokunBookingReference({ bokun_booking_reference: 'GET-1', confirmationCode: 'GET-2' }));
});

test('list history keeps rebooking separate, preserves legacy grouping', () => {
  const { getBookingHistoryIdentity: key } = harness().load(resolve('lib/bokun-booking-identity.ts'));
  const base = { id: 1, booking_reference: 'GYGBLHFXQZ7B' };
  assert.notEqual(key({ ...base, bokun_booking_reference: 'GET-101955189' }), key({ ...base, bokun_booking_reference: 'GET-103074524' }));
  assert.notEqual(key(base), key({ ...base, bokun_booking_reference: 'GET-101955189' }));
  assert.equal(key(base), key({ ...base, id: 2 }));
});

for (const [ref, channel, source] of [['VIA123', 2, 'Viator'], ['TOD123', 4, 'Todointheworld'], ['FREE123', 5, 'Freedome'], ['FMDQ123', 6, 'Fattoria Madonna della Querce']]) {
  test(`legacy channel mapping preserved: ${source}`, async () => {
    const h = harness();
    const result = await h.send({ bokun_booking_reference: '', externalBookingReference: ref, channel_id: channel, booking_source: source });
    assert.equal(result.status, 200); assert.equal(result.body.channel_id, channel);
    assert.equal(h.tables.bookings[0].booking_reference, ref);
  });
}

const csvRow = (cart, status = 'CONFIRMED', time = '17:00') => ({
  'Cart confirmation code': cart, 'Ext. booking ref': 'GYGBLHFXQZ7B',
  'Product confirmation code': 'TOD-T145243238', 'Product title': 'Tour',
  'Start date': `2026-10-24 ${time}`, 'Customer': 'Test customer',
  'Booking channel': 'Direct', Participants: 'Adults: 2', Status: status,
});

test('Bókun CSV imports both carts, identifies GYG and dedupes repeated rows', async () => {
  const h = harness(); const { importBokunBookings } = h.load(resolve('app/prenotazioni/import/actions.ts'));
  const rows = [csvRow('GET-101955189', 'CANCELLED', '10:00'), csvRow('GET-103074524')];
  const result = await importBokunBookings([...rows, ...rows], { Tour: 1 });
  assert.equal(result.imported, 2); assert.equal(result.skipped, 2); assert.equal(result.errors.length, 0);
  assert.equal(h.tables.bookings[0].is_cancelled, true); assert.equal(h.tables.bookings[1].is_cancelled, false);
  assert.ok(h.tables.bookings.every(row => row.channel_id === 3 && row.booking_source === 'GetYourGuide' && row.business_unit_id === 2));
});

test('CSV reports unrelated UNIQUE failure instead of silently treating new rebooking as duplicate', async () => {
  const h = harness(); h.failInsert({ code: '23505', message: 'legacy reference uniqueness still present' });
  const { importBokunBookings } = h.load(resolve('app/prenotazioni/import/actions.ts'));
  const result = await importBokunBookings([csvRow('GET-103074524')], { Tour: 1 });
  assert.equal(result.skipped, 0); assert.equal(result.errors.length, 1);
});

test('webhook exposes unrelated UNIQUE failure instead of claiming concurrent duplicate', async () => {
  const h = harness(); h.failInsert({ code: '23505', message: 'legacy reference uniqueness still present' });
  const result = await h.send();
  assert.equal(result.status, 500);
  assert.match(result.body.error, /legacy reference uniqueness/);
  assert.equal(result.body.retryable, undefined);
});

test('CSV refuses unresolved legacy GYG rows and Bókun GYG without cart ref', async () => {
  const h = harness([{ id: 1999, booking_reference: 'GYGBLHFXQZ7B' }]);
  const { importBokunBookings } = h.load(resolve('app/prenotazioni/import/actions.ts'));
  const result = await importBokunBookings([csvRow('GET-103074524'), csvRow('')], { Tour: 1 });
  assert.equal(result.imported, 0); assert.equal(result.errors.length, 2);
  assert.equal(h.tables.bookings.length, 1);
});

test('payment reconciliation using GYG pays only active identified booking', async () => {
  const h = harness(); await h.send(); await h.send({ status: 'CANCELLED' });
  await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  const result = await reconcilePayments([{ booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' }]);
  assert.equal(result.updated, 1);
  assert.notEqual(h.tables.bookings[0].customer_payment_status, 'paid');
  assert.equal(h.tables.bookings[1].customer_payment_status, 'paid');
});

test('payment reconciliation refuses two active carts with same GYG ref', async () => {
  const h = harness(); await h.send();
  await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  await assert.rejects(reconcilePayments([{ booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' }]), /Bókun attive/);
  assert.ok(h.tables.bookings.every(row => row.customer_payment_status !== 'paid'));
});
