import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pricingHarness, nodes, textContent } from './helpers/booking-pricing-harness.mjs';
import { guardedQuery } from '../scripts/execute-viator-backfill.mjs';
import { simulateBackfill } from '../lib/viator-backfill.mjs';

test('2010 simulation: NULL preserves 950; agreement 30 gives 25 paying, 27 seats, income/cost 750 and margin zero', async () => {
  const h = pricingHarness();
  const prices = structuredClone(h.tables.experience_channel_prices);
  const payments = structuredClone(h.tables.supplier_payments);
  const other = { ...structuredClone(h.booking), id: 2011, booking_reference: 'OTHER', bokun_booking_reference: 'TEST-2011' };
  h.tables.bookings.push(other);
  assert.equal((await h.save({ agreed_unit_price: '' })).saved, true);
  assert.equal(h.booking.total_to_you, 950);
  assert.equal(h.booking.total_supplier_cost, 950);
  assert.equal((await h.save({ agreed_unit_price: '30' })).saved, true);
  assert.equal(h.booking.adults + h.booking.children, 25);
  assert.equal(h.booking.total_people, 27);
  assert.equal(h.booking.pax, 27);
  assert.equal(h.booking.total_to_you, 750);
  assert.equal(h.booking.total_supplier_cost, 750);
  assert.equal(h.booking.margin_total, 0);
  assert.equal(h.booking.total_customer, 0);
  assert.equal(h.booking.total_amount, 0);
  assert.equal(other.total_to_you, 950);
  assert.equal(other.agreed_unit_price, null);
  assert.deepEqual(h.tables.experience_channel_prices, prices);
  assert.deepEqual(h.tables.supplier_payments, payments);
  assert.equal(h.booking.customer_payment_status, 'paid');
  assert.equal(h.booking.supplier_payment_status, 'partial');
  assert.equal(h.booking.supplier_amount_paid, 123);
  assert.ok(h.writes.every(write => write.table === 'bookings'));
  const report = h.load('app/fornitori/[id]/report/page.tsx');
  assert.equal(report.getPayingPeopleCount(h.booking), 25);
  assert.equal(report.getBookingIncome(h.booking), 750);
  assert.equal(report.getBookingSupplierCost(h.booking), 750);
  // No input from an older caller must preserve an existing agreement.
  assert.equal((await h.save({ adults: 26 })).saved, true);
  assert.equal(h.booking.agreed_unit_price, 30);
  assert.equal(h.booking.total_to_you, 780);
  assert.equal((await h.save({ agreed_unit_price: '' })).saved, true);
  assert.equal(h.booking.total_to_you, 988);
  assert.equal(h.booking.agreed_unit_price, null);
});

for (const status of ['pending', 'partial', 'paid', null]) {
  test(`missing payment fields preserve ${status} status and history even after changing cost`, async () => {
    const h = pricingHarness(); h.booking.supplier_payment_status = status;
    const before = structuredClone(h.tables.supplier_payments);
    await h.save({ agreed_unit_price: 30 });
    assert.equal(h.booking.supplier_payment_status, status);
    assert.equal(h.booking.supplier_amount_paid, 123);
    assert.deepEqual(h.tables.supplier_payments, before);
    const payload = h.writes.at(-1).payload;
    for (const field of ['customer_payment_status', 'supplier_payment_status', 'supplier_amount_paid']) assert.equal(Object.hasOwn(payload, field), false);
  });
}

test('concurrent payment is not overwritten by an unrelated booking save', async () => {
  const h = pricingHarness();
  h.beforeUpdate(() => { h.booking.supplier_amount_paid = 456; h.booking.supplier_payment_status = 'paid'; });
  await h.save({ agreed_unit_price: 30 });
  assert.equal(h.booking.supplier_amount_paid, 456);
  assert.equal(h.booking.supplier_payment_status, 'paid');
  assert.equal(h.tables.supplier_payments.length, 1);
});

test('booking save refuses a concurrently changed agreement instead of overwriting it', async () => {
  const h = pricingHarness();
  h.beforeUpdate(() => { h.booking.agreed_unit_price = 31; h.booking.total_to_you = 775; });
  assert.match((await h.save({ agreed_unit_price: 30 })).error, /cambiato durante/);
  assert.equal(h.booking.agreed_unit_price, 31);
  assert.equal(h.booking.total_to_you, 775);
  assert.equal(h.tables.supplier_payments.length, 1);
});

