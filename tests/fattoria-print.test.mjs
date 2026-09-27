import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports, require(name) {
    if (name in overrides) return overrides[name];
    if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts');
    if (name === './booking-display-notes') return load('lib/booking-display-notes.ts');
    return require(name);
  } });
  return loaded.exports;
}
const { togglePrintSelection, buildFattoriaPrintDocument } = load('lib/fattoria-print.ts');
const entry = (id, date = '2026-09-28') => ({ id, date, service: 'Visita + Tagliere', people: '5 persone',
  detail: '4 adulti + 1 guida', customer: `Cliente ${id}`, channel: 'Italy on a budget tours',
  notes: '1 vegetariano\n1 no glutine, no latticini; allergia alle noci; 1 vegano' });
const entries = [entry(1), entry(2), entry(3, '2026-09-29')];
const plain = value => JSON.parse(JSON.stringify(value));

test('selects distinct IDs with identical service/count, deselects and prevents mixed dates', () => {
  let selected = togglePrintSelection([], entries[0], entries);
  selected = togglePrintSelection(selected, entries[1], entries);
  assert.deepEqual(plain(selected), [1, 2]);
  assert.equal(togglePrintSelection(selected, entries[2], entries), selected);
  selected = togglePrintSelection(selected, entries[0], entries);
  assert.deepEqual(plain(selected), [2]);
  selected = togglePrintSelection(selected, entries[1], entries);
  assert.deepEqual(plain(togglePrintSelection(selected, entries[2], entries)), [3]);
});

test('A4 contains only selected bookings, date, participants, guides and all dietary notes', () => {
  const html = buildFattoriaPrintDocument(entries, [2]);
  for (const text of ['28/09/2026', '5 persone', '4 adulti + 1 guida', 'Visita + Tagliere',
    'Cliente 2', 'Italy on a budget tours', 'vegetariano', 'no glutine', 'no latticini', 'noci', 'vegano',
    '@media print', 'A4 portrait', 'break-inside: avoid']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Cliente 1|Cliente 3|<input|<button|<nav|<aside/);
  const multiple = buildFattoriaPrintDocument(entries, [1, 2]);
  assert.equal((multiple.match(/<article>/g) || []).length, 2);
  assert.ok(multiple.includes('Cliente 1') && multiple.includes('Cliente 2'));
  assert.ok(!multiple.includes('Cliente 3'));
  assert.equal(buildFattoriaPrintDocument(entries, []), null);
  assert.equal(buildFattoriaPrintDocument(entries, [1, 3]), null);
  assert.equal(buildFattoriaPrintDocument(entries, [999]), null);
});

test('missing fields invent nothing, duplicate names suppressed, notes safely escaped', () => {
  const html = buildFattoriaPrintDocument([{ ...entry(1), customer: 'Tuscan Escape', channel: 'Tuscan Escape',
    notes: '<script>alert(1)</script>\nPrenotazione cancellata\nPortare acqua & pane' }], [1]);
  assert.equal(html.split('Tuscan Escape').length - 1, 1);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('acqua &amp; pane'));
  assert.doesNotMatch(html, /<script>|Prenotazione cancellata/);
  const empty = buildFattoriaPrintDocument([{ ...entry(1), notes: null, customer: '', channel: '', detail: '' }], [1]);
  assert.doesNotMatch(empty, /vegetariano|guida|Cliente|class="notes"/);
});

// Follow the existing VM-based component tests, with state preserved between renders.
function harness() {
  const state = [];
  let index = 0;
  let context;
  const components = load('components/FattoriaPrintSelection.tsx', { react: {
    createContext: () => ({ Provider: 'provider' }), useContext: () => context,
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
  } });
  return {
    render() {
      index = 0;
      const tree = components.FattoriaPrintSelection({ entries, children: null });
      context = tree.props.value;
      return tree;
    },
    checkbox(row) { return components.FattoriaPrintCheckbox({ id: row.id, date: row.date, label: row.service }); },
  };
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}

