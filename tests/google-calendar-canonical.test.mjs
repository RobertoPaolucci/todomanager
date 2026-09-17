import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeGoogleUid } from "../lib/google-calendar-uid.mjs";
import { prepareHistoricalGoogleCalendarBackfill, renderHistoricalGoogleCalendarBackfillSql } from "../lib/google-calendar-historical-backfill.mjs";

// All 13 real equivalences found in the read-only September 17 audit.
const pairs = [
  ["569b4a1925014716a1262afe926cd13e", "_6kr3iohkc4ojichl60oj8dph6pgj2chm69gmcp9p68r66p1h6dig"],
  ["740c4d8e1a5a462bb59f6fc718f99c26", "_6sq30opkcgs6acb16lgj8dhic9h3aeb66pj66dph71j3ieb368r0"],
  ["a2cc561f4ec2471c85e8d9ad7f1e009e", "_c4p66opl6oomcd35ccp38dphccs3ap9ocgsm2p1ncoomac1g75ig"],
  ["5b049acb060648ab96c37c39be3c615a", "_6lh30d1pc5hm4c1m60r38e31c8sjcopj6thj6eb2ckpm6dhh6lgg"],
  ["69fbb083887540d7b0cc778555088531", "_6osmcoj260s36e1o6sqj8c346th30or36srjgd9l6ko3ge1l6cog"],
  ["8ca5cc3bb8b7483a909f9ede3e62a21d", "_71hm2db3ccpm4ohoc8rj8e1jc4sj0eb675im8p9jckr34o9i65i0"],
  ["c558270c3770466ca550a7438332b069", "_ccqjae1i6so66cpn6so38dhmcdgjad9gc4rj8cpo6cpj4ohg6osg"],
  ["bcf3b4ad4b09484d8a9e49ad7250448f", "_c9hmccr26hgm8d3260sj8e1kcgs62eb56gsm2p1n68qj0d1k71j0"],
  ["f7e5429981be44dfa34b1415300bf51e", "_cormad9k68sjie1hc9ij8d34cpgj6d3264q32d9j60o64phl65ig"],
  ["e55ebe277590416685a04cf897039963", "_ckqjapb2ckp3edpl74o38c9m6os3ao9g6hhmce1p6so36e9p6opg"],
  ["7a77a778f546425cb8b757b8cd29810f", "_6tgjedr16srjgphl6gr38chlcdh3gohn6krm4e33cgp3ie1h61j0"],
  ["039ea7d1c55048bea1e0de7f36dd1193", "_60pjipb16ti32opl6ko38e32clgj2p9gchijephj6pi68c9h74pg"],
  ["5dfa0a18220a41069ec54ab7ccd7b211", "_6li6co9gc4ojgchi61gj8c9g6osmaopl6hgm4dr3cdi3eohi64og"],
];

for (const [plain, encoded] of pairs) {
  test(`real Google identity pair ${plain}`, () => {
    assert.equal(canonicalizeGoogleUid(plain).canonicalUid, plain);
    const decoded = canonicalizeGoogleUid(encoded);
    assert.equal(decoded.canonicalUid, plain);
    assert.equal(decoded.encoding, "base32hex");
    assert.equal(decoded.originalUid, encoded);
    assert.equal(canonicalizeGoogleUid(decoded.canonicalUid).canonicalUid, plain);
  });
}

test("trims externally, preserves original/case/suffixes, recognizes only explicit synthetic IDs", () => {
  const original = "  AbC-123@google.com  ";
  assert.deepEqual(canonicalizeGoogleUid(original), {
    originalUid: original, canonicalUid: "AbC-123@google.com", kind: "google", encoding: "plain",
  });
  for (const uid of ["manual-gcal-2026-07-13-curioseety-berger", "test-gcal-001"]) {
    assert.equal(canonicalizeGoogleUid(uid).kind, "synthetic");
    assert.equal(canonicalizeGoogleUid(uid).canonicalUid, uid);
  }
  for (const uid of ["A_B-C", "abc_20260917T100000Z", "google-test-tour", "TEST-GCAL-001"]) {
    assert.equal(canonicalizeGoogleUid(uid).canonicalUid, uid);
    assert.equal(canonicalizeGoogleUid(uid).kind, "google");
  }
});