test('new bookings retain pending/zero defaults and can carry an agreement without creating a payment', async () => {
  const h = pricingHarness();
  assert.equal((await h.save({ agreed_unit_price: 30 }, true)).saved, true);
  const row = h.tables.bookings.at(-1);
  assert.equal(row.agreed_unit_price, 30); assert.equal(row.total_to_you, 750);
  assert.equal(row.customer_payment_status, 'pending'); assert.equal(row.supplier_payment_status, 'pending');
  assert.equal(row.supplier_amount_paid, 0); assert.equal(h.tables.supplier_payments.length, 1);
});

test('standard adult/child prices stay unchanged; agreement includes children but excludes infants and guides', async () => {
  const h = pricingHarness();
  await h.save({ adults: 2, children: 3, infants: 4, non_paying_adults: 5, agreed_unit_price: '' });
  assert.equal(h.booking.total_to_you, 124); assert.equal(h.booking.total_supplier_cost, 124);
  await h.save({ agreed_unit_price: 30 });
  assert.equal(h.booking.total_to_you, 150); assert.equal(h.booking.total_supplier_cost, 150);
  assert.equal(h.booking.total_people, 14); assert.equal(h.booking.margin_total, 0);
});

test('NULL child rates fall back to adult; explicit child zero is not a fallback', async () => {
  for (const child of [null, 0]) {
    const h = pricingHarness(); h.price.your_child_unit_price = child; h.price.supplier_child_unit_cost = child;
    await h.save({ adults: 2, children: 3, agreed_unit_price: '' });
    assert.equal(h.booking.total_to_you, child === null ? 190 : 76);
  }
});

test('zero agreement is persisted, not treated as NULL', async () => {
  const h = pricingHarness(); await h.save({ agreed_unit_price: 0 });
  assert.equal(h.booking.agreed_unit_price, 0); assert.equal(h.booking.total_to_you, 0);
  assert.equal(h.booking.total_supplier_cost, 0); assert.equal(h.booking.margin_total, 0);
});

test('decimal comma is accepted and monetary totals are rounded consistently', async () => {
  const h = pricingHarness(); await h.save({ agreed_unit_price: '30,12' });
  assert.equal(h.booking.agreed_unit_price, 30.12);
  assert.equal(h.booking.total_to_you, 753);
  assert.equal(h.booking.total_supplier_cost, 753);
});

for (const invalid of ['-1', 'NaN', 'Infinity', '30.001', '10000000000', '1e2']) {
  test(`invalid agreement ${invalid} is rejected without any write`, async () => {
    const h = pricingHarness(); assert.ok((await h.save({ agreed_unit_price: invalid })).error);
    assert.equal(h.writes.length, 0);
  });
}

test('group/quad agreement rejected server-side; automatic quad units unchanged', async () => {
  const h = pricingHarness(); h.experience.is_group_pricing = true; h.experience.name = 'Quad';
  assert.match((await h.save({ agreed_unit_price: 30 })).error, /gruppi|quad/);
  assert.equal(h.writes.length, 0);
  await h.save({ adults: 5, agreed_unit_price: '' });
  assert.equal(h.booking.total_to_you, 38 * 3);
  const input = nodes(h.renderForm()).find(node => node.props?.id === 'agreed_unit_price');
  assert.equal(input.props.disabled, true);
});

test('FMDQ identity uses configured relationships, not booking/channel/supplier numeric IDs', async () => {
  const h = pricingHarness();
  Object.assign(h.booking, { business_unit_id: 101, supplier_id: 303, channel_id: 222, experience_id: 707 });
  Object.assign(h.experience, { business_unit_id: 101, supplier_id: 303, id: 707 });
  Object.assign(h.price, { experience_id: 707, channel_id: 222 });
  h.channel.id = 222; h.channel.name = 'Different agency';
  h.tables.business_units[0].id = 101;
  Object.assign(h.tables.business_unit_internal_suppliers[0], { business_unit_id: 101, supplier_id: 303 });
  await h.save({ agreed_unit_price: 30 });
  assert.equal(h.booking.total_to_you, 750); assert.equal(h.booking.total_supplier_cost, 750);
});

test('other supplier economics retain their real cost; incompatible direct FMDQ rates are rejected', async () => {
  const h = pricingHarness(); h.channel.fattura_mensile_fmdq = false;
  await h.save({ agreed_unit_price: 30 });
  assert.equal(h.booking.total_to_you, 750); assert.equal(h.booking.total_supplier_cost, 950);
  assert.equal(h.booking.margin_total, -200);
  const incompatible = pricingHarness(); incompatible.price.your_unit_price = 42;
  assert.match((await incompatible.save({ agreed_unit_price: 30 })).error, /differenti/);
  assert.equal(incompatible.writes.length, 0);
});

