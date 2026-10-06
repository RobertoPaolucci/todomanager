import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTuscanEscapeInvoiceEvidence } from '../lib/tuscan-escape-invoice-evidence.mjs';
import { pricingHarness, nodes, textContent } from './helpers/booking-pricing-harness.mjs';

const migration = readFileSync('supabase/migrations/202610060001_tuscan_escape_september_booking_adults.sql', 'utf8');
const targets = JSON.parse(migration.match(/targets constant jsonb := '([\s\S]*?)'::jsonb/)[1].replaceAll("''", "'"));
const snapshot = JSON.parse(readFileSync('tests/fixtures/tuscan-escape-september-2026.json', 'utf8'));
const discountIds = [2063, 2061, 2073, 2011, 2074, 2082, 2081, 2080, 1985];
const finalRows = () => targets.map(row => structuredClone(row.after));
const evidence = (rows = finalRows(), source = structuredClone(snapshot)) =>
  resolveTuscanEscapeInvoiceEvidence(rows, source.google_calendar_import_staging,
    source.google_calendar_events, source.google_calendar_event_aliases);

function harness(rows = finalRows()) {
  const h = pricingHarness();
  Object.assign(h.channel, { id: 7, name: 'Tuscan Escape', company_name: 'PAPILIO S.R.L.' });
  h.price.channel_id = 7;
  h.tables.experience_channel_prices.push({ ...h.price, id: 696, experience_id: 22 });
  h.tables.experiences.push({ ...h.experience, id: 22, name: 'Tuscan Escape - Blocco data' });
  h.tables.bookings = rows.map(row => ({ ...row, channels: h.channel, suppliers: h.booking.suppliers,
    experience_name: row.experience_id === 22 ? 'Tuscan Escape - Blocco data' : h.experience.name,
    experience: { is_group_pricing: false } }));
  for (const table of ['google_calendar_import_staging', 'google_calendar_events', 'google_calendar_event_aliases']) {
    h.tables[table] = structuredClone(snapshot[table]);
  }
  h.tables.fmdq_monthly_invoices.push({ channel_id: 7, invoice_month: '2026-09-01',
    is_invoiced: true, invoice_number: 'FPR 54/26', invoice_date: '2026-10-06' });
  return h;
}

for (const [paying, guide, channel, expected] of [
  [8, true, 7, 36], [8, false, 7, 38], [7, true, 7, 38], [6, true, 7, 38], [8, true, 22, 41],
]) {
  test(`central rates: channel ${channel}, ${paying} paying, verified guide ${guide}: ${expected}`, () => {
    const pricing = pricingHarness().load('lib/booking-pricing.ts');
    const result = pricing.effectiveFmdqInvoiceRates({ price: null, directFmdq: true, isGroupPricing: false,
      adult: 41, child: 16, channelId: channel, payingClients: paying,
      guideEvidence: guide ? { effective_total_guests: paying, excluded_staff: 1, attendance_quality: 'parsed' } : undefined });
    assert.equal(result.adult, expected);
    if (channel === 22) assert.equal(result.child, 16);
  });
}

test('agreement (including zero) precedes Tuscan rule; other business units and group pricing stay unchanged', () => {
  const pricing = pricingHarness().load('lib/booking-pricing.ts');
  const base = { price: null, directFmdq: true, isGroupPricing: false, adult: 38, child: 16,
    channelId: 7, payingClients: 8, guideEvidence: { effective_total_guests: 8, excluded_staff: 1, attendance_quality: 'parsed' } };
  for (const price of [30, 0]) assert.equal(pricing.effectiveFmdqInvoiceRates({ ...base, price }).adult, price);
  assert.equal(pricing.effectiveFmdqInvoiceRates({ ...base, directFmdq: false }).adult, 38);
  assert.equal(pricing.effectiveFmdqInvoiceRates({ ...base, isGroupPricing: true }).adult, 38);
  for (const altered of [{ excluded_staff: 0 }, { attendance_quality: 'needs_review' }, { effective_total_guests: 9 }]) {
    assert.equal(pricing.effectiveFmdqInvoiceRates({ ...base, guideEvidence: { ...base.guideEvidence, ...altered } }).adult, 38);
  }
});

