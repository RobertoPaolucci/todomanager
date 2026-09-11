import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function harness(booking) {
  const before = structuredClone(booking);
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022 },
    });
    const loaded = { exports: {} };
    vm.runInNewContext(outputText, {
      exports: loaded.exports, module: loaded, console, URLSearchParams,
      require(name) {
        if (['react', 'react/jsx-runtime'].includes(name)) return require(name);
        if (name === 'next/link') return { default: 'a' };
        if (name.startsWith('@/lib/') && name !== '@/lib/supabase-server') return load(name.replace('@/', '') + '.ts');
        if (name === './actions' || name === '@/app/prenotazioni/actions') {
          return { cancelBooking: '/test-cancel', restoreBooking: '/test-restore', clearAlert: '/test-clear' };
        }
        if (name === '@/lib/supabase-server') return { supabaseServer: {
          from(table) {
            const result = { data: table === 'bookings' ? structuredClone(Array.isArray(booking) ? booking : [booking]) : [], error: null };
            const query = {
              select() { return query; }, order() { return query; },
              async range() { return result; },
              then(ok, fail) { return Promise.resolve(result).then(ok, fail); },
            };
            return query;
          },
        } };
        if (['@/components/AppShell', '@/components/SectionCard'].includes(name)) {
          return { default: ({ children }) => children };
        }
        if (name.startsWith('@/components/')) return { default: () => null };
        throw Error(`Unexpected dependency: ${name}`);
      },
    });
    cache.set(path, loaded.exports);
    return loaded.exports;
  }
  return {
    async desktop(searchParams = { past: 'true' }) {
      const Page = load('app/prenotazioni/page.tsx').default;
      const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
      assert.deepEqual(booking, before);
      return html;
    },
    mobile() {
      const Card = load('components/MobileBookingCard.tsx').default;
      const html = renderToStaticMarkup(createElement(Card, {
        booking, todayStr: '2026-09-10', tomorrowStr: '2026-09-11',
      }));
      assert.deepEqual(booking, before);
      return html;
    },
  };
}

for (const [id, cancelled] of [[2100, false], [2092, false], [2033, false], [1717, true], [2106, true]]) {
  test(`booking ${id}: status and existing actions follow is_cancelled=${cancelled} on desktop/mobile`, async () => {
    const h = harness({ id, customer_name: `Customer ${id}`, booking_date: '2026-09-11',
      is_cancelled: cancelled, notes: '🔴 Prenotazione cancellata\nPortare scarpe chiuse' });
    const desktop = await h.desktop();
    const mobile = h.mobile();
    for (const html of [desktop, mobile]) {
      assert.equal(html.includes('Prenotazione cancellata'), cancelled);
      assert.ok(html.includes('Portare scarpe chiuse'));
      assert.equal(html.includes('>Cancella</button>'), !cancelled);
      assert.equal(html.includes('action="/test-cancel"'), !cancelled);
    }
    assert.equal(desktop.includes('>Ripristina</button>'), cancelled);
    assert.equal(desktop.includes('action="/test-restore"'), cancelled);
  });
}

for (const notes of [null, 'Portare scarpe chiuse', '🟢 Nuova prenotazione']) {
  test(`cancelled booking has status even without cancellation note: ${notes}`, async () => {
    const h = harness({ id: 1717, is_cancelled: true, notes });
    for (const html of [await h.desktop(), h.mobile()]) {
      assert.ok(html.includes('Prenotazione cancellata'));
      if (notes) assert.ok(html.includes(notes));
    }
  });
}

test('ordinary operational notes, including red warnings, retain their text and alert styling', async () => {
  const notes = '🔴 Attenzione: allergia\nConfermare punto di incontro';
  const h = harness({ id: 2100, is_cancelled: false, notes });
  for (const html of [await h.desktop(), h.mobile()]) {
    assert.ok(html.includes(notes));
    assert.ok(html.includes('Segna come letto'));
    assert.ok(!html.includes('Prenotazione cancellata'));
  }
});

test('highlight moves only the requested row first in both mobile and desktop lists', async () => {
  const rows = [
    { id: 1, booking_date: '2026-01-01', notes: '🟢 Nuova prenotazione' },
    { id: 2, booking_date: '2026-02-01', notes: '🟢 Nuova prenotazione' },
    { id: 3, booking_date: '2026-03-01', notes: null },
    { id: 4, booking_date: '2026-04-01', notes: null },
  ].map(row => ({ ...row, customer_name: `Cliente ${row.id}`, is_cancelled: false }));
  const h = harness(rows);
  function assertOrder(html, expected) {
    // Selection checkboxes are rendered once in the mobile list and once in the desktop table.
    const ids = [...html.matchAll(/<input\b[^>]*name="ids"[^>]*value="(\d+)"/g)].map(match => Number(match[1]));
    assert.deepEqual(ids, [...expected, ...expected]);
  }
  assertOrder(await h.desktop(), [1, 2, 3, 4]);
  assertOrder(await h.desktop({ past: 'true', highlight: '2' }), [2, 1, 3, 4]);
  assertOrder(await h.desktop({ past: 'true', highlight: '4' }), [4, 1, 2, 3]);
  assertOrder(await h.desktop({ past: 'true', highlight: '999' }), [1, 2, 3, 4]);
  const html = await h.desktop({ highlight: '2', from: '2099-01-01' });
  assertOrder(html, [2]);
  assert.ok(html.includes('🟢 Nuova prenotazione'));
  assert.ok(html.includes('Segna come letto'));
});

test('highlight identifies an exact historical row even when its reference is shared', async () => {
  const rows = [1, 2, 3].map(id => ({ id, booking_reference: 'SHARED',
    customer_name: `Cliente ${id}`, booking_date: '2026-01-01', is_cancelled: false }));
  const html = await harness(rows).desktop({ past: 'true', highlight: '1' });
  const ids = [...html.matchAll(/<input\b[^>]*name="ids"[^>]*value="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(ids, [1, 3, 2, 1, 3, 2]);
});