test("malformed, unknown or non-roundtripping encodings never create guessed identities", () => {
  const encoded = pairs[0][1];
  for (const uid of ["_", "_zzzz", "_00000000", encoded.toUpperCase(), `${encoded}=`, `${encoded}0`, encoded.slice(0, -1), `${encoded.slice(0, -1)}h`]) {
    assert.equal(canonicalizeGoogleUid(uid).canonicalUid, uid);
    assert.equal(canonicalizeGoogleUid(uid).encoding, "opaque");
    assert.equal(canonicalizeGoogleUid(canonicalizeGoogleUid(uid).canonicalUid).canonicalUid, uid);
  }
  for (const uid of [null, undefined, 12, "", " \n ", "a b", "a\u0000b"]) {
    assert.equal(canonicalizeGoogleUid(uid).kind, "invalid");
    assert.equal(canonicalizeGoogleUid(uid).canonicalUid, null);
  }
});

function historical(overrides = {}) {
  return { id: 1, google_uid: pairs[0][0], booking_date: "2026-05-08", booking_time: "12:00:00",
    original_title: "2 Pranzo", total_guests: 2, status: "CONFIRMED", source: "google_calendar_ics",
    experience_name: "Pranzo", ...overrides };
}

test("historical plan preserves NULL, zero and original counts; no inferred Google timestamps or staging", () => {
  const rows = [historical({ total_guests: null, status: null }),
    historical({ id: 2, google_uid: "second-google-uid", total_guests: 0, status: "unexpected" })];
  const before = structuredClone(rows);
  const plan = prepareHistoricalGoogleCalendarBackfill(rows);
  assert.deepEqual(rows, before);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.events[0].event.historical_total_guests, null);
  assert.equal(plan.events[0].event.effective_total_guests, null);
  assert.equal(plan.events[1].event.effective_total_guests, 0);
  for (const { event } of plan.events) {
    assert.equal(event.gcal_event_status, "unknown");
    assert.equal(event.identity_namespace, "legacy_unscoped");
    assert.equal(event.uid_semantics, "legacy_unknown");
    assert.equal(event.last_observation_source, "historical_bookings");
    assert.equal(event.historical_source, "google_calendar_ics");
    assert.ok(!Object.hasOwn(event, "source"));
    for (const field of ["calendar_id", "occurrence_id", "gcal_event_id", "gcal_ical_uid", "recurring_event_id", "original_start_at", "original_start_date", "original_start_timezone", "gcal_updated_at", "gcal_received_at", "historical_snapshot_at", "staging_id", "observed_total_guests", "attendance_parser_version"]) assert.equal(event[field], null);
  }
});

test("only explicit blocks/tests are excluded; old Tuscan lunches retain their reference value", () => {
  const cases = [
    historical({ id: 1, google_uid: "lunch", original_title: "9 Pranzo Tuscan Escape", total_guests: 9 }),
    historical({ id: 2, google_uid: "block", experience_name: "Tuscan Escape - Blocco data", total_guests: 1 }),
    historical({ id: 3, google_uid: "test-gcal-001", total_guests: 2 }),
    historical({ id: 4, google_uid: "manual-gcal-screenshot", total_guests: 4 }),
  ];
  const plan = prepareHistoricalGoogleCalendarBackfill(cases);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.events[0].event.exclusion_reason, null);
  assert.equal(plan.events[0].event.effective_total_guests, 9);
  assert.equal(plan.events[1].event.event_classification, "operational_block");
  assert.equal(plan.events[1].event.effective_total_guests, 1);
  assert.equal(plan.events[2].event.exclusion_reason, "explicit_test_uid");
  assert.equal(plan.events[3].event.uid_kind, "synthetic");
  assert.equal(plan.events[3].event.uid_semantics, "synthetic");
  assert.equal(plan.events[3].event.attendance_quality, "needs_review");
  assert.equal(plan.aliases[3].verified, false);
});