test('exactly the nine verified September identities qualify, including 1985 parentheses and old missing guides', () => {
  assert.deepEqual([...evidence().keys()].map(Number).sort((a,b) => a-b), [...discountIds].sort((a,b) => a-b));
  const legacy = finalRows().find(row => row.id === 2073);
  legacy.non_paying_adults = 0;
  assert.ok(evidence([legacy]).has('2073'));
  assert.ok(evidence().has('1985'));
  // Quantities remain database quantities; source evidence must not fix adults implicitly.
  assert.deepEqual([...evidence(snapshot.bookings).keys()].map(Number).sort((a,b) => a-b), [1985, 2061]);
});

for (const scenario of ['absent', 'collision', 'unverified alias', 'conflicting alias', 'conflicting observation',
  'cancelled', 'wrong date', 'wrong imported booking', 'canonical conflict', 'unparseable']) {
  test(`identity/evidence ${scenario}: no automatic discount`, () => {
    const s = structuredClone(snapshot);
    const b = finalRows().find(row => row.id === 1985);
    const source = s.google_calendar_import_staging.find(row => row.id === 534);
    if (scenario === 'absent') s.google_calendar_import_staging = [];
    if (scenario === 'collision') s.google_calendar_import_staging.push({ ...source, id: 9999,
      gcal_uid: source.gcal_uid.slice(0,48) + 'different-google-id' });
    if (scenario === 'unverified alias') s.google_calendar_event_aliases.find(row => row.event_id === 1214).verified = false;
    if (scenario === 'conflicting alias') s.google_calendar_event_aliases.push({
      ...s.google_calendar_event_aliases.find(row => row.event_id === 1214), id: 9999, event_id: 1255 });
    if (scenario === 'conflicting observation') s.google_calendar_import_staging.push({ ...source, id: 9999, original_title: '8 pranzo Tuscan Escape' });
    if (scenario === 'cancelled') source.import_status = 'gcal_cancelled';
    if (scenario === 'wrong date') source.booking_date = '2026-09-27';
    if (scenario === 'wrong imported booking') source.imported_booking_id = 9999;
    if (scenario === 'canonical conflict') s.google_calendar_events.find(row => row.id === 1214).original_title = '8 pranzo Tuscan Escape';
    if (scenario === 'unparseable') source.original_title = 'Tuscan Escape';
    assert.equal(evidence([b], s).size, 0);
    const pricing = pricingHarness().load('lib/booking-pricing.ts');
    assert.equal(pricing.effectiveFmdqInvoiceRates({ price: null, directFmdq: true, isGroupPricing: false,
      adult: 38, child: 16, channelId: 7, payingClients: 8, guideEvidence: evidence([b], s).get('1985') }).adult, 38);
  });
}

