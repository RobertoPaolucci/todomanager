import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(path, overrides = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports, console, ...globals,
    require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts');
      return require(name);
    },
  });
  return loaded.exports;
}
const { buildDashboardAgenda } = load('lib/dashboard-agenda.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id, date, time = '10:00:00', experience = 1) => ({ id, booking_date: date, booking_time: time,
  experience_id: experience, experience_name: `Esperienza ${experience}`, customer_name: `Cliente ${id}`,
  total_people: 4, booking_source: 'VIATOR', customer_payment_status: 'unpaid', is_cancelled: false });

test('only three Rome calendar days, including month/year and DST boundaries', () => {
  for (const [now, expected] of [
    ['2026-09-25T22:30:00Z', ['2026-09-26', '2026-09-27', '2026-09-28']],
    ['2026-12-31T12:00:00Z', ['2026-12-31', '2027-01-01', '2027-01-02']],
    ['2026-03-28T12:00:00Z', ['2026-03-28', '2026-03-29', '2026-03-30']],
    ['2026-10-24T12:00:00Z', ['2026-10-24', '2026-10-25', '2026-10-26']],
  ]) assert.deepEqual(plain(buildDashboardAgenda([], new Date(now)).map(d => d.date)), expected);
});

test('filters cancelled/outside dates; groups per day and experience, ordered by time without changing rows', () => {
  const rows = [row(9, '2026-09-28'), row(6, '2026-09-26', null), row(3, '2026-09-26', '11:00:00'),
    row(2, '2026-09-26', '09:00:00', 2), row(1, '2026-09-26'), row(4, '2026-09-26'),
    row(10, '2026-09-29'), row(11, '2026-09-25'), row(12, null),
    { ...row(13, '2026-09-26'), is_cancelled: true }];
  const before = structuredClone(rows);
  const days = buildDashboardAgenda(rows, new Date('2026-09-26T12:00:00Z'));
  assert.deepEqual(plain(days.map(d => d.experiences.map(g => g.bookings.map(b => b.id)))), [[[2], [1, 4, 3, 6]], [], [[9]]]);
  assert.equal(days[0].experiences[1].bookings[0], rows[4]);
  assert.deepEqual(rows, before);
});

test('missing experience IDs group by name, distinct IDs remain separate', () => {
  const rows = [1, 2, 3, 4].map(id => ({ ...row(id, '2026-09-26'), experience_name: 'Tour', experience_id: id < 3 ? null : id }));
  assert.deepEqual(plain(buildDashboardAgenda(rows, new Date('2026-09-26'))[0].experiences.map(g => g.bookings.length)), [2, 1, 1]);
});

test('dashboard consumes all pages, deduplicates and preserves agenda links, pax, channels and payment status', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(i + 1, '2020-01-01'));
  rows.push({ ...row(1001, '2026-09-26'), booking_reference: 'REVISED' },
    row(1002, '2026-09-28'), { ...row(1003, '2026-09-27'), customer_payment_status: 'paid' },
    row(1004, '2026-09-29'), { ...row(1005, '2026-09-26'), booking_reference: 'REVISED', is_cancelled: true },
    row(1006, '2026-09-26'));
  const ranges = [];
  const db = { from(table) {
    const query = { select() { return query; }, order() { return query; }, gte() { return query; }, lt() { return query; },
      neq() { return query; }, not() { return query; }, eq() { return query; }, in() { return query; }, limit() { return query; },
      range(from, to) { if (table === 'bookings') ranges.push([from, to]); return Promise.resolve({ data: table === 'bookings' ? rows.slice(from, to + 1) : [], error: null }); },
      then(ok, fail) { return Promise.resolve({ data: [], error: null }).then(ok, fail); },
    }; return query;
  } };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-25T22:30:00Z'])); } }
  const Page = load('app/page.tsx', {
    'next/link': { default: 'a' }, '@/lib/supabase-server': { supabaseServer: db },
    '@/lib/dashboard': { getDashboardStats: async () => ({ bookingsByChannel: [], channelStartDate: null }) },
    '@/components/AppShell': { default: ({ children }) => children },
    '@/components/SectionCard': { default: ({ title, children }) => createElement('section', null, createElement('h2', null, title), children) },
    '@/components/NotificationCenter': { default: () => null },
    '@/components/CognanelloAvailabilityNotifications': { default: () => null },
  }, { Date: FixedDate }).default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  const agenda = html.slice(html.indexOf('<h2>Agenda'));
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.ok(agenda.includes('Agenda (Prossimi 3 giorni)'));
  assert.ok(agenda.indexOf('OGGI') < agenda.indexOf('DOMANI'));
  assert.ok(agenda.indexOf('DOMANI') < agenda.indexOf('DOPODOMANI'));
  for (const id of [1002, 1003, 1006]) {
    assert.equal(agenda.split(`href="/prenotazioni?highlight=${id}"`).length - 1, 2);
    assert.equal(agenda.split(`href="/prenotazioni/${id}/modifica"`).length - 1, 2);
  }
  for (const id of [1001, 1004, 1005]) assert.ok(!agenda.includes(`highlight=${id}`));
  assert.equal((agenda.match(/>Pagato</g) || []).length, 2);
  assert.equal((agenda.match(/>Incassa</g) || []).length, 4);
  assert.equal((agenda.match(/>VIATOR</g) || []).length, 6);
  assert.equal((agenda.match(/>4 pax</g) || []).length, 3);
  assert.equal((agenda.match(/>4<\/div>/g) || []).length, 3);
});