test('checkbox events select/deselect without navigation; other dates disabled; reset and remount clear state', () => {
  const h = harness();
  h.render();
  let checkbox = h.checkbox(entries[0]);
  let stopped = false;
  checkbox.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(checkbox.type, 'label'); // no enclosing link, router or navigation callback
  nodes(checkbox, 'input')[0].props.onChange();
  h.render();
  assert.equal(nodes(h.checkbox(entries[0]), 'input')[0].props.checked, true);
  assert.equal(nodes(h.checkbox(entries[2]), 'input')[0].props.disabled, true);
  nodes(h.checkbox(entries[1]), 'input')[0].props.onChange();
  let tree = h.render();
  assert.deepEqual(plain(tree.props.value.selected), [1, 2]);
  nodes(h.checkbox(entries[0]), 'input')[0].props.onChange();
  tree = h.render();
  assert.deepEqual(plain(tree.props.value.selected), [2]);
  nodes(tree, 'button')[1].props.onClick();
  assert.deepEqual(plain(h.render().props.value.selected), []);
  assert.deepEqual(plain(harness().render().props.value.selected), []);
});

test('print button blocks empty print and sends only selected HTML to the printable iframe', () => {
  const h = harness();
  nodes(h.render(), 'button')[0].props.onClick();
  let tree = h.render();
  assert.equal(nodes(tree, 'iframe').length, 0);
  assert.ok(nodes(tree, 'p').some(p => p.props.children === "Seleziona almeno un'esperienza da stampare."));
  nodes(h.checkbox(entries[1]), 'input')[0].props.onChange();
  nodes(h.render(), 'button')[0].props.onClick();
  tree = h.render();
  const frame = nodes(tree, 'iframe')[0];
  assert.ok(frame.props.srcDoc.includes('Cliente 2'));
  assert.ok(!frame.props.srcDoc.includes('Cliente 1'));
  let prints = 0;
  frame.props.onLoad({ currentTarget: { contentWindow: { focus() {}, print() { prints++; } } } });
  assert.equal(prints, 1);
  nodes(tree, 'button')[0].props.onClick();
  assert.notEqual(nodes(h.render(), 'iframe')[0].key, frame.key);
});

test('selection has no database, network or persistent storage dependencies', () => {
  const source = readFileSync('components/FattoriaPrintSelection.tsx', 'utf8') + readFileSync('lib/fattoria-print.ts', 'utf8');
  assert.doesNotMatch(source, /supabase|fetch\(|localStorage|sessionStorage|cookie|\/actions/);
});

test('calendar retains links, colors, tooltips, navigation, latest versions and counts; loads notes read-only', async () => {
  const rows = [1, 2, 3].map(id => ({ id, booking_date: '2026-09-28', experience_id: 10,
    adults: 4, non_paying_adults: 1, customer_name: `Cliente ${id}`, notes: '1 vegetariano', channels: { name: 'Agenzia' } }));
  rows.push({ ...rows[0], id: 4, booking_reference: 'OLD' }, { ...rows[0], id: 5, booking_reference: 'OLD', is_cancelled: true });
  let printEntries;
  const db = { from(table) {
    const query = {
      select(fields) { if (table === 'bookings') assert.ok(fields.split(', ').includes('notes')); return query; },
      order() { return query; },
      range() { return Promise.resolve({ data: rows }); },
      in() { return Promise.resolve({ data: [{ id: 10, bokun_id: '1196268' }] }); },
    };
    return query;
  } };
  const Page = load('app/calendario-fattoria/page.tsx', {
    'next/link': { default: ({ prefetch, ...props }) => { assert.equal(prefetch, false); return createElement('a', props); } },
    '@/lib/supabase-server': { supabaseServer: db },
    '@/components/AppShell': { default: ({ children }) => children },
    '@/components/FattoriaPrintSelection': {
      FattoriaPrintSelection: ({ entries, children }) => { printEntries = entries; return children; },
      FattoriaPrintCheckbox: ({ id }) => createElement('input', { type: 'checkbox', 'data-id': id }),
    },
  }).default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ mese: '2026-09' }) }));
  for (const id of [1, 2, 3]) {
    assert.match(html, new RegExp(`<input[^>]*data-id="${id}"[^>]*><a[^>]*href="/prenotazioni/${id}/modifica"`));
    assert.ok(html.includes(`booking-tooltip-${id}`));
  }
  assert.ok(html.includes('border-teal-200 bg-teal-50 text-teal-900'));
  assert.ok(html.includes('3 tavoli, 15 persone'));
  assert.ok(html.includes('/calendario-fattoria?mese=2026-08'));
  assert.ok(html.includes('/calendario-fattoria?mese=2026-10'));
  assert.ok(!html.includes('/prenotazioni/4/modifica'));
  assert.ok(!html.includes('/prenotazioni/5/modifica'));
  assert.deepEqual(plain(printEntries.map(e => e.id)), [1, 2, 3]);
  assert.equal(printEntries[0].detail, '4 adulti + 1 guida');
  assert.equal(printEntries[0].notes, '1 vegetariano');
});
