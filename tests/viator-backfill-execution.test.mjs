import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedQuery, createRestClient, executePlan, verifyExecution } from '../scripts/execute-viator-backfill.mjs';

function fixture(count = 1) {
  const row = { id: 1, booking_reference: 'EXT1', bokun_booking_reference: null, business_unit_id: 2,
    channel_id: 2, experience_id: 14, experience_name: 'Quad', booking_date: '2026-09-14', booking_time: '10:00:00',
    adults: 2, children: 0, infants: 0, total_people: 2, pax: 2, non_paying_adults: 0,
    total_to_you: 180, total_supplier_cost: 220, margin_total: -40, is_cancelled: false,
    cancelled_at: null, total_to_you_source: null, updated_at: null, notes: 'Preserve me' };
  const bookings = Array.from({ length: count }, (_, i) => ({ ...row, id: i + 1, booking_reference: `EXT${i + 1}` }));
  const prepared = { candidates: bookings.map(b => ({ id: b.id, expected: structuredClone(b), confirmationCode: `VIA-${b.id}`,
    targetCents: 17160, productId: '123' })), reviewIds: [99], alreadyCorrect: [{ id: 98 }] };
  const initial = { bookings: [...bookings, { ...row, id: 99, booking_reference: 'REVIEW' }, { ...row, id: 98, booking_reference: 'CORRECT' }],
    experiences: [{ id: 14, bokun_id: '123' }] };
  const current = structuredClone(initial), writes = [], events = [];
  const client = {
    inspect: async c => ({ bookings: current.bookings.filter(b => b.id === c.id), experiences: current.experiences }),
    match: async b => current.bookings.filter(row => row.id === b.id),
    patch: async (before, proposal) => {
      writes.push({ before, proposal });
      const row = current.bookings.find(b => b.id === before.id); Object.assign(row, proposal);
      return [structuredClone(row)];
    },
  };
  const run = () => executePlan({ prepared, initial, client, journal: async e => events.push(e), delay: async () => {} });
  return { row, prepared, initial, current, writes, events, client, run };
}

test('conditional update includes identity, money, cancellation, NULL reference, row version and protected fields', () => {
  const { row } = fixture(); const query = guardedQuery(row);
  assert.equal(query.get('id'), 'eq.1');
  assert.equal(query.get('total_to_you'), 'eq.180');
  assert.equal(query.get('total_supplier_cost'), 'eq.220');
  assert.equal(query.get('bokun_booking_reference'), 'is.null');
  assert.equal(query.get('updated_at'), 'is.null');
  assert.equal(query.get('is_cancelled'), 'eq.false');
  assert.equal(query.get('booking_reference'), 'eq.EXT1');
  assert.equal(guardedQuery({ ...row, experience_name: 'Quad, "private" (2)' }).get('experience_name'), 'eq.Quad, "private" (2)');
  assert.equal(query.get('pax'), 'eq.2');
  assert.throws(() => guardedQuery({ ...row, id: undefined }));
  assert.throws(() => guardedQuery({ ...row, updated_at: undefined }));
});

test('REST adapter writes only allowed values with all guards and never retries a failed PATCH', async () => {
  const { row } = fixture(); const calls = [];
  const client = createRestClient({ url: 'https://example.test', key: 'test', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return Response.json([]);
  } });
  const proposal = { total_to_you: 171.6, margin_total: -48.4, total_to_you_source: 'bokun_api_backfill', bokun_booking_reference: 'VIA-1' };
  await client.match(row); await client.patch(row, proposal);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].url.searchParams.get('id'), 'eq.1');
  assert.equal(calls[1].options.headers.Prefer, 'return=representation');
  assert.deepEqual(JSON.parse(calls[1].options.body), proposal);
  assert.throws(() => client.patch(row, { ...proposal, total_supplier_cost: 0 }));
  assert.throws(() => client.patch({ ...row, bokun_booking_reference: 'VIA-1' }, proposal));
  let attempts = 0;
  const broken = createRestClient({ url: 'https://example.test', key: 'test', fetchImpl: async () => { attempts++; throw new Error('network'); } });
  await assert.rejects(broken.patch(row, proposal), { code: 'PATCH_OUTCOME_UNCERTAIN' });
  assert.equal(attempts, 1);
});

