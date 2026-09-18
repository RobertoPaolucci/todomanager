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
  let emptyUpdate = false;
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
      if (operation === 'update' && emptyUpdate) return { data: single ? null : [], error: null };
      let rows = tables[table].filter(row => predicates.every(p => p(row)));
      if (sorting) rows.sort((a, b) => (a[sorting[0]] - b[sorting[0]]) * (sorting[1] ? 1 : -1));
      rows = rows.slice(0, maximum);
      if (operation === 'insert') {
        if (forcedInsertError && table === 'bookings') return { data: null, error: forcedInsertError };
        if (table === 'bookings' && tables.bookings.some(row =>
          payload.bokun_booking_reference
            ? row.bokun_booking_reference === payload.bokun_booking_reference && row.business_unit_id === payload.business_unit_id
            : false
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
    returnEmptyUpdate() { emptyUpdate = true; },
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

const cancellationPayload = {
  bokun_id: '958091', bokun_booking_reference: '', externalBookingReference: '',
  confirmationCode: 'GET-98090108', productConfirmationCode: 'TOD-T138861035',
  productId: 958091, status: 'CANCELLED', action: 'BOOKING_ITEM_CANCELLED',
  booking_date: '2026-09-11', booking_time: '17:00', adults: 2,
  customer_name: 'Eva', channel_id: 1, booking_source: 'Direct',
};

function cancellationHarness() {
  const common = {
    business_unit_id: 2, experience_id: 1, experience_name: 'Horseback Riding',
    booking_date: '2026-09-11', booking_time: '17:00', adults: 2,
    children: 0, infants: 0, total_people: 2, is_cancelled: false,
    notes: 'Existing note',
  };
  const h = harness([
    { ...common, id: 1717, booking_reference: 'GYGG45NY7H58',
      bokun_booking_reference: 'GET-98090108', channel_id: 3, booking_source: 'GetYourGuide' },
    { ...common, id: 2100, booking_reference: 'EVA-DIRECT',
      bokun_booking_reference: null, channel_id: 1, booking_source: 'Direct', customer_name: 'Eva' },
  ]);
  h.tables.experiences[0].bokun_id = '958091';
  h.tables.experiences[0].name = 'Horseback Riding';
  return h;
}

test('GET-98090108 cancels only historical row 1717, never identical-slot Eva 2100; replay is idempotent', async () => {
  const h = cancellationHarness();
  const before = structuredClone(h.tables.bookings);
  const result = await h.send(cancellationPayload);
  assert.equal(result.status, 200);
  assert.equal(result.body.matched_booking_id, 1717);
  assert.equal(result.body.matched_bokun_booking_reference, 'GET-98090108');
  assert.equal(result.body.matching_method, 'bokun_booking_reference');
  assert.equal(result.body.updated_existing_booking, true);
  assert.equal(result.body.channel_id, 3);
  assert.equal(result.body.booking_source, 'GetYourGuide');
  assert.equal(h.tables.bookings[0].is_cancelled, true);
  assert.deepEqual(h.tables.bookings[1], before[1]);
  const { is_cancelled, notes, ...preserved } = h.tables.bookings[0];
  assert.equal(is_cancelled, true);
  assert.deepEqual({ ...preserved, is_cancelled: false, notes: before[0].notes }, before[0]);
  assert.ok(notes.includes('Existing note'));
  const after = structuredClone(h.tables.bookings);
  const replay = await h.send(cancellationPayload);
  assert.equal(replay.body.action, 'unchanged');
  assert.equal(replay.body.updated_existing_booking, false);
  assert.equal(replay.body.matched_booking_id, 1717);
  assert.deepEqual(h.tables.bookings, after);
});

for (const scenario of ['unknown', 'legacy without cart', 'duplicate', 'other unit', 'wrong experience']) {
  test(`strict cancellation refuses ${scenario} with 409 and no writes`, async () => {
    const h = cancellationHarness();
    const payload = { ...cancellationPayload };
    if (scenario === 'unknown') payload.confirmationCode = 'GET-99999999';
    if (scenario === 'legacy without cart') {
      h.tables.bookings[0].bokun_booking_reference = null;
      payload.externalBookingReference = 'GYGG45NY7H58';
    }
    if (scenario === 'duplicate') h.tables.bookings.push({ ...h.tables.bookings[0], id: 2200 });
    if (scenario === 'other unit') h.tables.bookings[0].business_unit_id = 3;
    if (scenario === 'wrong experience') h.tables.bookings[0].experience_id = 99;
    const before = structuredClone(h.tables.bookings);
    const result = await h.send(payload);
    assert.equal(result.status, 409);
    assert.equal(result.body.updated_existing_booking, false);
    assert.equal(result.body.reason, 'bokun_reconciliation_required');
    assert.deepEqual(h.tables.bookings, before);
  });
}

test('identified GYG channel and NULL external reference survive misleading Direct payload', async () => {
  const h = cancellationHarness();
  h.tables.bookings[0].booking_reference = null;
  const result = await h.send({ ...cancellationPayload, externalBookingReference: 'DIFFERENT' });
  assert.equal(result.status, 200);
  assert.equal(result.body.channel_id, 3);
  assert.equal(result.body.booking_source, 'GetYourGuide');
  assert.equal(h.tables.bookings[0].booking_reference, null);
});

test('UPDATE returning no row never reports updated_existing_booking=true', async () => {
  const h = cancellationHarness();
  h.returnEmptyUpdate();
  const before = structuredClone(h.tables.bookings);
  const result = await h.send(cancellationPayload);
  assert.equal(result.status, 409);
  assert.equal(result.body.success, false);
  assert.equal(result.body.updated_existing_booking, false);
  assert.equal(result.body.matched_booking_id, 1717);
  assert.deepEqual(h.tables.bookings, before);
});

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

const viatorPayload = {
  bokun_booking_reference: 'VIA-103724193', externalBookingReference: '1446865537',
  channel_id: 2, booking_source: 'Viator', booking_date: '2026-09-14', adults: 2,
};

function viatorHarness() {
  const h = harness();
  Object.assign(h.tables.experience_channel_prices.find(p => p.channel_id === 2), {
    your_unit_price: 90, public_unit_price: 110, supplier_adult_unit_cost: 110,
  });
  return h;
}

test('Viator uses source_total_price 171.6 as the whole booking total for two adults', async () => {
  const h = viatorHarness();
  const result = await h.send({ ...viatorPayload, source_total_price: 171.6 });
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'created');
  assert.equal(result.body.totals.total_to_you, 171.60);
  const row = h.tables.bookings[0];
  assert.equal(row.total_to_you, 171.60);
  assert.equal(row.total_supplier_cost, 220);
  assert.equal(row.total_customer, 220);
  assert.equal(row.your_unit_price, 90);
  assert.equal(row.margin_total, -48.40);
  assert.equal(row.booking_reference, '1446865537');
  assert.equal(row.bokun_booking_reference, 'VIA-103724193');
  const replay = await h.send({ ...viatorPayload, source_total_price: 171.6 });
  assert.equal(replay.body.action, 'unchanged');
  assert.equal(h.tables.bookings.length, 1);
});

for (const [label, value] of [
  ['missing', undefined], ['null', null], ['empty', ''], ['whitespace', '   '],
  ['negative', -1], ['invalid text', 'invalid'], ['infinity', 'Infinity'],
  ['NaN', 'NaN'], ['boolean', true], ['array', [171.6]], ['object', { amount: 171.6 }],
]) {
  test(`Viator falls back to configured prices when source_total_price is ${label}`, async () => {
    const h = viatorHarness();
    const result = await h.send({ ...viatorPayload, source_total_price: value });
    assert.equal(result.status, 200);
    assert.equal(result.body.totals.total_to_you, 180);
    assert.equal(h.tables.bookings[0].total_to_you, 180);
    assert.equal(h.tables.bookings[0].total_supplier_cost, 220);
    assert.equal(h.tables.bookings[0].margin_total, -40);
  });
}

for (const value of [0, '171.6']) {
  test(`Viator accepts source_total_price ${JSON.stringify(value)} without multiplying it`, async () => {
    const h = viatorHarness();
    const result = await h.send({ ...viatorPayload, source_total_price: value });
    assert.equal(result.status, 200);
    assert.equal(h.tables.bookings[0].total_to_you, Number(value));
    assert.equal(h.tables.bookings[0].total_supplier_cost, 220);
  });
}

for (const [channel_id, externalBookingReference] of [
  [3, 'GYGBLHFXQZ7B'], [1, 'DIRECT-TEST'], [4, 'TOD123'], [5, 'FREE123'], [6, 'FMDQ123'],
]) {
  test(`channel ${channel_id} ignores source_total_price and preserves configured economics`, async () => {
    const h = harness();
    const result = await h.send({ channel_id, externalBookingReference, source_total_price: 171.6 });
    assert.equal(result.status, 200);
    const row = h.tables.bookings[0];
    assert.equal(row.channel_id, channel_id);
    assert.equal(row.total_to_you, 40);
    assert.equal(row.total_supplier_cost, 20);
    assert.equal(row.margin_total, 20);
  });
}

test('Viator MODIFIED updates only the identified booking with the new source total and margin', async () => {
  const h = viatorHarness();
  await h.send(viatorPayload);
  await h.send({ ...viatorPayload, bokun_booking_reference: 'VIA-OTHER', externalBookingReference: 'OTHER-VIATOR' });
  const otherBefore = structuredClone(h.tables.bookings[1]);
  const result = await h.send({ ...viatorPayload, status: 'MODIFIED', source_total_price: 171.6 });
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'updated');
  assert.ok(result.body.changed_fields.includes('total_to_you'));
  assert.ok(result.body.changed_fields.includes('margin_total'));
  assert.equal(h.tables.bookings.length, 2);
  assert.equal(h.tables.bookings[0].total_to_you, 171.60);
  assert.equal(h.tables.bookings[0].total_supplier_cost, 220);
  assert.equal(h.tables.bookings[0].margin_total, -48.40);
  assert.deepEqual(h.tables.bookings[1], otherBefore);
  const second = await h.send({ ...viatorPayload, action: 'BOOKING_MODIFIED', source_total_price: 160 });
  assert.equal(second.body.action, 'updated');
  assert.equal(h.tables.bookings[0].total_to_you, 160);
  assert.equal(h.tables.bookings[0].margin_total, -60);
});

test('Viator cancellation ignores source_total_price and preserves stored economics', async () => {
  const h = viatorHarness();
  await h.send({ ...viatorPayload, source_total_price: 171.6 });
  const before = structuredClone(h.tables.bookings[0]);
  const result = await h.send({ ...viatorPayload, status: 'CANCELLED', source_total_price: 0 });
  assert.equal(result.status, 200);
  assert.equal(h.tables.bookings[0].is_cancelled, true);
  const { is_cancelled, notes, ...preserved } = h.tables.bookings[0];
  assert.equal(is_cancelled, true);
  assert.match(notes, /Prenotazione cancellata/);
  assert.deepEqual({ ...preserved, is_cancelled: before.is_cancelled, notes: before.notes }, before);
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
  assert.equal(h.tables.bookings[0].booking_reference, null);
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
  const legacy = { id: 1999, business_unit_id: 2, booking_reference: 'GYGBLHFXQZ7B', is_cancelled: true, booking_time: '10:00', booking_source: 'Direct' };
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
  const base = { id: 1, business_unit_id: 2, booking_reference: 'GYGBLHFXQZ7B' };
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
  const h = harness([{ id: 1999, business_unit_id: 2, booking_reference: 'GYGBLHFXQZ7B' }]);
  const { importBokunBookings } = h.load(resolve('app/prenotazioni/import/actions.ts'));
  const result = await importBokunBookings([csvRow('GET-103074524'), csvRow('')], { Tour: 1 });
  assert.equal(result.imported, 0); assert.equal(result.errors.length, 2);
  assert.equal(h.tables.bookings.length, 1);
});

test('payment reconciliation using composite identity pays only selected active booking', async () => {
  const h = harness(); await h.send(); await h.send({ status: 'CANCELLED' });
  await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  const result = await reconcilePayments([{ business_unit_id: 2, bokun_booking_reference: 'GET-103074524', booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' }]);
  assert.equal(result.updated, 1);
  assert.notEqual(h.tables.bookings[0].customer_payment_status, 'paid');
  assert.equal(h.tables.bookings[1].customer_payment_status, 'paid');
});

test('payment reconciliation refuses two active carts with same GYG ref', async () => {
  const h = harness(); await h.send();
  await h.send({ bokun_booking_reference: 'GET-103074524', booking_time: '17:00' });
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  await assert.rejects(reconcilePayments([{ booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' }]), /business_unit_id/);
  assert.ok(h.tables.bookings.every(row => row.customer_payment_status !== 'paid'));
});

function secondUnit(h) {
  h.tables.experiences.push({ ...h.tables.experiences[0], id: 2, bokun_id: '200', business_unit_id: 3 });
  h.tables.experience_channel_prices.push(...h.tables.experience_channel_prices.map(p => ({ ...p, id: p.id + 10, experience_id: 2 })));
}

test('same Bokun ref in different units: create, modify, cancel and retry are isolated', async () => {
  const h = harness(); secondUnit(h);
  await h.send(); await h.send({ bokun_id: '200' });
  assert.equal(h.tables.bookings.length, 2);
  const first = structuredClone(h.tables.bookings[0]);
  await h.send({ bokun_id: '200', status: 'MODIFIED', booking_time: '17:00' });
  await h.send({ bokun_id: '200', status: 'CANCELLED', booking_time: '17:00' });
  await h.send({ bokun_id: '200', status: 'CANCELLED', booking_time: '17:00' });
  assert.deepEqual(h.tables.bookings[0], first);
  assert.equal(h.tables.bookings[1].is_cancelled, true);
  assert.equal(h.tables.bookings[1].booking_time, '17:00');
  assert.equal(h.tables.bookings.length, 2);
});

test('missing business unit refuses every Bokun event without modifying other units', async () => {
  const h = harness(); await h.send(); const before = structuredClone(h.tables.bookings);
  h.tables.experiences[0].business_unit_id = null;
  for (const status of ['CONFIRMED', 'MODIFIED', 'CANCELLED']) {
    assert.notEqual((await h.send({ status, business_unit_id: 2 })).status, 200);
  }
  assert.deepEqual(h.tables.bookings, before);
});

test('CSV dedupe uses both unit and Bokun ref and rejects missing unit', async () => {
  const h = harness(); secondUnit(h);
  const { importBokunBookings } = h.load(resolve('app/prenotazioni/import/actions.ts'));
  await importBokunBookings([csvRow('GET-101955189')], { Tour: 1 });
  assert.equal((await importBokunBookings([csvRow('GET-101955189')], { Tour: 2 })).imported, 1);
  assert.equal((await importBokunBookings([csvRow('GET-101955189')], { Tour: 2 })).skipped, 1);
  h.tables.experiences[1].business_unit_id = null;
  assert.equal((await importBokunBookings([csvRow('GET-999')], { Tour: 2 })).errors.length, 1);
  assert.equal(h.tables.bookings.length, 2);
});

test('history scopes identical cart refs and isolates unidentified business units', () => {
  const { getBookingHistoryIdentity: key } = harness().load(resolve('lib/bokun-booking-identity.ts'));
  const b = { id: 1, bokun_booking_reference: 'GET-1', business_unit_id: 2 };
  assert.notEqual(key(b), key({ ...b, business_unit_id: 3 }));
  assert.notEqual(key({ ...b, business_unit_id: null }), key({ ...b, id: 2, business_unit_id: null }));
});

test('payments require unit and cart even with one OTA candidate, and isolate accounts', async () => {
  const h = harness(); secondUnit(h); await h.send(); await h.send({ bokun_id: '200' });
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  const item = { booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' };
  await assert.rejects(reconcilePayments([item]), /business_unit_id/);
  await assert.rejects(reconcilePayments([{ ...item, bokun_booking_reference: 'GET-101955189' }]), /Business unit/);
  const result = await reconcilePayments([{ ...item, business_unit_id: 3, bokun_booking_reference: 'GET-101955189' }]);
  assert.equal(result.updated, 1);
  assert.notEqual(h.tables.bookings[0].customer_payment_status, 'paid');
  assert.equal(h.tables.bookings[1].customer_payment_status, 'paid');
});

test('OTA-only payment is rejected even for one active Bokun booking', async () => {
  const h = harness(); await h.send();
  const before = structuredClone(h.tables.bookings);
  const { reconcilePayments } = h.load(resolve('app/prenotazioni/riconciliazione/actions.ts'));
  await assert.rejects(reconcilePayments([{ booking_reference: 'GYGBLHFXQZ7B', booking_date: '2026-10-24' }]), /business_unit_id/);
  assert.deepEqual(h.tables.bookings, before);
});

test('unmatched events cannot select same cart in another unit or legacy NULL scope', async () => {
  const h = harness([{ id: 1999, business_unit_id: null, booking_reference: 'GYGBLHFXQZ7B' }]);
  secondUnit(h); await h.send();
  const before = structuredClone(h.tables.bookings);
  for (const status of ['MODIFIED', 'CANCELLED']) {
    assert.equal((await h.send({ bokun_id: '200', status })).status, 409);
  }
  assert.deepEqual(h.tables.bookings, before);
});
