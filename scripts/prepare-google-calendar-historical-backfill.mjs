// Preparation only: SELECT historical_bookings, optionally write SQL to a NEW
// review file. No database insert/update/delete/RPC or SQL execution exists here.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareHistoricalGoogleCalendarBackfill, renderHistoricalGoogleCalendarBackfillSql } from "../lib/google-calendar-historical-backfill.mjs";

const usage = `Preparation only; no SQL is applied.
node scripts/prepare-google-calendar-historical-backfill.mjs --input snapshot.json [--output review.sql]
node scripts/prepare-google-calendar-historical-backfill.mjs --from-db [--output review.sql]
Default with input: print aggregate preview only. --output creates a new file and refuses overwrite.
--from-db uses server credentials only for SELECT historical_bookings; never prints titles or secrets.`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log(usage);
    return;
  }
  let input;
  let output;
  let fromDb = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--from-db" && !fromDb) fromDb = true;
    else if (arg === "--input" && !input && args[i + 1] && !args[i + 1].startsWith("--")) input = args[++i];
    else if (arg === "--output" && !output && args[i + 1] && !args[i + 1].startsWith("--")) output = args[++i];
    else throw new Error("Invalid or repeated argument; use --help");
  }
  if (Boolean(input) === fromDb) throw new Error("Choose exactly one of --input or --from-db");
  let rows;
  if (input) rows = JSON.parse(await readFile(resolve(input), "utf8"));
  else {
    const envModule = await import("@next/env");
    const loadEnvConfig = envModule.loadEnvConfig ?? envModule.default.loadEnvConfig;
    const { createClient } = await import("@supabase/supabase-js");
    loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase server configuration unavailable");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    rows = [];
    let lastId = "0";
    for (;;) {
      const result = await db.from("historical_bookings")
        .select("id,google_uid,booking_date,booking_time,original_title,total_guests,status,source,experience_name")
        .gt("id", lastId).order("id").limit(1000);
      if (result.error) throw new Error("Historical SELECT failed; no SQL generated");
      rows.push(...result.data);
      if (result.data.length < 1000) break;
      lastId = String(result.data.at(-1).id);
    }
  }
  const plan = prepareHistoricalGoogleCalendarBackfill(rows);
  const monthly = new Map();
  for (const { event } of plan.events) {
    const month = event.event_date.slice(0, 7);
    const item = monthly.get(month) ?? { events: 0, knownPresences: 0, nullAttendance: 0, excluded: 0, unknownStatus: 0, synthetic: 0 };
    item.events++;
    if (event.effective_total_guests === null) item.nullAttendance++;
    if (["operational_block", "test"].includes(event.event_classification)) item.excluded++;
    else if (event.gcal_event_status !== "cancelled" && event.effective_total_guests !== null) item.knownPresences += event.effective_total_guests;
    if (event.gcal_event_status === "unknown") item.unknownStatus++;
    if (event.uid_kind === "synthetic") item.synthetic++;
    monthly.set(month, item);
  }
  console.log(JSON.stringify({ inputRows: rows.length, plannedEvents: plan.events.length,
    plannedAliases: plan.aliases.length, conflicts: plan.conflicts,
    monthly: Object.fromEntries([...monthly].sort(([a], [b]) => a.localeCompare(b))) }, null, 2));
  if (plan.conflicts.length) throw new Error("Conflicts require reconciliation; no SQL generated");
  if (output) {
    const sql = renderHistoricalGoogleCalendarBackfillSql(plan);
    await writeFile(resolve(output), sql, { encoding: "utf8", flag: "wx" });
    console.log("Review SQL prepared. Nothing applied to the database.");
  }
}

main().catch(() => {
  // Never echo database errors, arguments, credentials or complete payloads.
  console.error("Preparation failed; no database writes performed. Check arguments and preview conflicts.");
  process.exitCode = 1;
});
