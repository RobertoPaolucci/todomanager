import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingHarness } from './helpers/booking-pricing-harness.mjs';
import { extractBokunItemReferences, resolveGoogleBokunLink } from '../lib/google-calendar-booking-link.mjs';

function setup() {
  const h = pricingHarness();
  Object.assign(h.channel, { id: 6, name: 'Fattoria Madonna della Querce' });
  Object.assign(h.price, { channel_id: 6, public_unit_price: 45, your_child_unit_price: 16, public_child_unit_price: 20 });
  Object.assign(h.booking, { channel_id: 6, adults: 2, children: 0, infants: 1, non_paying_adults: 0,
    total_people: 3, bokun_booking_reference: 'TOD-108037806', booking_reference: null,
    booking_date: '2026-11-23', booking_time: '12:00', bokun_item_reference: 'TOD-T151827070',
    total_to_you: 76, total_customer: 90, total_supplier_cost: 76, margin_total: 0 });
  return h;
}
const row = { id: 724, booking_date: '2026-11-23', booking_time: '12:00', adults: 2, children: 0, infants: 1,
  experience_id: 7, channel_id: 6, original_title: '2+1 neonato pranzo T151827070 Test',
  booking_reference: 'GCAL-offline-event', gcal_uid: 'offline-event', import_status: 'pending', imported_booking_id: null };

test('normalized 2 adults + infant: real webhook uses 2 paying participants, saves total 3 and item for channel 6; replay unchanged', async () => {
  const h = setup(); h.tables.bookings.length = 0;
  const payload = { action: 'BOOKING_CONFIRMED', adults: 2, children: 0, infants: 1, total_people: 3,
    productConfirmationCode: 'TOD-T151827070' };
  const result = await h.webhook(payload);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const booking = h.tables.bookings[0];
  assert.equal(booking.adults, 2); assert.equal(booking.infants, 1); assert.equal(booking.total_people, 3);
  assert.equal(booking.total_to_you, 76); assert.equal(booking.total_customer, 90);
  assert.equal(booking.bokun_item_reference, 'TOD-T151827070');
  const before = structuredClone(booking);
  assert.equal((await h.webhook(payload)).body.action, 'unchanged');
  assert.deepEqual(h.tables.bookings, [before]);
});

test('invalid counts and contradictory category totals fail before writes; never guess infants from a total', async () => {
  const h = setup(); const before = structuredClone(h.tables.bookings);
  for (const patch of [{ adults: -1 }, { infants: 'one' }, { infants: 0.5 }, { children: true },
    { adults: 3, infants: 1, total_people: 3 }]) {
    assert.equal((await h.webhook(patch)).status, 409);
    assert.deepEqual(h.tables.bookings, before);
  }
});

test('no infants, child rates, tier prices and agreed prices retain existing pricing policy', async () => {
  const h = setup();
  assert.equal((await h.webhook({ infants: 0, children: 1 })).status, 200);
  assert.equal(h.booking.total_to_you, 92); assert.equal(h.booking.total_customer, 110);
  Object.assign(h.price, { pricing_mode: 'tiered', price_tiers: [
    { min_participants: 2, max_participants: 2, your_unit_price: 35, public_unit_price: 42, supplier_adult_unit_cost: 35 },
    { min_participants: 3, max_participants: 3, your_unit_price: 30, public_unit_price: 40, supplier_adult_unit_cost: 30 },
  ] });
  h.booking.total_to_you_source = 'configured_price';
  await h.webhook({ children: 0, infants: 1 });
  assert.equal(h.booking.total_to_you, 70); assert.equal(h.booking.total_customer, 84);
  await h.webhook({ children: 1, infants: 1 });
  assert.equal(h.booking.total_to_you, 76); assert.equal(h.booking.total_customer, 100);
  h.booking.agreed_unit_price = 25;
  await h.webhook({ children: 0, infants: 1 });
  assert.equal(h.booking.total_to_you, 50); assert.equal(h.booking.total_people, 3);
});

test('full and short item codes normalize exactly; multiple codes remain ambiguous', () => {
  assert.deepEqual(extractBokunItemReferences('T151827070 TOD-T151827070'), ['TOD-T151827070']);
  assert.deepEqual(extractBokunItemReferences('XT151827070 T151827070X'), []);
  assert.equal(extractBokunItemReferences('T151827070 T151827071').length, 2);
});

test('exact item resolves with different date and incomplete customer without any booking write', async () => {
  const h = setup(); const before = structuredClone(h.tables.bookings);
  for (const date of ['2026-11-23', '2026-11-24']) {
    const result = await resolveGoogleBokunLink(h.db, { ...row, booking_date: date });
    assert.equal(result.imported_booking_id, h.booking.id);
    assert.equal(result.import_status, date === '2026-11-23' ? 'already_exists' : 'needs_review');
  }
  assert.deepEqual(h.tables.bookings, before); assert.equal(h.writes.length, 0);
});

