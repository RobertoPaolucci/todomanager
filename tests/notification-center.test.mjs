import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync('components/NotificationCenter.tsx', 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

const listModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync('components/NotificationCenterList.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  module: listModule, exports: listModule.exports,
  require(name) {
    if (name === 'next/link') return { default: 'a' };
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
    if (name === '@/app/booking-cancellation-alert-actions') return {};
    if (name === '@/lib/dashboard-alert-session') return { withDashboardAlertSession: action => action() };
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected client dependency: ${name}`);
  },
});

async function render(rows, { viewError = false, bookingError = false } = {}) {
  const before = structuredClone(rows);
  let table;
  const query = {
    select(fields) {
      const selected = fields.split(',').map(s => s.trim());
      assert.ok(selected.includes('is_cancelled'));
      assert.ok(selected.includes('id'));
      return query;
    },
    not() { return query; },
    async order() {
      if ((table === 'booking_dashboard_alerts' && viewError) || (table === 'bookings' && bookingError)) {
        return { data: null, error: { message: 'Unavailable' } };
      }
      return { data: structuredClone(rows).map(row => {
        if (table === 'bookings') {
          delete row.dashboard_event_version;
          delete row.dashboard_acknowledged;
        }
        return row;
      }), error: null };
    },
  };
  const loadedModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loadedModule, exports: loadedModule.exports,
    require(name) {
      if (name === 'next/link') return { default: 'a' };
      if (name === '@/components/NotificationCenterList') return listModule.exports;
      if (name === '@/lib/supabase-server') return {
        supabaseServer: { from(name) {
          assert.ok(['bookings', 'booking_dashboard_alerts'].includes(name));
          table = name;
          return query;
        } },
      };
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
  });
  const html = renderToStaticMarkup(await loadedModule.exports.default());
  assert.deepEqual(rows, before);
  return html;
}

test('Eva restored is hidden, actual cancellation remains and distinct Valer bookings both remain', async () => {
  const rows = [
    { id: 2100, customer_name: 'Eva', notes: '🔴 Prenotazione cancellata', is_cancelled: false },
    { id: 1717, notes: '🔴 Prenotazione cancellata', is_cancelled: true },
    ...[2106, 2107].map(id => ({ id, booking_reference: 'GYGG45NY7H58',
      customer_name: 'Valer Odi', notes: '🟢 Nuova prenotazione', is_cancelled: false })),
  ];
  const html = await render(rows);
  assert.ok(!html.includes('href="/prenotazioni?highlight=2100"'));
  for (const id of [1717, 2106, 2107]) assert.ok(html.includes(`href="/prenotazioni?highlight=${id}"`));
  assert.ok(html.includes('3 Avvisi'));
});

test('persisted read receipts hide only one version and refresh the counter on every server render', async () => {
  const rows = [1717, 1718].map(id => ({ id, notes: '🔴 Prenotazione cancellata', is_cancelled: true,
    dashboard_event_version: `v1:${'a'.repeat(32)}`, dashboard_acknowledged: false }));
  assert.match(await render(rows), /2 Avvisi/);
  rows[0].dashboard_acknowledged = true;
  for (let reload = 0; reload < 3; reload++) {
    const html = await render(rows);
    assert.match(html, /1 Avviso/);
    assert.doesNotMatch(html, /highlight=1717/);
    assert.match(html, /highlight=1718/);
    assert.match(html, /Apri prenotazione/);
    assert.equal((html.match(/Letto · Nascondi avviso/g) || []).length, 1);
    assert.doesNotMatch(html, /<a\b[^>]*>[\s\S]*?<button[\s\S]*?<\/a>/);
  }
});

test('missing migration keeps cancellation visible without read button and shows an accessible error', async () => {
  const html = await render([{ id: 1717, notes: '🔴 Prenotazione cancellata', is_cancelled: true }], { viewError: true });
  assert.match(html, /highlight=1717/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Presa visione temporaneamente non disponibile/);
  assert.doesNotMatch(html, /Letto · Nascondi avviso/);
});

test('booking read failure never claims there are no alerts to read', async () => {
  const html = await render([], { viewError: true, bookingError: true });
  assert.match(html, /Impossibile caricare gli avvisi/);
  assert.doesNotMatch(html, /Nessun avviso da leggere/);
});

test('cancelled green and unknown-state red/green alerts are hidden; yellow remains', async () => {
  const html = await render([
    { id: 1, notes: '🟢 Nuova prenotazione', is_cancelled: true },
    { id: 2, notes: '🔴 Prenotazione cancellata', is_cancelled: null },
    { id: 3, notes: '🟢 Nuova prenotazione', is_cancelled: null },
    { id: 4, notes: '🟡 Prenotazione modificata', is_cancelled: false },
    { id: 5, notes: 'Nota ordinaria', is_cancelled: false },
  ]);
  for (const id of [1, 2, 3, 5]) assert.ok(!html.includes(`href="/prenotazioni?highlight=${id}"`));
  assert.ok(html.includes('href="/prenotazioni?highlight=4"'));
});

test('only stale cancellation shows empty state without changing notes', async () => {
  const html = await render([{ id: 2100, notes: '🔴 Prenotazione cancellata', is_cancelled: false }]);
  assert.ok(html.includes('Nessun avviso da leggere'));
  assert.ok(!html.includes('Prenotazione cancellata'));
});

test('new booking cards open the list highlighting their own row IDs even with a shared booking reference', async () => {
  const rows = [
    { id: 2106, customer_name: 'Cliente prima card', experience_name: 'Tour mattina' },
    { id: 2107, customer_name: 'Cliente seconda card', experience_name: 'Tour pomeriggio' },
  ].map(row => ({ ...row, booking_reference: 'SHARED-REFERENCE',
    notes: '🟢 Nuova prenotazione', is_cancelled: false }));
  const html = await render(rows);
  const cards = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card[1]), [
    '/prenotazioni?highlight=2106', '/prenotazioni?highlight=2107',
  ]);
  for (const [index, card] of cards.entries()) {
    assert.ok(card[2].includes(rows[index].customer_name));
    assert.ok(card[2].includes(rows[index].experience_name));
    assert.ok(card[2].includes('Nuova prenotazione'));
    assert.ok(card[2].includes('<svg'));
    assert.doesNotMatch(card[2], /<(?:a|button|input|form)\b/);
  }
});