test('successful execution journals intent first and preserves excluded rows and supplier costs', async () => {
  const f = fixture(); const execution = await f.run();
  assert.equal(execution.stopped, null);
  assert.deepEqual(f.events.map(e => e.status), ['INTENT', 'UPDATED']);
  assert.equal(f.writes.length, 1);
  const result = verifyExecution({ prepared: f.prepared, before: f.initial, after: f.current, execution });
  assert.equal(result.updated, 1); assert.equal(result.skipped, 0);
  assert.equal(result.revenueDelta, -8.4); assert.equal(result.marginDelta, -8.4);
  assert.equal(result.bokunReferencesAdded, 1); assert.equal(result.backfillSourceCount, 1);
  assert.equal(result.reviewUnchanged, true); assert.equal(result.alreadyCorrectUnchanged, true);
  assert.equal(result.supplierCostsUnchanged, true); assert.deepEqual(result.issues, []);
});

test('fresh reference, price, cancellation, cost or mapping changes are SKIPPED without a write', async () => {
  for (const [field, value] of [['booking_reference', 'OTHER'], ['total_to_you', 179], ['is_cancelled', true],
    ['total_supplier_cost', 200], ['experience_id', 20], ['notes', 'Another user edited']]) {
    const f = fixture(); f.current.bookings[0][field] = value;
    const result = await f.run();
    assert.equal(result.outcomes[0].status, 'SKIPPED', field); assert.equal(f.writes.length, 0, field);
  }
});

test('initial REVIEW membership and already changed rows cannot be sent to PATCH', async () => {
  const f = fixture(); f.prepared.reviewIds.push(1);
  const result = await f.run();
  assert.ok(result.outcomes[0].reasons.includes('REVIEW_EXCLUDED')); assert.equal(f.writes.length, 0);
});

test('current shared confirmation, including a cancelled row, is SKIPPED', async () => {
  const f = fixture();
  f.client.inspect = async () => ({ bookings: [f.current.bookings[0], { id: 100, bokun_booking_reference: 'VIA-1', is_cancelled: true }], experiences: f.current.experiences });
  const result = await f.run();
  assert.ok(result.outcomes[0].reasons.includes('BOKUN_OR_EXTERNAL_REFERENCE_SHARED')); assert.equal(f.writes.length, 0);
});

test('a race failing conditional UPDATE is SKIPPED, without an automatic retry', async () => {
  const f = fixture(); let attempts = 0;
  f.client.patch = async () => { attempts++; return []; };
  const result = await f.run();
  assert.equal(attempts, 1); assert.equal(result.outcomes[0].status, 'SKIPPED');
  assert.ok(result.outcomes[0].reasons.includes('CONCURRENT_CHANGE_UPDATE_NOT_APPLIED'));
});

test('unknown write outcome stops the entire run and does not write later rows', async () => {
  const f = fixture(2); let attempts = 0;
  f.client.patch = async () => { attempts++; throw Object.assign(new Error(), { code: 'PATCH_OUTCOME_UNCERTAIN' }); };
  const result = await f.run();
  assert.equal(attempts, 1); assert.equal(result.stopped.updateOutcomeUncertain, true);
  assert.deepEqual(result.notAttempted, [1, 2]);
});

test('unexpected supplier-cost change in PATCH response stops without automatic correction', async () => {
  const f = fixture(2); const originalPatch = f.client.patch;
  f.client.patch = async (...args) => { const rows = await originalPatch(...args); rows[0].total_supplier_cost = 0; return rows; };
  const result = await f.run();
  assert.equal(result.stopped.reason, 'PATCH_VERIFICATION_FAILED');
  assert.equal(f.writes.length, 1); assert.equal(result.outcomes[0].status, 'UPDATED');
});

test('post-check detects changes to any REVIEW row even outside its financial fields', async () => {
  const f = fixture(); const execution = await f.run();
  f.current.bookings.find(b => b.id === 99).notes = 'Changed';
  const result = verifyExecution({ prepared: f.prepared, before: f.initial, after: f.current, execution });
  assert.equal(result.reviewUnchanged, false); assert.ok(result.issues.some(r => r.id === 99));
});