test("encoded history creates one event with reversible raw/canonical aliases", () => {
  const plan = prepareHistoricalGoogleCalendarBackfill([historical({ google_uid: pairs[0][1] })]);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.aliases.length, 2);
  assert.deepEqual(plan.aliases.map(a => a.original_uid), [pairs[0][1], pairs[0][0]]);
  assert.ok(plan.aliases.every(a => a.canonical_uid === pairs[0][0] && a.verified));
});

test("ambiguous history collisions and invalid/non-Google input block SQL instead of dropping or overwriting rows", () => {
  for (const rows of [
    [historical(), historical({ id: 2, google_uid: pairs[0][1] })],
    [historical(), historical()],
    [historical({ google_uid: null })],
    [historical({ source: "viator" })],
    [historical({ total_guests: -1 })],
    [historical({ total_guests: "2" })],
    [historical({ booking_date: "2026-02-30" })],
    [historical({ id: Number.MAX_SAFE_INTEGER + 1 })],
  ]) {
    const plan = prepareHistoricalGoogleCalendarBackfill(rows);
    assert.ok(plan.conflicts.length > 0);
    assert.throws(() => renderHistoricalGoogleCalendarBackfillSql(plan), /blocked/);
  }
});

test("status comes only from explicit historical evidence, never workflow flags", () => {
  for (const [status, expected] of [["TENTATIVE", "tentative"], ["CANCELLED", "cancelled"], ["canceled", "cancelled"], ["imported", "unknown"], [undefined, "unknown"]]) {
    const plan = prepareHistoricalGoogleCalendarBackfill([historical({ status, import_status: "imported" })]);
    assert.equal(plan.events[0].event.gcal_event_status, expected);
  }
});

test("CLI defaults to offline help and rejects an apply flag", () => {
  const help = spawnSync(process.execPath, ["scripts/prepare-google-calendar-historical-backfill.mjs"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no SQL is applied/);
  const apply = spawnSync(process.execPath, ["scripts/prepare-google-calendar-historical-backfill.mjs", "--apply"], { encoding: "utf8" });
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /no database writes/);
});

test("offline CLI creates review SQL only on request and refuses to overwrite files", () => {
  const directory = mkdtempSync(join(tmpdir(), "todomanager-gcal-cli-"));
  const snapshot = join(directory, "snapshot.json");
  const output = join(directory, "review.sql");
  const content = JSON.stringify([historical()]);
  try {
    writeFileSync(snapshot, content);
    const preview = spawnSync(process.execPath, ["scripts/prepare-google-calendar-historical-backfill.mjs", "--input", snapshot], { encoding: "utf8" });
    assert.equal(preview.status, 0);
    assert.equal(JSON.parse(preview.stdout).plannedEvents, 1);
    assert.ok(!preview.stdout.includes("2 Pranzo"));
    const prepare = spawnSync(process.execPath, ["scripts/prepare-google-calendar-historical-backfill.mjs", "--input", snapshot, "--output", output], { encoding: "utf8" });
    assert.equal(prepare.status, 0);
    const sql = readFileSync(output, "utf8");
    assert.ok(sql.startsWith("-- PREPARED ONLY."));
    const repeat = spawnSync(process.execPath, ["scripts/prepare-google-calendar-historical-backfill.mjs", "--input", snapshot, "--output", output], { encoding: "utf8" });
    assert.equal(repeat.status, 1);
    assert.equal(readFileSync(output, "utf8"), sql);
    assert.equal(readFileSync(snapshot, "utf8"), content);
  } finally {
    // Delete only explicitly created files; no recursive filesystem operation.
    unlinkSync(snapshot);
    try { unlinkSync(output); } catch (error) { if (error.code !== "ENOENT") throw error; }
    rmdirSync(directory);
  }
});
