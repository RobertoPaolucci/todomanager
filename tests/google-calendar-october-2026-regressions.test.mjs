/**
 * Todo Manager — October 2026 regression tests (OFFLINE ONLY)
 *
 * Evidence: anonymized structural fixtures based on the Oct 27 production
 * read-only audit. IDs, dates, titles, and high-level state reflect that
 * audit. The verified old-block scenario is deliberately simulated to isolate
 * the title policy; it is NOT proof that historical Google chronology is valid.
 *
 * Does not call Supabase, Make, Google Calendar, or network services.
 * Does not modify bookings or the repository (aside from being a new test file).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleCalendarAttendance } from '../lib/google-calendar-attendance.mjs';
import { canonicalizeGoogleUid } from '../lib/google-calendar-uid.mjs';
import { inspectGoogleTimestamp, normalizeGoogleCalendarObservation } from '../lib/google-calendar-observation.mjs';
import { planTuscanBookingReconciliation } from '../lib/google-calendar-tuscan-reconciliation.mjs';

const eventUid = '_6ph62p9h70qj6d1p6lij8d9l6csjgchi6os3ap1nckq3cc1jccpg'; // 20 Oct, staging 675
const eventId = 2292;
const bookingDate = '2026-10-20';
const originalBlock = 'Tuscan escape';
const ref = `GCAL-${eventUid.slice(0,48).toUpperCase()}`;
const experience = { id: 7, name: 'Tour della Cinta Senese con pranzo', supplier_id: 3,
  supplier_unit_cost: 38, is_group_pricing: false };
const price = { channel_id: 7, experience_id: 7, your_unit_price: 38,
  supplier_adult_unit_cost: 38, public_unit_price: 0 };

function setup(title, { protectedBooking = false, previousVerified = true,
  incompatiblePreviousEconomy = false, duplicateLink = false,
  clientsPreviously = 1, oldTitle = originalBlock } = {}) {
  const attendance = parseGoogleCalendarAttendance(title);
  const oldAttendance = parseGoogleCalendarAttendance(oldTitle);
  const uid = canonicalizeGoogleUid(eventUid);
  const stampOld = '2026-10-10T10:00:00.000Z';
  const stampNew = '2026-10-19T12:38:42.000Z';
  const oldWasBlock = oldAttendance.event_classification === 'operational_block';
  const oldRate = oldWasBlock ? 0 : oldAttendance.effective_total_guests === 8 ? 36 : 38;
  const oldPayers = oldWasBlock ? 1 : oldAttendance.effective_total_guests;
  const canonicalPrevious = {
    identity_namespace: 'legacy_unscoped', occurrence_id: null, canonical_uid: uid.canonicalUid,
    original_title: oldTitle, event_date: bookingDate, event_time: '13:15:00',
    gcal_updated_at: stampOld, gcal_observation_verified: previousVerified,
    gcal_event_status: 'confirmed', event_classification: oldAttendance.event_classification,
    attendance_quality: 'parsed', attendance_source: 'google_title',
    attendance_parser_version: 'farm-attendance-v1',
    observed_total_guests: oldAttendance.observed_total_guests,
    effective_total_guests: oldAttendance.effective_total_guests,
  };
  const canonicalCurrent = {
    ...canonicalPrevious, original_title: title, gcal_updated_at: stampNew,
    observed_total_guests: attendance.observed_total_guests,
    effective_total_guests: attendance.effective_total_guests,
    event_classification: attendance.event_classification,
    attendance_quality: attendance.attendance_quality,
  };
  const b = {
    id: eventId, business_unit_id: 1, channel_id: 7, supplier_id: 3,
    customer_name: 'Tuscan Escape', booking_source: 'Tuscan Escape', booking_reference: ref,
    booking_date: bookingDate, booking_time: '13:15',
    experience_id: oldWasBlock ? 22 : 7,
    experience_name: oldWasBlock ? 'Tuscan Escape - Blocco data' : experience.name,
    adults: oldPayers, children: 0, infants: 0,
    non_paying_adults: oldWasBlock ? 0 : 1,
    total_people: oldWasBlock ? 1 : oldPayers + 1,
    pax: oldPayers, notes: oldTitle,
    public_unit_price: incompatiblePreviousEconomy ? 45 : 0,
    your_unit_price: oldRate, supplier_unit_cost: oldRate,
    total_to_you: oldWasBlock ? 0 : oldPayers * oldRate,
    total_supplier_cost: oldWasBlock ? 0 : oldPayers * oldRate,
    total_customer: 0, total_amount: incompatiblePreviousEconomy ? 45 : 0,
    margin_total: 0,
    was_modified: protectedBooking, is_cancelled: false, cancelled_at: null,
    agreed_unit_price: null, total_to_you_source: null, recovery_tag: null,
    bokun_booking_reference: null, customer_phone: null, customer_email: null,
    customer_payment_status: 'pending', supplier_payment_status: 'pending', supplier_amount_paid: 0,
  };
  const incoming = {
    id: 675, channel_id: 7, gcal_uid: eventUid, booking_reference: ref,
    original_title: title, booking_date: bookingDate, booking_time: '13:15:00',
    gcal_updated_at: stampNew,
  };
  const previous = {
    id: 675, imported_booking_id: eventId, gcal_uid: eventUid,
    booking_reference: ref, import_status: 'needs_review',
  };
  const observations = [ { ...previous },
    ...(duplicateLink ? [{ id: 9999, imported_booking_id: eventId,
      gcal_uid: '_DIFFERENT_GOOGLE_UID', booking_reference: 'OTHER-REF' }] : []) ];
  const plan = planTuscanBookingReconciliation({
    previous, incoming, canonical: { previous: canonicalPrevious, current: canonicalCurrent },
    booking: b, bookings: [b], observations, experience, price, invoices: [],
    rateForAttendance: a => a.effective_total_guests === 8 ? 36 : 38,
  });
  return { plan, booking: b, incoming, canonicalPrevious, canonicalCurrent };
}

test('20 ottobre: il parser riconosce 6 paganti e 1 guida con nota sul menu', () => {
  const a = parseGoogleCalendarAttendance('7 pranzo (2 pasta al posto della ribollita) Tuscan escape');
  assert.equal(a.event_classification, 'customer_event');
  assert.equal(a.attendance_quality, 'parsed');
  assert.deepEqual([a.observed_total_guests, a.effective_total_guests, a.excluded_staff], [7,6,1]);
});

test('titolo standard: il piano consente la conversione sicura blocco → pranzo', () => {
  const { plan } = setup('7 pranzo Tuscan escape');
  assert.equal(plan.action, 'safe_update', JSON.stringify(plan));
  assert.equal(plan.values.experience_id, 7);
  assert.deepEqual([plan.values.adults, plan.values.non_paying_adults, plan.values.total_people], [6,1,7]);
  assert.equal(plan.values.total_to_you, 228);
});

test('20 ottobre: la nota dietetica documentata deve essere riconosciuta anche dalla riconciliazione', () => {
  // EXPECTED RED on the current code: the restrictive title regex rejects
  // the parenthetical menu note, despite the attendance parser accepting it.
  // The canonical history is simulated as verified to isolate ONLY this defect.
  const { plan } = setup('7 pranzo (2 pasta al posto della ribollita) Tuscan escape');
  assert.equal(plan.action, 'safe_update',
    `Il parser legge correttamente le persone, ma la riconciliazione rifiuta il titolo: ${JSON.stringify(plan)}`);
});

test('annotazioni ambigue, diverse dalla nota autorizzata, non vanno accettate indiscriminatamente', () => {
  const { plan } = setup('7 pranzo (2 bambini invece degli adulti) Tuscan escape');
  assert.deepEqual(plan, { action: 'needs_review', review_reasons: ['ambiguous_tuscan_lunch'], values: null });
});

test('22 ottobre: una modifica manuale deve rimanere protetta', () => {
  const { plan } = setup('5 pranzo Tuscan escape', { protectedBooking: true });
  assert.equal(plan.action, 'needs_review');
  assert.deepEqual(plan.review_reasons, ['manual_or_financial_changes']);
});

test('17/19 ottobre: cronologia canonica non verificata non autorizza aggiornamenti', () => {
  const { plan } = setup('9 pranzo Tuscan escape', { previousVerified: false });
  assert.equal(plan.action, 'needs_review');
  assert.deepEqual(plan.review_reasons, ['unverified_google_chronology']);
});

test('24 ottobre: importi storici incompatibili non vanno ricalcolati automaticamente', () => {
  const { plan } = setup('7 pranzo Tuscan escape', { incompatiblePreviousEconomy: true });
  assert.equal(plan.action, 'needs_review');
  assert.deepEqual(plan.review_reasons, ['booking_differs_from_verified_source']);
});

test('la prenotazione con 8 paganti mantiene la tariffa di 36 euro', () => {
  const { plan } = setup('9 pranzo Tuscan escape');
  assert.equal(plan.action, 'safe_update');
  assert.equal(plan.values.your_unit_price, 36);
  assert.equal(plan.values.total_to_you, 288);
  assert.equal(plan.values.total_supplier_cost, 288);
});

test('una seconda osservazione collegata alla stessa prenotazione impedisce l’aggiornamento', () => {
  const { plan } = setup('7 pranzo Tuscan escape', { duplicateLink: true });
  assert.equal(plan.action, 'needs_review');
  assert.deepEqual(plan.review_reasons, ['conflicting_booking_identity']);
});

test('Gibney: una cancellazione verificata richiede identità Google, non somiglianza del nome', () => {
  const cancelledUid = '_6lhjgdhgc9j64dj168o38e35c4sjgd9ncdh66d3361h3goj164rg';
  const activeOtherUid = '_70q66p9j71i3ed9nc4s38dhm6hh30d1o6dhjgd3260rm4dhhc9hg';
  assert.notEqual(canonicalizeGoogleUid(cancelledUid).canonicalUid,
    canonicalizeGoogleUid(activeOtherUid).canonicalUid);
  const verified = normalizeGoogleCalendarObservation({ event_id: cancelledUid,
    status: 'cancelled', updated: '2026-10-14T07:27:54Z' },
  { receivedAt: '2026-10-14T07:30:00Z', sourceVerified: true });
  assert.equal(verified.googleStatus, 'cancelled');
  assert.equal(verified.googleEventId, cancelledUid);
  assert.deepEqual(verified.warnings, []);
  // This is not approval to automatically cancel booking #2325: its financial
  // and operational state must also be checked in a separate transaction.
});

test('Villa Poggiano: assenza di cronologia verificata non prova la cancellazione', () => {
  const legacy = inspectGoogleTimestamp({ gcal_updated_at: null, gcal_observation_verified: false });
  assert.equal(legacy.verified, false);
  assert.equal(legacy.source, 'missing_updated');
});