test('missing, ambiguous, cross-unit and changed references require review; existing duplicate link is never silently replaced', async () => {
  const h = setup();
  for (const patch of [{ original_title: 'T151827070 T151827071' }, { original_title: 'T999999' }]) {
    assert.equal((await resolveGoogleBokunLink(h.db, { ...row, ...patch })).import_status, 'needs_review');
  }
  const previous = { ...row, imported_booking_id: h.booking.id };
  assert.equal((await resolveGoogleBokunLink(h.db, { ...row, original_title: '2 pranzo' }, 1, previous)).import_status, 'needs_review');
  h.tables.bookings.push({ ...h.booking, id: 999 });
  assert.equal((await resolveGoogleBokunLink(h.db, row)).import_status, 'needs_review');
  h.tables.bookings.pop();
  assert.equal((await resolveGoogleBokunLink(h.db, row, 2)).import_status, 'needs_review');
  h.booking.business_unit_id = 2;
  assert.equal((await resolveGoogleBokunLink(h.db, row)).import_status, 'needs_review');
  h.booking.business_unit_id = 1;
  const oldLink = await resolveGoogleBokunLink(h.db, row, 1, { imported_booking_id: 2419 });
  assert.equal(oldLink.imported_booking_id, 2419); assert.equal(oldLink.import_status, 'needs_review');
  assert.equal((await resolveGoogleBokunLink(h.db, { ...row, original_title: '2 pranzo Bokun' })).import_status, 'needs_review');
});

async function importRows(h, staging = row) {
  h.tables.google_calendar_import_staging = [structuredClone(staging)];
  const form = new FormData(); form.set('row_ids', String(staging.id)); form.set('force_import', 'true');
  await assert.rejects(h.load('app/import/google-calendar/actions.ts').importSelectedGoogleCalendarRows(form), /REDIRECT:/);
  return h.tables.google_calendar_import_staging[0];
}

test('real Calendar import: same/different date, Calendar first and force replay never insert a second booking', async () => {
  for (const date of ['2026-11-23', '2026-11-24']) {
    const h = setup(); const before = structuredClone(h.tables.bookings);
    let staged = await importRows(h, { ...row, booking_date: date });
    assert.equal(staged.imported_booking_id, h.booking.id);
    staged = await importRows(h, staged);
    assert.equal(staged.imported_booking_id, h.booking.id);
    assert.deepEqual(h.tables.bookings, before);
  }
  const h = setup(); h.tables.bookings.length = 0;
  const staged = await importRows(h);
  assert.equal(staged.import_status, 'needs_review'); assert.equal(h.tables.bookings.length, 0);
});

async function google(h, patch = {}) {
  const response = await h.load('app/api/webhooks/google-calendar/route.ts').POST(new Request('http://local.test/google', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'offline-test' },
    body: JSON.stringify({ event_id: row.gcal_uid, title: row.original_title, start: '2026-11-23T12:00:00+01:00',
      updated: '2026-11-01T13:00:00Z', status: 'confirmed', ...patch }),
  }));
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

test('real Calendar webhook: initial link, modification, cancellation, stale replay and reactivation preserve Bókun data', async () => {
  const h = setup(); const before = structuredClone(h.tables.bookings);
  await google(h);
  let staging = h.tables.google_calendar_import_staging[0];
  assert.equal(staging.imported_booking_id, h.booking.id); assert.equal(staging.import_status, 'already_exists');
  await google(h, { start: '2026-11-24T12:00:00+01:00', updated: '2026-11-01T14:00:00Z' });
  assert.equal(staging.import_status, 'needs_review'); assert.equal(staging.imported_booking_id, h.booking.id);
  await google(h, { status: 'cancelled', updated: '2026-11-01T15:00:00Z' });
  assert.equal(staging.import_status, 'gcal_cancelled');
  await google(h); assert.equal(staging.import_status, 'gcal_cancelled');
  await google(h, { updated: '2026-11-01T16:00:00Z' });
  assert.equal(staging.import_status, 'needs_review'); assert.equal(staging.imported_booking_id, h.booking.id);
  assert.deepEqual(h.tables.bookings, before);
});

test('Bókun cancellation and repeated cancellation preserve economics; Calendar cannot reactivate it', async () => {
  const h = setup(); const total = h.booking.total_to_you;
  assert.equal((await h.webhook({ action: 'BOOKING_CANCELLED' })).status, 200);
  assert.equal((await h.webhook({ action: 'BOOKING_CANCELLED' })).body.action, 'unchanged');
  assert.equal(h.booking.total_to_you, total);
  const staged = await importRows(h);
  assert.equal(staged.import_status, 'needs_review'); assert.equal(h.booking.is_cancelled, true);
});

test('concurrent reconciliation cannot restore a stale staging link during the import action', async () => {
  const h = setup(); h.tables.google_calendar_import_staging = [structuredClone(row)];
  h.beforeUpdate(() => { h.tables.google_calendar_import_staging[0].imported_booking_id = 999; });
  const form = new FormData(); form.set('row_ids', '724');
  await assert.rejects(h.load('app/import/google-calendar/actions.ts').importSelectedGoogleCalendarRows(form), /Staging modificato/);
  assert.equal(h.tables.google_calendar_import_staging[0].imported_booking_id, 999);
  assert.equal(h.tables.bookings.length, 1);
});
