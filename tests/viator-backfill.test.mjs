import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseAuditCsv, exactCents, prepareCandidates, simulateBackfill } from '../lib/viator-backfill.mjs';
import { readCurrent } from '../scripts/prepare-viator-backfill.mjs';

function fixture() {
  const original = { id: 1, booking_reference: 'EXT1', bokun_booking_reference: null,
    business_unit_id: 2, channel_id: 2, experience_id: 14, experience_name: 'Quad', booking_date: '2026-09-14',
    adults: 2, children: 0, infants: 0, total_people: 2, total_to_you: 180, total_supplier_cost: 220,
    margin_total: -40, is_cancelled: false, cancelled_at: null };
  const auto = { todo_manager_id: '1', gruppo: 'AUTO_FIX', avvisi: '', motivi_review: '', esito: 'DIFFERISCE',
    valuta_bokun: 'EUR', stato_bokun: 'CONFIRMED', confirmationCode_bokun_trovato: 'VIA-123',
    booking_reference: 'EXT1', bokun_booking_reference_attuale: '', data_esperienza: '2026-09-14', esperienza: 'Quad',
    total_to_you_attuale: '180,00', totalPrice_bokun: '171,60', total_supplier_cost: '220,00',
    margine_attuale: '-40,00', margine_corretto: '-48,40', differenza_eur: '-8,40' };
  const experiences = [{ id: 14, bokun_id: '1074268' }];
  const snapshot = { rows: [original], experiences };
  const review = [{ todo_manager_id: '99' }];
  const prepared = prepareCandidates([auto], review, snapshot);
  const current = { bookings: [structuredClone(original)], experiences: structuredClone(experiences), capturedAt: '2026-09-20' };
  return { original, auto, review, snapshot, prepared, current };
}

test('CSV handles BOM, escaped quotes, embedded delimiters and newlines', () => {
  assert.deepEqual(parseAuditCsv('\uFEFF"id";"text"\r\n"1";"a;""b""\nc"'), [{ id: '1', text: 'a;"b"\nc' }]);
  assert.throws(() => parseAuditCsv('id;x\n1'));
  assert.throws(() => parseAuditCsv('id;x\n1;"unterminated'));
});

test('exact money comparison never rounds a changed amount into a PASS', () => {
  assert.equal(exactCents('180.0000'), 18000);
  assert.equal(exactCents('-48,40'), -4840);
  for (const invalid of [null, undefined, '', '180.0001', 'NaN', true, '1e2']) assert.throws(() => exactCents(invalid));
});

test('PASS prepares only the four authorized fields, using the preserved supplier cost', () => {
  const { prepared, current } = fixture();
  const before = structuredClone(current);
  const report = simulateBackfill(prepared, current);
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.bokunReferencesToPopulate, 1);
  assert.equal(report.summary.revenueDelta, -8.4);
  assert.deepEqual(report.rows[0].proposal, { total_to_you: 171.6, margin_total: -48.4,
    total_to_you_source: 'bokun_api_backfill', bokun_booking_reference: 'VIA-123' });
  assert.deepEqual(current, before);
});

for (const [field, value, reason] of [
  ['booking_reference', 'OTHER', 'BOOKING_REFERENCE_CHANGED'],
  ['total_to_you', 179, 'TOTAL_TO_YOU_CHANGED'],
  ['total_to_you', '180.0001', 'TOTAL_TO_YOU_INVALID'],
  ['is_cancelled', true, 'CANCELLED_OR_UNKNOWN_STATUS'],
  ['cancelled_at', '2026-09-20', 'CANCELLED_OR_UNKNOWN_STATUS'],
  ['total_supplier_cost', 200, 'TOTAL_SUPPLIER_COST_CHANGED'],
  ['margin_total', 0, 'MARGIN_TOTAL_CHANGED'],
  ['booking_date', '2026-09-15', 'BOOKING_DATE_CHANGED'],
  ['experience_id', 15, 'EXPERIENCE_ID_CHANGED'],
  ['adults', 3, 'ADULTS_CHANGED'],
  ['business_unit_id', 3, 'BUSINESS_UNIT_ID_CHANGED'],
  ['channel_id', 1, 'CHANNEL_ID_CHANGED'],
  ['bokun_booking_reference', 'VIA-999', 'BOKUN_REFERENCE_CONFLICT'],
  ['bokun_booking_reference', '', 'BOKUN_REFERENCE_CONFLICT'],
]) {
  test(`changed ${field} is SKIPPED, never proposed for update`, () => {
    const { prepared, current } = fixture(); current.bookings[0][field] = value;
    const report = simulateBackfill(prepared, current);
    assert.equal(report.summary.pass, 0); assert.equal(report.summary.skipped, 1);
    assert.ok(report.rows[0].reasons.includes(reason)); assert.equal(report.rows[0].proposal, null);
  });
}

