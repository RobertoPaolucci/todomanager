import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { pricingHarness, nodes, textContent } from './helpers/booking-pricing-harness.mjs';

function tierHarness() {
  const h = pricingHarness();
  Object.assign(h.channel, { id: 4, name: 'Todointheworld', fattura_mensile_fmdq: false });
  Object.assign(h.experience, { id: 12, bokun_id: '1052970', name: 'E-Bike Montepulciano vigneti e villaggi', supplier_unit_cost: 135 });
  Object.assign(h.price, { experience_id: 12, channel_id: 4, pricing_mode: 'tiered', your_unit_price: 135,
    public_unit_price: 135, supplier_adult_unit_cost: 135, your_child_unit_price: 0,
    public_child_unit_price: 0, supplier_child_unit_cost: 0,
    price_tiers: [110, 95, 85, 80, 76].map((price, i) => ({ min_participants: i + 2, max_participants: i + 2,
      your_unit_price: price, public_unit_price: price, supplier_adult_unit_cost: price })) });
  Object.assign(h.booking, { id: 2000, experience_id: 12, channel_id: 4, adults: 5, children: 0, non_paying_adults: 0,
    total_people: 5, total_to_you: 400, total_customer: 400, total_supplier_cost: 400,
    your_unit_price: 135, public_unit_price: 135, supplier_unit_cost: 135 });
  return h;
}

for (const [adults, total] of [[2, 220], [3, 285], [4, 340], [5, 400], [6, 456]]) {
  test(`${adults} adults: create, preview, webhook and supplier report give ${total}`, async () => {
    const h = tierHarness();
    assert.equal((await h.save({ adults }, true)).saved, true);
    const created = h.tables.bookings.at(-1);
    for (const key of ['total_to_you', 'total_customer', 'total_supplier_cost']) assert.equal(created[key], total);
    assert.equal(created.price_tier_snapshot.min_participants, adults);
    assert.equal(h.booking.total_to_you, 400, 'historical #2000 untouched');
    const tree = h.renderForm({ initialData: { ...created }, isEditing: false });
    assert.equal(nodes(tree).find(node => node.props?.name === 'total_to_you').props.value, total);
    h.tables.bookings.length = 0;
    assert.equal((await h.webhook({ action: 'BOOKING_CONFIRMED', adults })).status, 200);
    const imported = h.tables.bookings[0];
    for (const key of ['total_to_you', 'total_customer', 'total_supplier_cost']) assert.equal(imported[key], total);
    const report = h.load('app/fornitori/[id]/report/page.tsx');
    assert.equal(report.getBookingIncome(imported), total);
    assert.equal(report.getBookingGross(imported), total);
    assert.equal(report.getBookingSupplierCost(imported), total);
  });
}

test('edits recalculate changed paying participants but preserve historical/manual amounts on ordinary saves', async () => {
  const h = tierHarness();
  h.price.price_tiers[3].your_unit_price = 99;
  assert.equal((await h.save({ notes: 'Changed note' })).saved, true);
  assert.equal(h.booking.total_to_you, 400);
  assert.equal(Object.hasOwn(h.writes.at(-1).payload, 'total_to_you'), false);
  assert.equal((await h.save({ adults: 4 })).saved, true);
  assert.equal(h.booking.total_to_you, 340);
  const report = h.load('app/fornitori/[id]/report/page.tsx');
  assert.equal(report.getBookingIncome({ ...h.booking, total_to_you: 321 }), 321);
});

test('free children, infants and guides do not increase the tier or total; paid children have their own rate', async () => {
  const h = tierHarness();
  await h.save({ adults: 2, children: 3, infants: 4, non_paying_adults: 5 });
  assert.equal(h.booking.total_to_you, 220); assert.equal(h.booking.total_supplier_cost, 220);
  assert.equal(h.booking.total_people, 14);
  h.price.your_child_unit_price = 20; h.price.public_child_unit_price = 30; h.price.supplier_child_unit_cost = 10;
  await h.save({ adults: 2, children: 1 });
  assert.equal(h.booking.your_unit_price, 95);
  assert.equal(h.booking.total_to_you, 210); assert.equal(h.booking.total_customer, 220); assert.equal(h.booking.total_supplier_cost, 200);
});

test('three tier prices are independent; NULL children follow the tier adult price', async () => {
  const h = tierHarness();
  Object.assign(h.price.price_tiers[1], { your_unit_price: 90, public_unit_price: 100, supplier_adult_unit_cost: 70 });
  Object.assign(h.price, { your_child_unit_price: null, public_child_unit_price: null, supplier_child_unit_cost: null });
  await h.save({ adults: 2, children: 1 });
  assert.equal(h.booking.total_to_you, 270); assert.equal(h.booking.total_customer, 300); assert.equal(h.booking.total_supplier_cost, 210);
});

