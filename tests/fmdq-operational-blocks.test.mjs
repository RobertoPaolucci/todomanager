import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pricingHarness, nodes, textContent } from './helpers/booking-pricing-harness.mjs';
import { prepareTuscanOctoberTargets } from '../scripts/prepare-tuscan-october-correction.mjs';

const snapshot = JSON.parse(readFileSync('tests/fixtures/tuscan-october-2026-readonly.json', 'utf8'));
const google = JSON.parse(readFileSync('tests/fixtures/tuscan-october-2026-google.json', 'utf8'));
const lunches = prepareTuscanOctoberTargets(snapshot, google).map(t => t.after);
// The confirmed blocks share the original placeholder shape of the six lunches.
const blocks = [[2140, 12], [2138, 17], [2137, 19], [2292, 20]].map(([id, day]) => ({
  ...snapshot.bookings[0], id, booking_date: `2026-10-${day}`,
  booking_reference: `GCAL-operational-block-${id}`, notes: 'Tuscan escape',
}));

function harness(rows) {
  const h = pricingHarness();
  Object.assign(h.channel, { id: 7, name: 'Tuscan Escape' });
  h.price.channel_id = 7;
  h.tables.experiences.push({ ...h.experience, id: 22, name: 'Tuscan Escape - Blocco data' });
  h.tables.experience_channel_prices.push({ ...h.price, id: 696, experience_id: 22 });
  h.tables.bookings = rows.map(b => ({ ...b, channels: h.channel, suppliers: h.booking.suppliers }));
  for (const table of ['google_calendar_import_staging', 'google_calendar_events', 'google_calendar_event_aliases']) {
    h.tables[table] = structuredClone(snapshot[table]);
  }
  return h;
}

async function verifyOutputs(h, total, adults) {
  const before = structuredClone(h.tables);
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({
    searchParams: Promise.resolve({ month: '2026-10' }),
  });
  const reports = nodes(page).filter(n => n.props?.totalInvoice !== undefined);
  assert.equal(reports.reduce((sum, n) => sum + n.props.totalInvoice, 0), total);
  assert.equal(reports.reduce((sum, n) => sum + n.props.totalAdults, 0), adults);
  const money = total.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const route of ['pdf', 'pdf-riepilogo']) {
    h.pdfTexts.length = 0;
    const response = await h.load(`app/fatturazione-fmdq/${route}/route.ts`).GET(
      new Request('http://local.test/pdf?month=2026-10'));
    assert.equal(response.status, 200);
    assert.ok(h.pdfTexts.includes(`Da fatturare: EUR ${money}`), h.pdfTexts.join('\n'));
    if (route === 'pdf') assert.ok(!h.pdfTexts.some(t => /operational-block-/.test(t)));
  }
  assert.deepEqual(h.tables, before);
  assert.equal(h.writes.length, 0);
  return { page, reports };
}

test('block rule requires Tuscan channel, specific experience and explicit source classification', () => {
  const { isTuscanEscapeInvoiceBlock: excluded } = pricingHarness().load('lib/fmdq-invoice-eligibility.ts');
  for (const notes of ['Tuscan escape', 'Tuscan Escape t', ' Tuscan Escape - Blocco data ', 'Tuscan\n escape']) {
    assert.equal(excluded({ channel_id: 7, experience_id: 22, notes }), true);
  }
  assert.equal(excluded({ channel_id: '7', experience_id: '22', notes: 'Tuscan escape' }), true);
  for (const b of [
    { channel_id: 22, experience_id: 22, notes: 'Tuscan escape' },
    { channel_id: 7, experience_id: 7, notes: 'Tuscan escape' },
    { channel_id: 7, experience_id: 22, notes: '9 pranzo Tuscan escape' },
    { channel_id: 7, experience_id: 22, notes: null, experience_name: 'Tuscan Escape - Blocco data' },
    { channel_id: 7, experience_id: 22, notes: 'Tuscan escape', original_title: '9 pranzo Tuscan escape' },
  ]) assert.equal(excluded(b), false);
});

test('each confirmed October block and a future block contribute zero in all three outputs', async () => {
  for (const block of [...blocks, { ...blocks[0], id: 90000, booking_date: '2026-10-29',
    booking_reference: 'GCAL-operational-block-future', notes: 'Tuscan Escape t' }]) {
    const { page } = await verifyOutputs(harness([block]), 0, 0);
    assert.doesNotMatch(textContent(page), /Tuscan Escape - Blocco data/);
  }
});

test('six reviewed October lunches total 1586 with eight-client discount and blocks excluded', async () => {
  const h = harness([...lunches, ...blocks]);
  const { page, reports } = await verifyOutputs(h, 1586, 43);
  assert.doesNotMatch(textContent(page), /Tuscan Escape - Blocco data/);
  const rows = reports.flatMap(n => n.props.rows);
  assert.equal(rows.reduce((sum, r) => sum + r.total, 0), 1586);
  // Exercise each real lunch independently, checking the actual calculated rate.
  for (const lunch of lunches) {
    const expectedRate = lunch.adults === 8 ? 36 : 38;
    const result = await verifyOutputs(harness([lunch]), lunch.adults * expectedRate, lunch.adults);
    assert.equal(result.reports[0].props.rows[0].unitPrice, expectedRate);
  }
});

test('ordinary other-channel booking retains its amount even with block-like notes and experience', async () => {
  const h = pricingHarness();
  h.tables.experiences.push({ ...h.experience, id: 22, name: 'Tuscan Escape - Blocco data' });
  h.tables.experience_channel_prices.push({ ...h.price, experience_id: 22 });
  Object.assign(h.booking, { booking_date: '2026-10-14', experience_id: 22, notes: 'Tuscan escape' });
  await verifyOutputs(h, 950, 25);
});
