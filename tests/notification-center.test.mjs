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

async function render(rows) {
  const before = structuredClone(rows);
  const query = {
    select(fields) {
      assert.ok(fields.split(',').map(s => s.trim()).includes('is_cancelled'));
      return query;
    },
    not() { return query; },
    async order() { return { data: structuredClone(rows), error: null }; },
  };
  const loadedModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loadedModule, exports: loadedModule.exports,
    require(name) {
      if (name === 'next/link') return { default: 'a' };
      if (name === '@/lib/supabase-server') return {
        supabaseServer: { from(table) { assert.equal(table, 'bookings'); return query; } },
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
  assert.ok(!html.includes('highlight=2100'));
  for (const id of [1717, 2106, 2107]) assert.ok(html.includes(`highlight=${id}`));
  assert.ok(html.includes('3 Avvisi'));
});

test('cancelled green and unknown-state red/green alerts are hidden; yellow remains', async () => {
  const html = await render([
    { id: 1, notes: '🟢 Nuova prenotazione', is_cancelled: true },
    { id: 2, notes: '🔴 Prenotazione cancellata', is_cancelled: null },
    { id: 3, notes: '🟢 Nuova prenotazione', is_cancelled: null },
    { id: 4, notes: '🟡 Prenotazione modificata', is_cancelled: false },
    { id: 5, notes: 'Nota ordinaria', is_cancelled: false },
  ]);
  for (const id of [1, 2, 3, 5]) assert.ok(!html.includes(`highlight=${id}`));
  assert.ok(html.includes('highlight=4'));
});

test('only stale cancellation shows empty state without changing notes', async () => {
  const html = await render([{ id: 2100, notes: '🔴 Prenotazione cancellata', is_cancelled: false }]);
  assert.ok(html.includes('Nessun avviso da leggere'));
  assert.ok(!html.includes('Prenotazione cancellata'));
});
