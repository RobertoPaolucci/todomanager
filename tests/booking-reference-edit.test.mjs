import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { pricingHarness, nodes, textContent } from './helpers/booking-pricing-harness.mjs';

function fixture(channel = { name: 'Fattoria Madonna della Querce', type: 'fmdq' }) {
  const requests = [];
  const h = pricingHarness({ runEffects: true, fetch: async url => {
    requests.push(url);
    return Response.json({ reference: 'FMDQ-000017' });
  } });
  Object.assign(h.channel, channel, { id: 6 });
  h.price.channel_id = 6;
  Object.assign(h.booking, {
    id: 2376, customer_name: 'Loretta Montanez', channel_id: 6,
    booking_reference: null, bokun_booking_reference: 'TOD-107115145',
    bokun_id: 'external-id', booking_source: 'Original Bókun source',
    booking_date: '2027-06-06', booking_time: '11:30',
    customer_phone: null, customer_email: null,
  });
  return { ...h, requests };
}

const input = (tree, name) => nodes(tree).find(node => node.props?.name === name);

for (const channel of [
  { name: 'Fattoria Madonna della Querce', type: 'fmdq' },
  { name: 'Direct', type: 'direct' },
  { name: 'Agency', type: 'agency' },
  { name: 'Viator', type: 'ota' },
]) {
  test(`editing ${channel.name}: NULL stays empty after effects; Bókun is separate and not submitted`, async () => {
    const h = fixture(channel);
    let tree = h.renderForm();
    assert.equal(input(tree, 'booking_reference').props.value, '');
    assert.match(textContent(tree), /Riferimento Bókun \(sola lettura\).*TOD-107115145/);
    assert.equal(input(tree, 'bokun_booking_reference'), undefined);
    h.flushEffects();
    await setImmediate();
    tree = h.renderForm();
    assert.equal(input(tree, 'booking_reference').props.value, '');
    assert.equal(h.requests.length, 0);
    assert.doesNotMatch(textContent(tree), /Generazione riferimento automatico/);
  });

  test(`saving notes for ${channel.name} preserves references, channel, Bókun identity and other stored data`, async () => {
    const h = fixture(channel);
    const before = structuredClone(h.booking);
    const payments = structuredClone(h.tables.supplier_payments);
    assert.equal((await h.save({ booking_reference: '', notes: 'Updated note' })).saved, true);
    assert.deepEqual(h.booking, { ...before, notes: 'Updated note' });
    assert.deepEqual(h.tables.supplier_payments, payments);
    assert.equal(h.writes.length, 1);
    const payload = h.writes[0].payload;
    for (const field of ['booking_reference', 'bokun_booking_reference', 'bokun_id', 'channel_id', 'booking_source',
      'customer_payment_status', 'supplier_payment_status', 'supplier_amount_paid']) {
      assert.equal(Object.hasOwn(payload, field), false, field);
    }
  });
}

test('existing automatic reference survives opening and changing channel without regeneration', async () => {
  const h = fixture();
  h.booking.booking_reference = 'DIR-000123';
  h.tables.channels.push({ id: 9, name: 'Agency', type: 'agency' });
  let tree = h.renderForm();
  h.flushEffects();
  input(tree, 'channel_id').props.onChange({ target: { value: '9' } });
  tree = h.renderForm();
  h.flushEffects();
  await setImmediate();
  assert.equal(input(h.renderForm(), 'booking_reference').props.value, 'DIR-000123');
  assert.equal(h.requests.length, 0);
});

test('saving an unchanged existing reference preserves its exact value', async () => {
  const h = fixture();
  h.booking.booking_reference = 'existing-Legacy';
  assert.equal((await h.save({ notes: 'Updated' })).saved, true);
  assert.equal(h.booking.booking_reference, 'existing-Legacy');
  assert.equal(Object.hasOwn(h.writes[0].payload, 'booking_reference'), false);
});

test('missing reference input preserves existing value; explicit edits and clearing remain possible', async () => {
  const h = fixture({ name: 'Direct', type: 'direct' });
  h.booking.booking_reference = 'DIR-000123';
  const data = h.form({ notes: 'Updated' });
  data.delete('booking_reference');
  await assert.rejects(h.load('app/prenotazioni/actions.ts').updateBooking(data), /REDIRECT:/);
  assert.equal(h.booking.booking_reference, 'DIR-000123');
  assert.equal((await h.save({ booking_reference: ' custom-123 ' })).saved, true);
  assert.equal(h.booking.booking_reference, 'CUSTOM-123');
  assert.equal((await h.save({ booking_reference: '' })).saved, true);
  assert.equal(h.booking.booking_reference, null);
  assert.equal(h.booking.bokun_booking_reference, 'TOD-107115145');
});