test('missing ID and REVIEW membership cannot enter a proposed update', () => {
  const { prepared, current } = fixture(); current.bookings = []; prepared.reviewIds.push(1);
  assert.deepEqual(simulateBackfill(prepared, current).rows[0].reasons, ['REVIEW_EXCLUDED', 'ID_NOT_FOUND']);
});

test('current identical reference is preserved, and only NULL is populated', () => {
  const { prepared, current } = fixture(); current.bookings[0].bokun_booking_reference = 'VIA-123';
  const report = simulateBackfill(prepared, current);
  assert.equal(report.summary.pass, 1); assert.equal(report.summary.bokunReferencesToPopulate, 0);
  assert.equal(Object.hasOwn(report.rows[0].proposal, 'bokun_booking_reference'), false);
});

test('shared confirmation on a cancelled/REVIEW row or active external reference blocks the proposal', () => {
  for (const other of [
    { id: 99, bokun_booking_reference: 'VIA-123', is_cancelled: true },
    { id: 99, booking_reference: 'EXT1', channel_id: 2, is_cancelled: false },
  ]) {
    const { prepared, current } = fixture(); current.bookings.push(other);
    assert.ok(simulateBackfill(prepared, current).rows[0].reasons.includes('BOKUN_OR_EXTERNAL_REFERENCE_SHARED'));
  }
});

test('changed product mapping is SKIPPED', () => {
  const { prepared, current } = fixture(); current.experiences[0].bokun_id = 'OTHER';
  assert.ok(simulateBackfill(prepared, current).rows[0].reasons.includes('PRODUCT_MAPPING_CHANGED'));
});

test('already-correct rows are excluded even if they lack provenance and a Bokun reference', () => {
  const { auto, snapshot, review, current } = fixture();
  auto.totalPrice_bokun = '180,00'; auto.differenza_eur = '0,00'; auto.margine_corretto = '-40,00'; auto.esito = 'COINCIDE';
  const prepared = prepareCandidates([auto], review, snapshot);
  assert.equal(prepared.alreadyCorrect.length, 1); assert.equal(prepared.candidates.length, 0);
  assert.equal(simulateBackfill(prepared, current).summary.bokunReferencesToPopulate, 0);
});

test('input validation rejects overlap, duplicate IDs/codes, warnings and modified economics', () => {
  const { auto, snapshot, review } = fixture();
  assert.throws(() => prepareCandidates([auto], [{ todo_manager_id: '1' }], snapshot));
  assert.throws(() => prepareCandidates([auto, auto], review, snapshot));
  assert.throws(() => prepareCandidates([{ ...auto, avvisi: 'DATE_MISMATCH' }], review, snapshot));
  assert.throws(() => prepareCandidates([{ ...auto, total_to_you_attuale: '179,00' }], review, snapshot));
});

test('live capture exclusively uses GET, supports the not-yet-migrated schema, and checks stability', async () => {
  const { current } = fixture(); const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.pathname === '/rest/v1/') return Response.json({ definitions: { bookings: { properties: {} } } });
    return Response.json(url.pathname.endsWith('experiences') ? current.experiences : current.bookings);
  };
  const result = await readCurrent({ url: 'https://example.test', key: 'test-key', fetchImpl });
  assert.equal(result.sourceColumnPresent, false);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(c => c.options.method === 'GET' && !c.options.body));
  let bookingReads = 0;
  await assert.rejects(readCurrent({ url: 'https://example.test', key: 'test-key', fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('bookings') && ++bookingReads === 2) return Response.json([{ ...current.bookings[0], total_to_you: 1 }]);
    return fetchImpl(url, options);
  } }), /changed during capture/);
});

test('migration adds nullable constrained source without changing existing values', { skip: !process.env.PGLITE_TEST_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = await PGlite.create();
  try {
    await db.exec('create table bookings(id bigint primary key, total_to_you numeric); insert into bookings values(1, 180);');
    await db.exec(await readFile('supabase/migrations/202609200001_booking_total_source.sql', 'utf8'));
    assert.deepEqual((await db.query('select * from bookings')).rows, [{ id: 1, total_to_you: '180', total_to_you_source: null }]);
    for (const source of ['configured_price', 'bokun_webhook', 'bokun_api_backfill']) {
      await db.query('update bookings set total_to_you_source = $1 where id = 1', [source]);
    }
    await assert.rejects(db.exec("update bookings set total_to_you_source = 'invented'"), e => e.code === '23514');
    const meta = (await db.query("select is_nullable, column_default from information_schema.columns where table_name = 'bookings' and column_name = 'total_to_you_source'")).rows[0];
    assert.equal(meta.is_nullable, 'YES'); assert.equal(meta.column_default, null);
  } finally { await db.close(); }
});
