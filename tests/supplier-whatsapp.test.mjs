import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual page/card code; database reads and UI dependencies are mocked.
// No database writes, network access or WhatsApp windows are available here.
const compiled = new Map();
function load(file, booking) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      }, fileName: file,
    }).outputText);
  }
  const loadedModule = { exports: {} };
  const db = { from(table) {
    assert.ok(['bookings', 'business_unit_internal_suppliers', 'business_units'].includes(table));
    let columns = '';
    const read = () => {
      if (table !== 'bookings') return [];
      const row = structuredClone(booking);
      // Honor supplier projection so pages must actually request the supplier name.
      const supplierFields = columns.match(/suppliers\(([^)]+)\)/)?.[1].split(',').map(s => s.trim());
      if (supplierFields && row.suppliers) {
        const project = supplier => Object.fromEntries(supplierFields.map(key => [key, supplier[key]]));
        row.suppliers = Array.isArray(row.suppliers) ? row.suppliers.map(project) : project(row.suppliers);
      }
      return [row];
    };
    const query = {
      select(value) { columns = value; return query; },
      eq() { return query; }, in() { return query; }, order() { return query; },
      async range() { return { data: read(), error: null }; },
      async single() { return { data: read()[0], error: null }; },
      then(resolve) { return Promise.resolve({ data: read(), error: null }).then(resolve); },
    };
    return query;
  } };
  const requireMock = name => {
    if (name === 'react/jsx-runtime') {
      const element = (type, props) => ({ type, props });
      return { jsx: element, jsxs: element, Fragment: 'fragment' };
    }
    if (name === 'react') return { useState: () => [false, () => {}] };
    if (name === '@/lib/supabase-server') return { supabaseServer: db };
    if (name === '@/lib/queries') return { getChannels: async () => [], getExperiences: async () => [] };
    if (['./actions', '@/app/prenotazioni/actions'].includes(name)) return {};
    if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts', booking);
    if (name === 'next/link' || name.startsWith('@/components/')) return { default: name };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  vm.runInNewContext(compiled.get(file), {
    module: loadedModule, exports: loadedModule.exports, require: requireMock, console, Date, Intl, URLSearchParams,
  }, { filename: file });
  return loadedModule.exports;
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...elements(tree.props.children)];
}

const fixture = {
  id: 2240, experience_id: 27, experience_name: 'Walk with goats or donkeys in Tuscany',
  supplier_id: 10, suppliers: { id: 10, name: 'Cognanello', phone: '+39 333 000 0000' },
  customer_name: 'Mario Rossi', booking_date: '2026-09-26', booking_time: '16:00:00',
  booking_created_at: '2026-09-25', booking_reference: 'TOD-T147665882',
  bokun_booking_reference: 'TOD-104921603', business_unit_id: 2,
  adults: 2, children: 1, infants: 1, non_paying_adults: 1, total_people: 5,
  channels: { name: 'Todointheworld' }, is_cancelled: false,
};
const oldMessage = '3 da te 26/09/2026 ore 16:00 Todointheworld TOD-T147665882 Mario Rossi';
const entryPoints = [
  ['desktop', 'app/prenotazioni/page.tsx', { searchParams: Promise.resolve({ past: 'true' }) }],
  ['mobile', 'components/MobileBookingCard.tsx', { todayStr: '2026-09-25', tomorrowStr: '2026-09-26' }],
  ['nuova', 'app/prenotazioni/nuova/page.tsx', { searchParams: Promise.resolve({ saved: '1', bookingId: '2240' }) }],
  ['modifica', 'app/prenotazioni/[id]/modifica/page.tsx', { params: Promise.resolve({ id: '2240' }), searchParams: Promise.resolve({}) }],
];

for (const [label, file, props] of entryPoints) {
  for (const experience_name of ['Horseback Riding', 'Walk with goats or donkeys in Tuscany']) {
    for (const asArray of [false, true]) {
      test(`${label}: ${experience_name}, supplier relation ${asArray ? 'array' : 'object'}`, async () => {
        const booking = { ...fixture, experience_name, suppliers: asArray ? [fixture.suppliers] : fixture.suppliers };
        const before = structuredClone(booking);
        const tree = await load(file, booking).default({ ...props, booking });
        const links = elements(tree).filter(node => node.type === 'a' && node.props.href?.startsWith('https://api.whatsapp.com/'));
        assert.equal(links.length, 1);
        const url = new URL(links[0].props.href);
        assert.equal(url.searchParams.get('text'), `${experience_name}\n${oldMessage}`);
        assert.equal(url.searchParams.get('phone'), '393330000000');
        assert.deepEqual(booking, before);
      });
    }
  }
  test(`${label}: another supplier keeps the original message`, async () => {
    const booking = { ...fixture, suppliers: { ...fixture.suppliers, name: 'Altro fornitore' } };
    const tree = await load(file, booking).default({ ...props, booking });
    const link = elements(tree).find(node => node.props.href?.startsWith('https://api.whatsapp.com/'));
    assert.equal(new URL(link.props.href).searchParams.get('text'), oldMessage);
  });
}

const summaryFile = 'app/prenotazioni/riepilogo/page.tsx';
const summaryDetails = '5 posti | 2 adulti + 1 bambino + 1 infante + 1 guida | 26/09/2026 ore 16:00 | Mario Rossi | TOD-T147665882 | Todointheworld';
for (const experience_name of ['Horseback Riding', 'Walk with goats or donkeys in Tuscany']) {
  test(`summary: Cognanello ${experience_name} moves to its own line, preserving all details`, async () => {
    const booking = { ...fixture, experience_name };
    const tree = await load(summaryFile, booking).default({ searchParams: Promise.resolve({ ids: '2240' }) });
    const message = elements(tree).find(node => node.type === '@/components/SendSummaryWhatsAppButton').props.message;
    assert.ok(message.includes(`\n${experience_name}\n${summaryDetails} | prenotata il 25/09/2026\n`));
    assert.equal(message.split(experience_name).length - 1, 1);
    assert.ok(message.endsWith('Numero di prenotazioni: 1\nPosti totali: 5'));
  });
}

test('summary: another supplier keeps the inline experience and Cognanello portal still has no send button', async () => {
  const booking = { ...fixture, suppliers: { ...fixture.suppliers, name: 'Altro fornitore' } };
  const page = load(summaryFile, booking).default;
  const tree = await page({ searchParams: Promise.resolve({ ids: '2240' }) });
  const message = elements(tree).find(node => node.type === '@/components/SendSummaryWhatsAppButton').props.message;
  assert.ok(message.includes(`${summaryDetails} | ${booking.experience_name} | prenotata il 25/09/2026`));
  const portalTree = await page({ searchParams: Promise.resolve({ ids: '2240', source: 'cognanello' }) });
  assert.equal(elements(portalTree).some(node => node.type === '@/components/SendSummaryWhatsAppButton'), false);
});

test('Cognanello uses arbitrary real experience names, preserves URL encoding and tolerates missing data', async () => {
  const file = 'components/MobileBookingCard.tsx';
  for (const experience_name of ['Tour con asini & capre: novità', null, '']) {
    const booking = { ...fixture, experience_name, suppliers: { name: 'Agriturismo Cognanello', phone: '' } };
    const tree = load(file, booking).default({ booking });
    const link = elements(tree).find(node => node.props.href?.startsWith('https://api.whatsapp.com/'));
    const url = new URL(link.props.href);
    assert.equal(url.searchParams.get('text'), experience_name ? `${experience_name}\n${oldMessage}` : oldMessage);
    assert.equal(url.searchParams.has('phone'), false);
  }
});