for (const adults of [0, 1, 7]) test(`missing tier (${adults}) fails without saving or falling back to 135`, async () => {
  const h = tierHarness();
  assert.match((await h.save({ adults }, true)).error, /Tariffa a fasce assente/);
  assert.equal(h.writes.length, 0);
  const tree = h.renderForm({ initialData: { ...h.booking, adults }, isEditing: false });
  assert.match(textContent(tree), /Tariffa a fasce assente/);
  h.tables.bookings.length = 0;
  const webhook = await h.webhook({ action: 'BOOKING_CONFIRMED', adults });
  assert.equal(webhook.status, 400); assert.equal(h.tables.bookings.length, 0);
});

test('webhook protects #2000, including cancellation/restoration and incoming actual totals', async () => {
  const h = tierHarness();
  for (const values of [{ source_total_price: 675 }, { action: 'BOOKING_CANCELLED' }, { action: 'BOOKING_CONFIRMED' }]) {
    assert.equal((await h.webhook(values)).status, 200);
    assert.equal(h.booking.total_to_you, 400); assert.equal(h.booking.total_supplier_cost, 400);
  }
  assert.equal((await h.webhook({ adults: 6 })).status, 409);
  assert.equal(h.booking.adults, 5); assert.equal(h.booking.total_to_you, 400);
});

test('new automatic webhook uses tiers, preserves actual Bókun totals on later events, and recalculates supplier cost', async () => {
  const h = tierHarness(); h.tables.bookings.length = 0;
  assert.equal((await h.webhook({ action: 'BOOKING_CONFIRMED', adults: 5, source_total_price: 390 })).status, 200);
  const row = h.tables.bookings[0];
  assert.equal(row.total_to_you, 390); assert.equal(row.total_customer, 390); assert.equal(row.total_supplier_cost, 400);
  assert.equal(row.total_to_you_source, 'bokun_webhook');
  assert.equal((await h.webhook({ adults: 6 })).status, 200);
  assert.equal(row.total_to_you, 390); assert.equal(row.total_supplier_cost, 456);
  assert.equal((await h.webhook({ adults: 6 })).body.action, 'unchanged');
});

test('fixed mode ignores stored tiers and other channels keep fixed prices', async () => {
  for (const channel of [1, 2, 3, 5, 6, 22]) {
    const h = tierHarness(); h.price.pricing_mode = 'fixed';
    h.channel.id = channel; h.price.channel_id = channel;
    assert.equal((await h.save({ channel_id: channel, adults: 2 }, true)).saved, true);
    const row = h.tables.bookings.at(-1);
    assert.equal(row.total_to_you, 270); assert.equal(row.total_customer, 270);
  }
});

test('invalid, overlapping and touching inclusive intervals are rejected', () => {
  const h = tierHarness(); const { validatePriceTiers } = h.load('lib/booking-pricing.ts');
  const tier = h.price.price_tiers[0];
  for (const invalid of [null, {}, [null], [{ ...tier, min_participants: 0 }], [{ ...tier, max_participants: 1 }],
    [{ ...tier, your_unit_price: -1 }], [{ ...tier, public_unit_price: '110' }], [{ ...tier, supplier_adult_unit_cost: 1.001 }],
    [tier, { ...tier, max_participants: 3 }]]) assert.throws(() => validatePriceTiers(invalid));
});

test('channel tariff editor saves independent amounts and rejects overlapping rows before writes', async () => {
  const h = tierHarness();
  const form = new FormData(); form.set('experience_id', '12'); form.set('pricing_mode_4', 'tiered');
  const tiers = structuredClone(h.price.price_tiers);
  Object.assign(tiers[0], { your_unit_price: 101, public_unit_price: 121, supplier_adult_unit_cost: 81 });
  form.set('price_tiers_4', JSON.stringify(tiers));
  for (const key of ['your_unit_price', 'public_unit_price', 'your_child_unit_price', 'public_child_unit_price', 'supplier_adult_unit_cost', 'supplier_child_unit_cost']) {
    form.set(`${key}_4`, String(h.price[key]));
  }
  const save = h.load('app/esperienze/[id]/prezzi/actions.ts').saveExperienceChannelPrices;
  await assert.rejects(save(form), /REDIRECT:/);
  assert.equal(h.price.price_tiers[0].your_unit_price, 101);
  assert.equal(h.price.price_tiers[0].public_unit_price, 121);
  assert.equal(h.price.price_tiers[0].supplier_adult_unit_cost, 81);
  const before = h.writes.length;
  form.set('price_tiers_4', JSON.stringify([tiers[0], tiers[0]]));
  await assert.rejects(save(form), /sovrapporsi/); assert.equal(h.writes.length, before);
});

