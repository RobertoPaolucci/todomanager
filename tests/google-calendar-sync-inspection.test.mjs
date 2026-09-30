import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGoogleCalendarPreview as preview, readGoogleCalendarSnapshot } from "../scripts/inspect-google-calendar-sync.mjs";

const snapshot = { staging: [
  { id: 1, gcal_uid: "a", original_title: "9 pranzo Tuscan Escape", booking_date: "2026-10-01", import_status: "ignored" },
  { id: 2, gcal_uid: "b", original_title: "2 ebike solo noleggio", booking_date: "2026-09-20" },
  { id: 3, gcal_uid: "c", original_title: "2 pranzo", booking_date: "2026-09-21", import_status: "ignored", notes: "🔴 Evento cancellato da Google Calendar\n2 pranzo" },
  { id: 4, original_title: "2 pranzo", booking_date: "2026-09-21" },
], events: [{ id: 10, canonical_uid: "a", event_date: "2026-09-01", original_title: "Tuscan Escape",
  event_classification: "operational_block", effective_total_guests: 1 }], aliases: [] };

test("preview includes moves out of the month; differences, review and status counts are separate", () => {
  const result = preview(snapshot, { period: "2026-09", details: true });
  assert.equal(result.counts.staging_analyzed, 4);
  assert.equal(result.counts.canonical_match, 1);
  assert.equal(result.counts.new_events, 2);
  assert.equal(result.counts.insufficient_identity, 1);
  assert.equal(result.counts.attendance_differences, 1);
  assert.equal(result.counts.classification_differences, 1);
  assert.equal(result.counts.date_title_differences, 1);
  assert.equal(result.counts.certain_cancellations, 1);
  assert.equal(result.counts.unproven_google_status, 3);
  assert.equal(result.rows[0].candidate, 8);
  assert.equal(result.rows[0].proposed, 1);
  assert.equal(result.decisions.by_observation.needs_review, 2);
  assert.equal(result.decisions.by_identity.new, 2);
  assert.equal(result.decisions.eligible_observations, 0);
  assert.deepEqual(result.google_status, { known: 1, unknown: 3, verified_updated: 0 });
  assert.equal(preview(snapshot, { period: "2026-08" }).counts.staging_analyzed, 0);
  assert.equal(preview(snapshot, { period: "2026" }).counts.staging_analyzed, 4);
  assert.throws(() => preview(snapshot, { period: "2026-13" }));
});

test("read transport issues only GET SELECT to allowlisted tables, paging even when server caps pages", async () => {
  const requests = [];
  const result = await readGoogleCalendarSnapshot("https://example.invalid", "test-secret", async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.ok(url.searchParams.has("select"));
    assert.ok(!url.pathname.includes("rpc"));
    const rows = url.searchParams.get("id") === "gt.0" ? [{ id: 1 }] : [];
    return { ok: true, json: async () => rows };
  });
  assert.equal(requests.length, 6);
  assert.deepEqual(Object.keys(result), ["staging", "events", "aliases"]);
  assert.deepEqual(result.events, [{ id: 1 }]);
  assert.equal(new Set(requests.map(request => request.url.pathname)).size, 3);
});
test("failed SELECT and broken pagination fail without exposing server error or secret", async () => {
  await assert.rejects(readGoogleCalendarSnapshot("https://example.invalid", "secret", async () => ({ ok: false })), /SELECT failed/);
  await assert.rejects(readGoogleCalendarSnapshot("https://example.invalid", "secret", async () => ({ ok: true, json: async () => [{ id: 1 }] })), /pagination/);
});
test("default CLI is offline help; no apply or write modes are accepted", () => {
  const run = args => spawnSync(process.execPath, ["scripts/inspect-google-calendar-sync.mjs", ...args], { encoding: "utf8" });
  const help = run([]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /SELECT only/);
  for (const args of [["--apply"], ["--from-db", "--apply"], ["--month", "2026-13"], ["--output", "out.sql"]]) {
    assert.equal(run(args).status, 1);
  }
  const directory = mkdtempSync(join(tmpdir(), "gcal-sync-test-"));
  const file = join(directory, "snapshot.json");
  try {
    writeFileSync(file, JSON.stringify(snapshot));
    const result = run(["--input", file, "--month", "2026-09"]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.counts.canonical_match, 1);
    assert.equal(parsed.rows, undefined);
    assert.ok(!result.stdout.includes("Tuscan Escape"));
  } finally { unlinkSync(file); rmdirSync(directory); }
});