test('page and both real PDF calculations agree at 4530 and preserve already-invoiced metadata', async () => {
  const h = harness(); const invoiceBefore = structuredClone(h.tables.fmdq_monthly_invoices);
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  const report = nodes(page).find(node => node.props?.totalInvoice !== undefined);
  assert.equal(report.props.totalInvoice, 4530); assert.equal(report.props.totalAdults, 123);
  assert.equal(report.props.totalChildren, 0); assert.equal(report.props.invoiceNumber, 'FPR 54/26');
  assert.equal(report.props.invoiceDate, '2026-10-06');
  assert.equal(report.props.rows.reduce((sum, row) => sum + row.total, 0), 4530);
  assert.match(textContent(page), /Promemoria Tuscan Escape: per gruppi di 8 clienti \+ 1 guida, la tariffa è €36 per cliente/);
  assert.match(textContent(page), /Fatturato/);
  for (const route of ['pdf', 'pdf-riepilogo']) {
    h.pdfTexts.length = 0;
    const response = await h.load(`app/fatturazione-fmdq/${route}/route.ts`).GET(new Request('http://local.test/pdf?month=2026-09'));
    assert.equal(response.status, 200);
    assert.ok(h.pdfTexts.some(text => /EUR 4\.?530,00/.test(text)), `${route}: ${h.pdfTexts.join('\n')}`);
    assert.ok(h.pdfTexts.some(text => text.includes('FPR 54/26')));
    assert.ok(h.pdfTexts.some(text => text.includes('06/10/2026')));
    assert.ok(h.pdfTexts.some(text => /Gia fatturato: EUR 4\.?530,00/.test(text)));
    if (route === 'pdf') assert.ok(h.pdfTexts.some(text => text.includes('8 x EUR 36,00')));
  }
  assert.deepEqual(h.tables.fmdq_monthly_invoices, invoiceBefore); assert.equal(h.writes.length, 0);
});

test('reminder follows Tuscan group in other months; other channels have no reminder', async () => {
  const h = harness([finalRows()[0]]); h.tables.bookings[0].booking_date = '2026-10-07';
  let page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-10' }) });
  assert.match(textContent(page), /Promemoria Tuscan Escape/);
  const other = pricingHarness();
  page = await other.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  assert.doesNotMatch(textContent(page), /Promemoria Tuscan Escape/);
});

test('server acquisition detects same-reference collision outside September', async () => {
  const h = harness(); const source = h.tables.google_calendar_import_staging.find(row => row.id === 534);
  h.tables.google_calendar_import_staging.push({ ...source, id: 9999, booking_date: '2027-01-01',
    gcal_uid: source.gcal_uid.slice(0,48) + 'different' });
  const resolved = await h.load('lib/tuscan-escape-invoice-evidence-server.ts').getTuscanEscapeInvoiceEvidence(h.tables.bookings);
  assert.equal(resolved.has('1985'), false);
  assert.equal(resolved.size, 8); assert.equal(h.writes.length, 0);
});

test('supplier report uses 123 paying adults, 141 seats, 4530 income and cost after correction', () => {
  const h = harness(); const report = h.load('app/fornitori/[id]/report/page.tsx');
  const sum = fn => h.tables.bookings.reduce((n,b) => n + fn(b), 0);
  assert.equal(sum(report.getPayingPeopleCount), 123);
  assert.equal(sum(b => b.total_people), 141);
  assert.equal(sum(report.getBookingIncome), 4530);
  assert.equal(sum(report.getBookingSupplierCost), 4530);
  assert.equal(sum(b => b.margin_total), 0);
});

test('new code on uncorrected database does not silently replace quantities: 69 paying, invoice 2590', async () => {
  const h = harness(structuredClone(snapshot.bookings));
  const page = await h.load('app/fatturazione-fmdq/page.tsx').default({ searchParams: Promise.resolve({ month: '2026-09' }) });
  const report = nodes(page).find(node => node.props?.totalInvoice !== undefined);
  assert.equal(report.props.totalAdults, 69); assert.equal(report.props.totalInvoice, 2590);
  assert.equal(h.writes.length, 0);
});

test('eight payers plus an infant contradict eight total clients: no discount', () => {
  const row = finalRows().find(b => b.id === 1985); row.infants = 1;
  assert.equal(evidence([row]).size, 0);
});