test('agreement never creates a missing price-list entry', async () => {
  const h = pricingHarness(); h.tables.experience_channel_prices.length = 0;
  assert.match((await h.save({ agreed_unit_price: 30, new_your_unit_price: 38 })).error, /listino/);
  assert.equal(h.writes.length, 0);
});

test('context change requires clearing agreement or explicit confirmation; UI clears and explains', async () => {
  const h = pricingHarness(); await h.save({ agreed_unit_price: 30 });
  h.tables.channels.push({ ...h.channel, id: 23 }); h.tables.experience_channel_prices.push({ ...h.price, id: 488, channel_id: 23 });
  assert.match((await h.save({ channel_id: 23 })).error, /conferma/);
  assert.equal(h.booking.channel_id, 22);
  let tree = h.renderForm();
  nodes(tree).find(node => node.props?.name === 'channel_id').props.onChange({ target: { value: '23' } });
  tree = h.renderForm();
  assert.equal(nodes(tree).find(node => node.props?.id === 'agreed_unit_price').props.value, '');
  assert.match(textContent(tree), /Prezzo concordato rimosso/);
  assert.equal((await h.save({ channel_id: 23, agreed_unit_price: 30, confirm_agreed_price_context: 'yes' })).saved, true);
});

test('form has no payment inputs; preview matches child pricing and interactive agreement removal', () => {
  const h = pricingHarness(); Object.assign(h.booking, { adults: 2, children: 3, infants: 4, non_paying_adults: 5 });
  let tree = h.renderForm();
  const value = (name) => nodes(tree).find(node => node.props?.name === name)?.props.value;
  assert.equal(value('total_to_you'), 124);
  assert.doesNotMatch(textContent(tree), /Pagamenti e calcoli/);
  for (const field of ['supplier_payment_status', 'supplier_amount_paid', 'customer_payment_status', 'total_amount', 'supplier_payment_method']) {
    assert.equal(nodes(tree).some(node => node.props?.name === field), false);
  }
  const change = price => {
    nodes(tree).find(node => node.props?.id === 'agreed_unit_price').props.onChange({ target: { value: price } });
    tree = h.renderForm();
  };
  change('30'); assert.equal(value('total_to_you'), 150); assert.equal(value('total_supplier_cost'), 150);
  assert.match(textContent(tree), /Prezzo concordato attivo/);
  change('0'); assert.equal(value('total_to_you'), 0);
  change(''); assert.equal(value('total_to_you'), 124);
});

test('report corrects separate guides, preserving legacy count convention when capacity proves no separation', () => {
  const h = pricingHarness(); const pricing = h.load('lib/booking-pricing.ts');
  assert.equal(pricing.reportPayingAdults(h.booking), 25);
  assert.equal(pricing.reportPayingAdults({ ...h.booking, adults: 27, total_people: 27 }), 25);
  assert.equal(pricing.reportPayingAdults({ ...h.booking, total_people: null }), 23);
  const report = h.load('app/fornitori/[id]/report/page.tsx');
  assert.equal(report.getBookingIncome(h.booking), 950);
});

for (const agreement of [null, 30, 0]) {
  test(`invoice page and both PDF routes use the same effective amount (agreement ${agreement})`, async () => {
    const h = pricingHarness(); await h.save({ agreed_unit_price: agreement ?? '' });
    const expected = agreement === null ? 950 : 25 * agreement;
    const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
    const report = nodes(page).find(node => node.props?.totalInvoice !== undefined);
    assert.equal(report.props.totalInvoice, expected);
    assert.equal(report.props.totalAdults, 25);
    assert.equal(report.props.rows[0].unitPrice, agreement ?? 38);
    for (const route of ['pdf', 'pdf-riepilogo']) {
      h.pdfTexts.length = 0;
      const response = await h.load(`app/fatturazione-fmdq/${route}/route.ts`).GET(new Request('http://local.test/pdf?month=2026-09'));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.ok(h.pdfTexts.some(text => text.includes(`EUR ${expected},00`)), h.pdfTexts.join('\n'));
      if (agreement !== null) assert.ok(h.pdfTexts.every(text => !text.includes('950,00')));
    }
  });
}

test('invoice aggregate mixes automatic and agreed bookings without changing the automatic row', async () => {
  const h = pricingHarness();
  h.tables.bookings.push({ ...structuredClone(h.booking), id: 2011, bokun_booking_reference: 'TEST-2011' });
  await h.save({ agreed_unit_price: 30 });
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  const report = nodes(page).find(node => node.props?.totalInvoice !== undefined);
  assert.equal(report.props.totalInvoice, 1700);
  assert.equal(report.props.rows[0].unitPrice, null);
  assert.equal(report.props.totalAdults, 50);
  assert.equal(h.tables.bookings[1].total_to_you, 950);
});

