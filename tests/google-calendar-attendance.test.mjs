import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleCalendarAttendance as parse, ATTENDANCE_PARSER_VERSION } from "../lib/google-calendar-attendance.mjs";

for (const [title, expected, observed] of [
  ["9 pranzo Tuscan Escape", 8, 9], ["7 pranzo Tuscan Escape", 6, 7],
  ["9 pranzo (1 no glutine no latticini) Tuscan Escape", 8, 9],
  ["2+1 bambino pranzo", 3, 3], ["2+1 bambino+1 neonato pranzo", 4, 4],
  ["25+guida+autista pranzo", 25, 27], ["2 pranzo cavalli", 2, 2], ["8 pranzo quad", 8, 8],
  ["2 ebike con guida", 2, 2], ["2+1 guida e-bike con guida", 2, 3],
  ["4+2 guide+1 autista farm visit", 4, 7], ["2 cooking class", 2, 2],
  ["4 tagliere bruschette", 4, 4], ["15 cena menu 38 euro", 15, 15],
  ["2 visita in fattoria", 2, 2], ["3 degustazione in fattoria", 3, 3],
  ["1 guida pranzo", 0, 1], ["2 autisti pranzo", 0, 2],
  ["2+1 bambino+1 neonato pranzo T133616118 Cliente +49 1725187336", 4, 4],
  ["2 ebike con guida GYG123 Cliente +14388205286", 2, 2],
]) test(`attendance: ${title}`, () => {
  const result = parse(title);
  assert.equal(result.effective_total_guests, expected);
  assert.equal(result.observed_total_guests, observed);
  assert.equal(result.event_classification, "customer_event");
  assert.equal(result.attendance_quality, "parsed");
  assert.equal(result.attendance_parser_version, ATTENDANCE_PARSER_VERSION);
});

for (const title of ["Tuscan Escape", "Tuscan Escape t", "Tuscan Escape - Blocco data", " TUSCAN   escape T "]) {
  test(`block: ${title}`, () => {
    const result = parse({ original_title: title, experience_id: 22, adults: 1 });
    assert.equal(result.event_classification, "operational_block");
    assert.equal(result.effective_total_guests, 0);
    assert.equal(result.observed_total_guests, null);
    assert.equal(result.exclusion_reason, "explicit_tuscan_escape_block");
  });
}

test("rental preserves observed people but contributes zero presences, without changing event classification", () => {
  const result = parse("2 ebike solo noleggio");
  assert.equal(result.observed_total_guests, 2);
  assert.equal(result.effective_total_guests, 0);
  assert.equal(result.exclusion_reason, "offsite_rental_only");
  assert.equal(result.event_classification, "customer_event");
});

for (const title of ["2 ebike villa svetoni", "pranzo", "2 cavalli", "2/3 pranzo", "2.5 pranzo", "2+ pranzo",
  "2 ebike solo noleggio con guida", "2 ebike noleggio e pranzo", "9+1 guida pranzo Tuscan Escape",
  "2 pranzo +1 bambino", "3 ebike con guida inclusa guida", "999999999999999999999999 pranzo", "2 evento ignoto",
  "2 o 3 pranzo", "2 adulti e 1 bambino pranzo"]) {
  test(`uncertain remains NULL: ${title}`, () => {
    const result = parse(title);
    assert.equal(result.effective_total_guests, null);
    assert.equal(result.attendance_quality, "needs_review");
    assert.ok(result.review_reasons.length);
  });
}

test("explicit staff-only titles contribute zero without a made-up activity", () => {
  for (const title of ["2 guide", "1 autista", "guida+autista"]) {
    assert.equal(parse(title).effective_total_guests, 0);
    assert.equal(parse(title).exclusion_reason, "staff_only");
  }
});

test("never infer attendance from staging defaults, notes, channel or historical totals", () => {
  const row = { original_title: "pranzo Tuscan Escape", adults: 1, total_guests: 9,
    historical_total_guests: 9, experience_id: 22, notes: "9 pranzo", booking_source: "Tuscan Escape" };
  const before = structuredClone(row);
  assert.equal(parse(row).effective_total_guests, null);
  assert.equal(parse(row).event_classification, "customer_event");
  assert.deepEqual(row, before);
  assert.equal(parse(null).effective_total_guests, null);
});