test('Bókun CSV import uses tier totals, skips historical bookings and reports missing tiers', async () => {
  const h = tierHarness(); h.tables.import_logs = [];
  const run = h.load('app/prenotazioni/import/actions.ts').importBokunBookings;
  const row = {
    'Booking ref': 'CSV-NEW', 'Cart confirmation code': 'CSV-NEW', 'Product confirmation code': 'TOD-T123',
    'Product title': h.experience.name, 'Start date': '2026-11-20 10:00', 'Creation date': '2026-10-31 10:00',
    'Booking channel': 'E-Bike', Participants: 'Adults: 5', Customer: 'Fixture', Status: 'CONFIRMED',
  };
  const mappings = { [h.experience.name]: 12 };
  assert.equal((await run([row], mappings)).imported, 1);
  const imported = h.tables.bookings.at(-1);
  assert.equal(imported.total_to_you, 400); assert.equal(imported.total_supplier_cost, 400);
  assert.equal((await run([row], mappings)).skipped, 1);
  const missing = await run([{ ...row, 'Booking ref': 'CSV-MISSING', 'Cart confirmation code': 'CSV-MISSING', 'Product confirmation code': 'TOD-T124', Participants: 'Adults: 7' }], mappings);
  assert.equal(missing.imported, 0); assert.match(missing.errors[0], /Tariffa a fasce assente/);
  assert.equal(h.booking.total_to_you, 400);
});

test('Google staged import uses tier amounts without changing its parsing, and flags missing tariffs for review', async () => {
  const h = tierHarness();
  const staging = { id: 77, experience_id: 12, channel_id: 4, booking_source: 'Todointheworld',
    booking_reference: 'GOOGLE-77', booking_date: '2026-11-20', booking_time: '10:00', customer_name: 'Fixture',
    adults: 5, children: 0, infants: 2, notes: '', original_title: '', gcal_uid: 'test', import_status: 'pending', imported_booking_id: null };
  h.tables.google_calendar_import_staging.push(staging);
  const form = new FormData(); form.append('row_ids', '77');
  const run = h.load('app/import/google-calendar/actions.ts').importSelectedGoogleCalendarRows;
  await assert.rejects(run(form), /REDIRECT:/);
  assert.equal(h.tables.bookings.at(-1).total_to_you, 400);
  assert.equal(h.tables.bookings.at(-1).total_supplier_cost, 400);
  const missing = { ...staging, id: 78, booking_reference: 'GOOGLE-78', adults: 7, imported_booking_id: null, import_status: 'pending' };
  h.tables.google_calendar_import_staging.push(missing); form.set('row_ids', '78');
  const before = h.tables.bookings.length;
  await assert.rejects(run(form), /REDIRECT:/);
  assert.equal(missing.import_status, 'needs_review'); assert.equal(h.tables.bookings.length, before);
});

test('invoice page and PDFs retain the selected tier after the channel list returns to fixed mode', async () => {
  const h = tierHarness(); h.channel.fattura_mensile_fmdq = true;
  await h.save({ adults: 4 });
  h.price.pricing_mode = 'fixed'; h.price.supplier_adult_unit_cost = 999;
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  assert.equal(nodes(page).find(node => node.props?.totalInvoice !== undefined).props.totalInvoice, 340);
  for (const route of ['pdf', 'pdf-riepilogo']) {
    h.pdfTexts.length = 0;
    const response = await h.load(`app/fatturazione-fmdq/${route}/route.ts`).GET(new Request('http://local.test/pdf?month=2026-09'));
    assert.equal(response.status, 200); assert.ok(h.pdfTexts.some(text => text.includes('EUR 340,00')));
  }
});

const pglitePath = resolve('.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js');
test('migration validates tariffs at the database boundary and changes only experience 12/channel 4', { skip: !existsSync(pglitePath) }, async () => {
  const { PGlite } = await import(pathToFileURL(pglitePath).href);
  const db = await PGlite.create();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table experiences(id bigint primary key, bokun_id text, is_group_pricing boolean);
      create table channels(id bigint primary key, name text);
      create table experience_channel_prices(id bigint primary key, experience_id bigint, channel_id bigint, your_unit_price numeric);
      create table bookings(id bigint primary key, total_to_you numeric);
      insert into experiences values(12,'1052970',false); insert into channels values(4,'Todointheworld');
      insert into experience_channel_prices values(300,12,4,135),(299,12,3,105);
      insert into bookings values(2000,400); grant select on experience_channel_prices to anon,authenticated;`);
    await db.exec(readFileSync('supabase/migrations/20261031142312_experience_channel_price_tiers.sql', 'utf8'));
    const rows = (await db.query('select * from experience_channel_prices order by id')).rows;
    assert.equal(rows[0].pricing_mode, 'fixed'); assert.deepEqual(rows[0].price_tiers, []);
    assert.equal(rows[1].pricing_mode, 'tiered'); assert.equal(rows[1].price_tiers.length, 5);
    assert.equal(rows[1].your_unit_price, '135');
    assert.equal((await db.query('select total_to_you from bookings where id=2000')).rows[0].total_to_you, '400');
    const tier = rows[1].price_tiers[0];
    for (const invalid of [null, {}, [tier, tier], [{ ...tier, your_unit_price: -1 }],
      [{ ...tier, min_participants: 1.5 }], [{ ...tier, supplier_adult_unit_cost: 3.001 }], []]) {
      await assert.rejects(db.query('update experience_channel_prices set price_tiers=$1 where id=300', [JSON.stringify(invalid)]));
    }
    await db.exec('set role anon');
    assert.equal((await db.query('select * from experience_channel_prices')).rows.length, 0);
    await db.exec('reset role');
  } finally { await db.close(); }
});