test('intentional channel change still works without generating a reference', async () => {
  const h = fixture();
  h.tables.channels.push({ id: 9, name: 'Direct', type: 'direct' });
  h.tables.experience_channel_prices.push({ ...h.price, id: 488, channel_id: 9 });
  assert.equal((await h.save({ channel_id: 9, booking_reference: '' })).saved, true);
  assert.equal(h.booking.channel_id, 9);
  assert.equal(h.booking.booking_source, 'Direct');
  assert.equal(h.booking.booking_reference, null);
  assert.equal(h.booking.bokun_booking_reference, 'TOD-107115145');
});

test('new booking still gets the automatic reference preview', async () => {
  const h = fixture();
  h.renderForm({ isEditing: false });
  h.flushEffects();
  await setImmediate();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0], /next-direct-ref\?channelId=6/);
  assert.equal(input(h.renderForm({ isEditing: false }), 'booking_reference').props.value, 'FMDQ-000017');
});

test('view-only existing booking does not generate references', async () => {
  const h = fixture();
  h.renderForm({ viewOnly: true });
  h.flushEffects();
  await setImmediate();
  const tree = h.renderForm({ viewOnly: true });
  assert.equal(input(tree, 'booking_reference').props.value, '');
  assert.equal(input(tree, 'booking_reference').props.disabled, true);
  assert.equal(h.requests.length, 0);
});

for (const [channel, prefix] of [
  [{ name: 'Fattoria Madonna della Querce', type: 'fmdq' }, 'FMDQ'],
  [{ name: 'Direct', type: 'direct' }, 'DIR'],
  [{ name: 'Agency', type: 'agency' }, 'AGY'],
]) {
  test(`new ${prefix} booking: real reference API, form preview and creation retain the generated reference`, async () => {
    const requests = [];
    const h = pricingHarness({ runEffects: true, fetch: async url => {
      requests.push(url);
      return h.load('app/api/bookings/next-direct-ref/route.ts').GET(new Request(`http://local.test${url}`));
    } });
    Object.assign(h.channel, channel);
    h.booking.booking_reference = `${prefix}-000016`;
    h.renderForm({ isEditing: false, initialData: { channel_id: h.channel.id, experience_id: h.experience.id } });
    h.flushEffects();
    await setImmediate();
    const tree = h.renderForm({ isEditing: false });
    const reference = input(tree, 'booking_reference').props.value;
    assert.equal(requests.length, 1);
    assert.equal(reference, `${prefix}-000017`);
    assert.equal((await h.save({ booking_reference: reference }, true)).saved, true);
    assert.equal(h.tables.bookings.at(-1).booking_reference, reference);
    assert.equal(h.tables.bookings.at(-1).channel_id, h.channel.id);
    assert.equal(h.tables.bookings.at(-1).booking_source, channel.name);
  });
}

for (const [type, prefix] of [['direct', 'DIR'], ['agency', 'AGY']]) {
  test(`new ${type} booking retains server-side allocation when no preview was submitted`, async () => {
    const h = fixture({ name: type, type });
    h.booking.booking_reference = `${prefix}-000016`;
    assert.equal((await h.save({ booking_reference: '' }, true)).saved, true);
    assert.equal(h.tables.bookings.at(-1).booking_reference, `${prefix}-000017`);
  });
}

for (const reference of [null, 'EXISTING-123']) {
  test(`editing phone and time preserves all four identity fields with reference ${reference}`, async () => {
    const h = fixture();
    h.booking.booking_reference = reference;
    const before = structuredClone(h.booking);
    assert.equal((await h.save({ booking_reference: reference ?? '', customer_phone: '+3912345', booking_time: '12:00' })).saved, true);
    assert.deepEqual(h.booking, { ...before, customer_phone: '+3912345', booking_time: '12:00' });
    for (const key of ['booking_reference', 'bokun_booking_reference', 'channel_id', 'booking_source']) {
      assert.equal(Object.hasOwn(h.writes.at(-1).payload, key), false, key);
    }
  });
}
