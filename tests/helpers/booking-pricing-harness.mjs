import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Real application modules, with only framework/database/PDF drawing boundaries replaced.
export function pricingHarness() {
  const channel = { id: 22, name: 'Test agency', type: 'agency', fattura_mensile_fmdq: true };
  const experience = { id: 7, name: 'Tour della Cinta Senese con pranzo', supplier_id: 3,
    business_unit_id: 1, supplier_unit_cost: 38, is_group_pricing: false, bokun_id: '956472' };
  const price = { id: 487, experience_id: 7, channel_id: 22, your_unit_price: 38,
    your_child_unit_price: 16, public_unit_price: 0, public_child_unit_price: 0,
    supplier_adult_unit_cost: 38, supplier_child_unit_cost: 16 };
  const booking = { id: 2010, channel_id: 22, experience_id: 7, supplier_id: 3, business_unit_id: 1,
    booking_reference: 'AGY-000123', bokun_booking_reference: 'TEST-2010',
    booking_source: channel.name, experience_name: experience.name,
    customer_name: 'Local fixture', booking_created_at: '2026-09-01', booking_date: '2026-09-29', booking_time: '12:00',
    adults: 25, children: 0, infants: 0, non_paying_adults: 2, total_people: 27, pax: 27,
    your_unit_price: 38, public_unit_price: 0, supplier_unit_cost: 38,
    total_to_you: 950, total_customer: 0, total_amount: 0, total_supplier_cost: 950, margin_total: 0,
    agreed_unit_price: null, customer_payment_status: 'paid', supplier_payment_status: 'partial', supplier_amount_paid: 123,
    is_cancelled: false, notes: 'Preserve', channels: channel, suppliers: { id: 3, name: 'Fattoria Madonna della Querce' },
    experience: { is_group_pricing: false } };
  const tables = { bookings: [booking], channels: [channel], experiences: [experience], experience_channel_prices: [price],
    supplier_payments: [{ id: 1, supplier_id: 3, amount: 123, notes: 'Existing payment' }],
    business_units: [{ id: 1, code: 'fmdq' }], business_unit_internal_suppliers: [{ business_unit_id: 1, supplier_id: 3 }],
    fmdq_monthly_invoices: [], suppliers: [booking.suppliers] };
  const writes = [], pdfTexts = [], hooks = [];
  let hookIndex = 0, beforeUpdate = null;
  const db = { from(table) {
    let predicates = [], operation = 'select', payload, limit = Infinity;
    const q = {
      select() { return q; }, eq(k, v) { predicates.push(row => row[k] === v); return q; },
      is(k, v) { predicates.push(row => (row[k] ?? null) === v); return q; },
      gte(k, v) { predicates.push(row => row[k] >= v); return q; }, lte(k, v) { predicates.push(row => row[k] <= v); return q; },
      in(k, v) { predicates.push(row => v.includes(row[k])); return q; },
      order() { return q; }, limit(n) { limit = n; return q; },
      insert(value) { operation = 'insert'; payload = value; return q; },
      update(value) { operation = 'update'; payload = value; return q; },
      single() { return Promise.resolve(run(true)); }, maybeSingle() { return Promise.resolve(run(true)); },
      then(ok, fail) { return Promise.resolve().then(() => run(false)).then(ok, fail); },
    };
    function run(single) {
      if (!tables[table]) throw new Error(`Unexpected table ${table}`);
      if (operation === 'update' && beforeUpdate) { const callback = beforeUpdate; beforeUpdate = null; callback(); }
      let rows = tables[table].filter(row => predicates.every(test => test(row))).slice(0, limit);
      if (operation !== 'select') writes.push({ table, operation, payload: structuredClone(payload) });
      if (operation === 'insert') {
        const row = { id: Math.max(0, ...tables[table].map(row => row.id || 0)) + 1, ...structuredClone(payload) };
        tables[table].push(row); rows = [row];
      }
      if (operation === 'update') rows.forEach(row => Object.assign(row, structuredClone(payload)));
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
    }
    return q;
  } };
  const cache = new Map();
  function load(relative) {
    const file = resolve(relative);
    if (cache.has(file)) return cache.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('report\\page.tsx') || file.endsWith('report/page.tsx')) {
      source += '\nexport { getBookingIncome, getBookingGross, getBookingSupplierCost, getPayingPeopleCount };';
    }
    const mod = { exports: {} };
    const code = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const jsx = (type, props) => ({ type, props });
    const requireMock = name => {
      if (name === '@/lib/supabase-server') return { supabaseServer: db };
      if (name === 'next/cache') return { revalidatePath() {} };
      if (name === 'next/navigation') return { redirect(path) { throw new Error(`REDIRECT:${path}`); } };
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useMemo: fn => fn(), useEffect() {}, useState(initial) {
        const i = hookIndex++;
        if (!(i in hooks)) hooks[i] = initial;
        return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
      } };
      if (name === 'pdf-lib') return { rgb: (...args) => args, StandardFonts: { Helvetica: 'regular', HelveticaBold: 'bold' },
        PDFDocument: { async create() { return {
          async embedFont() { return { widthOfTextAtSize: (text, size) => text.length * size / 2 }; },
          addPage() { return { drawText(text) { pdfTexts.push(text); }, drawLine() {}, drawRectangle() {} }; },
          async save() { return new Uint8Array([37, 80, 68, 70]); },
        }; } } };
      if (name.startsWith('@/components/') || name === 'next/link') return { default: name };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name === './actions') return load(resolve(dirname(file), 'actions.ts'));
      throw new Error(`Unexpected import ${name}`);
    };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: requireMock,
      console: { log() {}, error() {} }, Date, Set, Map, Error, Response, Request, URL, Buffer, Uint8Array }, { filename: file });
    cache.set(file, mod.exports);
    return mod.exports;
  }
  function form(values = {}) {
    const data = new FormData();
    for (const key of ['id', 'channel_id', 'experience_id', 'booking_reference', 'customer_name',
      'booking_date', 'booking_time', 'booking_created_at', 'adults', 'children', 'infants', 'non_paying_adults', 'notes']) data.set(key, String(booking[key]));
    for (const [key, value] of Object.entries(values)) data.set(key, String(value));
    return data;
  }
  async function save(values = {}, create = false) {
    try { return await load('app/prenotazioni/actions.ts')[create ? 'createBooking' : 'updateBooking'](form(values)); }
    catch (error) { if (error.message.startsWith('REDIRECT:')) return { saved: true }; throw error; }
  }
  async function webhook(values = {}) {
    const auth = readFileSync('app/api/webhooks/prenotazioni/route.ts', 'utf8').match(/authHeader !== "([^"]+)"/)[1];
    const response = await load('app/api/webhooks/prenotazioni/route.ts').POST(new Request('http://local.test/webhook', {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ bokun_id: experience.bokun_id, bokun_booking_reference: booking.bokun_booking_reference,
        channel_id: booking.channel_id, booking_source: channel.name, adults: booking.adults, children: booking.children,
        infants: booking.infants, booking_date: booking.booking_date, customer_name: booking.customer_name,
        action: 'BOOKING_MODIFIED', ...values }),
    }));
    return { status: response.status, body: await response.json() };
  }
  function renderForm() {
    hookIndex = 0;
    return load('components/BookingForm.tsx').default({ channels: tables.channels,
      experiences: tables.experiences.map(item => ({ ...item, is_fmdq_internal_supplier: true,
        experience_channel_prices: tables.experience_channel_prices.filter(p => p.experience_id === item.id) })),
      today: '2026-09-29', initialData: booking, isEditing: true });
  }
  return { tables, booking, experience, channel, price, writes, pdfTexts, load, form, save, webhook, renderForm,
    beforeUpdate(callback) { beforeUpdate = callback; } };
}

export function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

export function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'object') return textContent(tree.props?.children);
  return String(tree);
}
