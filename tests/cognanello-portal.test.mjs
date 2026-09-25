import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const file = 'app/cognanello/page.tsx';
const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }, fileName: file,
});

function booking(id, experience_id, overrides = {}) {
  return {
    id, experience_id, channel_id: 4, booking_date: '2026-09-26',
    booking_time: '16:00:00', customer_name: 'Test customer', adults: 2,
    channel: { id: 4, name: 'Todointheworld' },
    experience: { id: experience_id, name: experience_id === 27
      ? 'Walk with goats or donkeys in Tuscany' : `Horseback option ${experience_id}` },
    ...overrides,
  };
}

async function visibleBookings(rows, filters = {}) {
  // Only read operations are provided; no live Supabase client is loaded.
  const tables = {
    bookings: rows,
    channels: [{ id: 4, name: 'Todointheworld' }, { id: 6, name: 'Fattoria Madonna della Querce' }],
  };
  const db = { from(table) {
    assert.ok(Object.hasOwn(tables, table));
    const predicates = [];
    const query = {
      select() { return query; },
      order() { return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      not(key, operator, value) {
        assert.equal(operator, 'in');
        const excluded = value.slice(1, -1).split(',').map(Number);
        predicates.push(row => !excluded.includes(row[key])); return query;
      },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      gte(key, value) { predicates.push(row => row[key] >= value); return query; },
      lte(key, value) { predicates.push(row => row[key] <= value); return query; },
      then(resolve) {
        return Promise.resolve({ data: tables[table].filter(row => predicates.every(p => p(row))), error: null }).then(resolve);
      },
    };
    return query;
  } };
  const loadedModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loadedModule, exports: loadedModule.exports, Date, Intl, URLSearchParams,
    require(name) {
      if (name === '@/lib/supabase-server') return { supabaseServer: db };
      if (name === 'react/jsx-runtime') {
        const element = (type, props) => ({ type, props });
        return { jsx: element, jsxs: element };
      }
      if (name === 'next/link' || name.startsWith('@/components/')) return { default: name };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: file });
  const tree = await loadedModule.exports.default({
    searchParams: Promise.resolve({ from: '2026-09-26', to: '2026-09-26', ...filters }),
  });
  function findList(node) {
    if (Array.isArray(node)) return node.map(findList).find(Boolean);
    if (!node || typeof node !== 'object') return null;
    if (node.type === '@/components/CognanelloBookingList') return node.props.bookings;
    return findList(node.props?.children);
  }
  return findList(tree);
}

test('Cognanello includes experience 27 alongside all existing experiences, excluding unrelated experiences', async () => {
  const rows = [booking(1, 1), booking(2, 8), booking(3, 9), booking(2240, 27), booking(5, 14)];
  const before = structuredClone(rows);
  const visible = await visibleBookings(rows);
  assert.deepEqual(Array.from(visible, row => row.id), [1, 2, 3, 2240]);
  assert.equal(visible[3].experience_name, 'Walk with goats or donkeys in Tuscany');
  assert.deepEqual(rows, before);
});

test('experience 27 still respects existing date and excluded-channel filters', async () => {
  const visible = await visibleBookings([
    booking(2240, 27),
    booking(2241, 27, { channel_id: 6 }),
    booking(2242, 27, { booking_date: '2026-09-25' }),
    booking(2243, 27, { booking_date: '2026-09-27' }),
    booking(2244, 27, { channel_id: 3 }),
  ], { channel: '4' });
  assert.deepEqual(Array.from(visible, row => row.id), [2240]);
  const excluded = await visibleBookings([booking(2241, 27, { channel_id: 6 })]);
  assert.equal(excluded.length, 0);
});