const pglite = resolve('.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js');
test('SQL in memory: 15 updates, rerun, guards/rollback, sources and all other fields preserved',
  { skip: !existsSync(pglite) }, async () => {
  const { PGlite } = await import(pathToFileURL(pglite).href); const db = await PGlite.create();
  const fields = Object.keys(targets[0].before);
  const type = key => key === 'booking_date' ? 'date' : key === 'is_cancelled' ? 'boolean'
    : ['booking_reference','total_to_you_source','customer_payment_status','supplier_payment_status'].includes(key) ? 'text' : 'numeric';
  try {
    await db.exec(`create table bookings(${fields.map(key => `${key} ${type(key)}`).join(',')}, untouched text default 'preserve');
      create table google_calendar_import_staging(id bigint primary key,gcal_uid text,booking_date date,channel_id int,original_title text,import_status text,imported_booking_id bigint);
      create table fmdq_monthly_invoices(id int, invoice_number text, is_invoiced boolean);
      insert into fmdq_monthly_invoices values (20,'FPR 54/26',true);`);
    async function reset() {
      await db.exec('truncate bookings,google_calendar_import_staging;');
      for (const row of targets) {
        await db.query(`insert into bookings(${fields.join(',')}) values (${fields.map((_,i) => '$'+(i+1)).join(',')})`, fields.map(k => row.before[k]));
        await db.query('insert into google_calendar_import_staging values ($1,$2,$3,$4,$5,$6,$7)',
          ['id','gcal_uid','booking_date','channel_id','original_title','import_status','imported_booking_id'].map(k => row.staging[k]));
      }
    }
    await reset();
    const publicBefore = (await db.query('select id,pax,total_customer,total_amount,public_unit_price,supplier_amount_paid,customer_payment_status,supplier_payment_status,untouched from bookings order by id')).rows;
    const sourceBefore = (await db.query('select * from google_calendar_import_staging order by id')).rows;
    const invoiceBefore = (await db.query('select * from fmdq_monthly_invoices')).rows;
    await db.exec(migration);
    const final = (await db.query('select * from bookings order by id')).rows;
    for (const target of targets) {
      const actual = final.find(b => Number(b.id) === target.after.id);
      for (const key of fields) assert.equal(type(key) === 'numeric' && actual[key] !== null ? Number(actual[key])
        : key === 'booking_date' ? actual[key].toISOString().slice(0,10) : actual[key], target.after[key], `${actual.id}.${key}`);
    }
    assert.equal(targets.filter(t => JSON.stringify(t.before) !== JSON.stringify(t.after)).length, 15);
    assert.deepEqual((await db.query('select id,pax,total_customer,total_amount,public_unit_price,supplier_amount_paid,customer_payment_status,supplier_payment_status,untouched from bookings order by id')).rows, publicBefore);
    assert.deepEqual((await db.query('select * from google_calendar_import_staging order by id')).rows, sourceBefore);
    assert.deepEqual((await db.query('select * from fmdq_monthly_invoices')).rows, invoiceBefore);
    await db.exec(migration); assert.deepEqual((await db.query('select * from bookings order by id')).rows, final);
    for (const change of ["delete from bookings where id=2227", "update bookings set adults=3 where id=2227",
      "update bookings set booking_date='2026-09-28' where id=2227", "update bookings set channel_id=8 where id=2227",
      "update bookings set is_cancelled=true where id=2227", "update bookings set children=1 where id=2227",
      "update bookings set infants=1 where id=2227", "update bookings set total_to_you=999 where id=2227",
      "update bookings set total_customer=999 where id=2227", "update bookings set agreed_unit_price=30 where id=2227",
      "update bookings set pax=99 where id=2227", "update bookings set supplier_payment_status='paid' where id=2227",
      "update google_calendar_import_staging set original_title='9 pranzo Tuscan Escape' where id=656",
      "update google_calendar_import_staging set import_status='gcal_cancelled' where id=656"]) {
      await reset(); await db.exec(change); const before = (await db.query('select * from bookings order by id')).rows;
      await assert.rejects(db.exec(migration)); await db.exec('rollback');
      assert.deepEqual((await db.query('select * from bookings order by id')).rows, before);
    }
    await reset();
    await db.exec("create function unexpected() returns trigger language plpgsql as 'begin return new; end;'; create trigger unexpected before update on bookings for each row execute function unexpected();");
    await assert.rejects(db.exec(migration), /triggers\/rules/); await db.exec('rollback');
  } finally { await db.close(); }
});
