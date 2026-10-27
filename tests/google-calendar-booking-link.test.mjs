import test from "node:test";
import assert from "node:assert/strict";
import { extractAirbnbBookingData as parse, inspectBookingLink as inspect, preserveViatorStagingLink } from "../lib/google-calendar-booking-link.mjs";

test("Airbnb names never become references, including uppercase and multiword names", () => {
  for (const name of ["Francesco", "FRANCESCO", "Francesco Rossi", "Kimberly", "Alessandro", "José García"]) {
    assert.deepEqual(parse(`2+1 bambino pranzo Airbnb ${name}`), { bookingReference: null, customerName: name });
  }
  assert.deepEqual(parse("2 pranzo Airbnb hm12abc345 Francesco Rossi"), { bookingReference: "HM12ABC345", customerName: "Francesco Rossi" });
  assert.equal(parse("Airbnb 123456789").bookingReference, null);
  assert.deepEqual(parse("2 pranzo Airbnb"), { bookingReference: null, customerName: null });
});

const booking = { id: 2300, booking_date: "2026-11-07", booking_time: "12:00", booking_reference: "TA8ZAA5N",
  experience_id: 7, channel_id: 8, adults: 2, children: 1, infants: 0, customer_name: "Francesco", is_cancelled: false };

test('reviewed FMDQ Viator link survives Google replay, changed observations require review',()=>{
  const b={...booking,id:2402,business_unit_id:1,channel_id:2,bokun_booking_reference:null,
    customer_name:'Anita Dreise',booking_source:'Viator',booking_reference:'BR-1460201663'};
  const previous={...b,gcal_uid:'original-uid',imported_booking_id:2402,import_status:'imported',
    original_title:'1 e-bike noleggio 1460201663 Anita Dreise'};
  const incoming={...previous,booking_reference:'GCAL-original-uid',customer_name:null,channel_id:6,
    booking_source:'Fattoria Madonna della Querce',import_status:'needs_review'};
  const resolved=preserveViatorStagingLink(incoming,b,previous);
  assert.equal(resolved.booking_reference,b.booking_reference); assert.equal(resolved.customer_name,b.customer_name);
  assert.equal(resolved.channel_id,2); assert.equal(resolved.import_status,'imported');
  assert.equal(resolved.imported_booking_id,2402);
  for(const patch of [{booking_date:'2026-10-29'},{adults:9},{booking_time:'10:30'},
    {original_title:'1 e-bike noleggio 9999999999 Anita Dreise'},{channel_id:1}]) {
    assert.equal(preserveViatorStagingLink({...incoming,...patch},b,previous).import_status,'needs_review');
  }
  for(const patch of [{business_unit_id:2},{bokun_booking_reference:'VIA-123'},{channel_id:6}]) {
    assert.deepEqual(preserveViatorStagingLink(incoming,{...b,...patch},previous),incoming);
  }
});
test("different Google identity requires review; a date change never reschedules automatically", () => {
  const incoming = { ...booking, booking_date: "2026-11-14", booking_reference: "GCAL-new", gcal_uid: "new" };
  const before = structuredClone(booking);
  assert.equal(inspect(incoming, booking, { gcal_uid: "old" }).kind, "different_event_requires_review");
  assert.equal(inspect(incoming, booking, { gcal_uid: "new" }).compatible, false);
  assert.equal(inspect({ ...booking, booking_date: "2026-11-14", gcal_uid: "same" }, booking, { gcal_uid: "same" }).kind,
    "possible_reschedule_requires_confirmation");
  assert.deepEqual(booking, before);
});
test("matching reference cannot bypass cancellation, missing rows or incompatible fields", () => {
  assert.equal(inspect(booking, booking).compatible, true);
  assert.equal(inspect(booking, null).compatible, false);
  for (const field of ["booking_date", "booking_time", "channel_id", "experience_id", "adults", "children", "infants", "customer_name"]) {
    assert.equal(inspect({ ...booking, [field]: "different" }, booking).compatible, false, field);
  }
  assert.equal(inspect(booking, { ...booking, is_cancelled: true }).compatible, false);
  assert.equal(inspect(booking, { ...booking, is_cancelled: null }).compatible, false);
});
