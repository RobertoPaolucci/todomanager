import test from "node:test";
import assert from "node:assert/strict";
import { extractAirbnbBookingData as parse, inspectBookingLink as inspect } from "../lib/google-calendar-booking-link.mjs";

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