test('FMDQ supplier acting outside its internal business unit keeps ordinary invoice cost', async () => {
  const h = pricingHarness(); h.experience.business_unit_id = 2; h.booking.business_unit_id = 2;
  await h.save({ agreed_unit_price: 30 });
  assert.equal(h.booking.total_to_you, 750); assert.equal(h.booking.total_supplier_cost, 950);
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  assert.equal(nodes(page).find(node => node.props?.totalInvoice !== undefined).props.totalInvoice, 950);
});

test('webhook updates participants using stored agreement, preserves guides and cancellations/restorations', async () => {
  const h = pricingHarness(); await h.save({ agreed_unit_price: 30 });
  assert.equal((await h.webhook({ adults: 26, children: 1, infants: 3 })).status, 200);
  assert.equal(h.booking.agreed_unit_price, 30); assert.equal(h.booking.total_to_you, 810);
  assert.equal(h.booking.total_supplier_cost, 810); assert.equal(h.booking.margin_total, 0);
  assert.equal(h.booking.total_people, 32);
  const before = structuredClone(h.booking);
  await h.webhook({ action: 'BOOKING_CANCELLED' });
  assert.equal(h.booking.is_cancelled, true); assert.equal(h.booking.total_to_you, before.total_to_you);
  assert.equal(h.booking.agreed_unit_price, 30);
  await h.webhook({ action: 'BOOKING_CONFIRMED' });
  assert.equal(h.booking.is_cancelled, false); assert.equal(h.booking.total_to_you, 810);
  assert.equal((await h.webhook({ channel_id: 23 })).status, 409);
  assert.equal(h.booking.channel_id, 22);
});

test('Viator source total cannot replace a manual income agreement; genuine supplier cost is preserved', async () => {
  const h = pricingHarness(); h.channel.id = 2; h.channel.fattura_mensile_fmdq = false;
  h.booking.channel_id = 2; h.booking.bokun_booking_reference = 'VIA-2010'; h.price.channel_id = 2;
  await h.save({ agreed_unit_price: 30 });
  assert.equal((await h.webhook({ source_total_price: 999, adults: 26 })).status, 200);
  assert.equal(h.booking.total_to_you, 780); assert.equal(h.booking.total_supplier_cost, 988);
  assert.equal(h.booking.agreed_unit_price, 30); assert.equal(h.booking.total_to_you_source, null);
});

test('webhook stale update refuses a concurrently entered agreement', async () => {
  const h = pricingHarness(); h.beforeUpdate(() => { h.booking.agreed_unit_price = 30; h.booking.total_to_you = 750; });
  assert.equal((await h.webhook({ adults: 26 })).status, 409);
  assert.equal(h.booking.total_to_you, 750); assert.equal(h.booking.agreed_unit_price, 30);
});

test('backfill excludes every agreement including zero, and conditional SQL filter protects races', () => {
  for (const price of [0, 30]) {
    const h = pricingHarness(); const b = { ...h.booking, channel_id: 2, agreed_unit_price: price, cancelled_at: null };
    const prepared = { reviewIds: [], alreadyCorrect: [], candidates: [{ id: b.id, expected: b, confirmationCode: 'VIA-2010', targetCents: 90000, productId: '956472' }] };
    const simulation = simulateBackfill(prepared, { bookings: [b], experiences: [{ id: 7, bokun_id: '956472' }] });
    assert.equal(simulation.rows[0].status, 'SKIPPED');
    assert.ok(simulation.rows[0].reasons.includes('AGREED_PRICE_PROTECTED'));
    assert.throws(() => guardedQuery(b), /AGREED_PRICE_PROTECTED/);
  }
});

const pglite = resolve('.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js');
test('migration is nullable, finite, non-negative and leaves existing bookings unchanged', { skip: !existsSync(pglite) }, async () => {
  const { PGlite } = await import(pathToFileURL(pglite).href);
  const db = await PGlite.create();
  try {
    await db.exec('create table bookings(id bigint primary key, total_to_you numeric); insert into bookings values(2010, 950);');
    await db.exec(readFileSync('supabase/migrations/202609290001_booking_agreed_unit_price.sql', 'utf8'));
    assert.deepEqual((await db.query('select * from bookings')).rows, [{ id: 2010, total_to_you: '950', agreed_unit_price: null }]);
    for (const price of ['30', '0', '9999999999.99']) await db.query('update bookings set agreed_unit_price = $1', [price]);
    for (const price of ['-1', 'NaN', 'Infinity', '-Infinity', '10000000000']) {
      await assert.rejects(db.query('update bookings set agreed_unit_price = $1', [price]));
    }
  } finally { await db.close(); }
});
