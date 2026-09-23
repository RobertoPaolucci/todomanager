import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { confirmed, cancelled, modified, changeText } from "./fixtures/viator-emails.mjs";

// Real route/parser/repository, with DB and environment isolated in memory.
// No .env access, network requests or production data.
function harness({ bookings = [], mappings = [], imports = [], env = {} } = {}) {
  const tables = {
    bookings: structuredClone(bookings), viator_product_mappings: structuredClone(mappings),
    viator_email_imports: structuredClone(imports), experiences: [{ id: 999, business_unit_id: 1 }],
  };
  const operations = [];
  const failures = [];
  const db = { from(table) {
    assert.ok(table in tables, table);
    let operation = "select", payload, maximum = Infinity, sorting, columns = "*";
    const predicates = [];
    const query = {
      select(value = "*") { columns = value; return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      is(key, value) { predicates.push(row => (row[key] ?? null) === value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      lt(key, value) { predicates.push(row => row[key] < value); return query; },
      limit(value) { maximum = value; return query; },
      order(key, options) { sorting = [key, options.ascending]; return query; },
      insert(value) { operation = "insert"; payload = value; return query; },
      update(value) { operation = "update"; payload = value; return query; },
      single() { return Promise.resolve().then(() => execute(true)); },
      maybeSingle() { return Promise.resolve().then(() => execute(true)); },
      then(ok, fail) { return Promise.resolve().then(() => execute(false)).then(ok, fail); },
    };
    function execute(single) {
      operations.push({ table, operation, payload: structuredClone(payload) });
      if (table !== "viator_email_imports") assert.equal(operation, "select", "No operational writes allowed");
      const index = failures.findIndex(f => f.table === table && f.operation === operation && (!f.status || f.status === payload?.status));
      if (index >= 0) {
        const failure = failures.splice(index, 1)[0];
        return { data: null, error: { code: failure.code ?? "XX000", message: "sensitive database detail" } };
      }
      let rows = tables[table].filter(row => predicates.every(p => p(row)));
      if (sorting) rows.sort((a, b) => (a[sorting[0]] - b[sorting[0]]) * (sorting[1] ? 1 : -1));
      rows = rows.slice(0, maximum);
      if (operation === "insert") {
        if (payload.message_id && tables[table].some(row => row.message_id === payload.message_id)) return { data: null, error: { code: "23505" } };
        const row = { id: Math.max(0, ...tables[table].map(r => r.id)) + 1, processing_started_at: null, booking_id: null, ...structuredClone(payload) };
        tables[table].push(row); rows = [row];
      }
      if (operation === "update") rows.forEach(row => Object.assign(row, structuredClone(payload)));
      if (single && rows.length > 1) return { data: null, error: { code: "multiple_rows" } };
      const projected = rows.map(row => columns === "*" ? row : Object.fromEntries(columns.split(",").map(key => [key.trim(), row[key.trim()]])));
      return { data: structuredClone(single ? projected[0] ?? null : projected), error: null };
    }
    return query;
  } };
  const cache = new Map();
  const environment = { VIATOR_EMAIL_WEBHOOK_SECRET: "isolated-test-secret", VIATOR_EMAIL_PROCESS_BOOKINGS: "false", ...env };
  function load(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path,
    });
    const requireMock = name => {
      if (name === "node:crypto") return crypto;
      if (name === "server-only") return {};
      if (name === "@/lib/supabase-server") return { supabaseServer: db };
      if (name.startsWith("@/lib/viator-email-")) return load(`${name.replace("@/", "")}.ts`);
      if (name.startsWith("./viator-email-")) return load(resolve(dirname(path), `${name}.ts`));
      throw new Error(`Unexpected dependency ${name}`);
    };
    vm.runInNewContext(outputText, {
      exports: loadedModule.exports, module: loadedModule, require: requireMock, process: { env: environment },
      Response, Request, Buffer, Date, Set, Map, Error,
    }, { filename: path });
    cache.set(path, loadedModule.exports);
    return loadedModule.exports;
  }
  const route = load("app/api/webhooks/viator-email/route.ts");
  return {
    tables, operations, load, db,
    fail(table, operation, extra = {}) { failures.push({ table, operation, ...extra }); },
    async send(overrides = {}, headers = {}, raw) {
      const response = await route.POST(new Request("http://localhost/api/webhooks/viator-email", {
        method: "POST", headers: { authorization: "Bearer isolated-test-secret", "content-type": "application/json", ...headers },
        body: raw ?? JSON.stringify({ message_id: "test-message-1", received_at: "2026-09-22T10:00:00Z", subject: "Prenotazione confermata", sender: "fixture@example.test", body: confirmed, ...overrides }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}
const parser = harness().load("lib/viator-email-parser.ts");
const parse = parser.parseViatorEmail;
// Synthetic explicit test mapping, deliberately NOT approved experience 16.
const mapping = { id: 1, business_unit_id: 1, viator_product_code: "200401P10", viator_tour_grade_code: "TG1~12:00", experience_id: 999, active: true, default_time: null };
const candidate = (reference, business_unit_id = 1, id = 1) => ({ id, business_unit_id, booking_reference: reference, notes: "untouched", total_to_you: 99, is_cancelled: false });

test("real confirmed values: canonical BR, exact codes, English date, adults and net booking total", () => {
  const p = parse(confirmed);
  assert.equal(p.event_type, "confirmed"); assert.equal(p.booking_reference, "BR-1449799117");
  assert.equal(p.product_code, "200401P10"); assert.equal(p.tour_grade, "TG1~12:00");
  assert.equal(p.activity_date, "2026-09-23"); assert.equal(p.activity_time, "12:00");
  assert.equal(p.lead_traveller, "Amber De Clercq"); assert.equal(p.adults, 2);
  assert.equal(p.net_amount, 40.32); assert.equal(p.net_amount_basis, "booking_total"); assert.equal(p.currency, "EUR");
});
test("real cancelled values: no invented product or tour grade", () => {
  const p = parse(cancelled);
  assert.equal(p.event_type, "cancelled"); assert.equal(p.booking_reference, "BR-1446150053");
  assert.equal(p.product_code, null); assert.equal(p.tour_grade, null);
  assert.equal(p.activity_date, "2026-10-15"); assert.equal(p.activity_time, "09:00");
  assert.equal(p.lead_traveller, "Autumn Cronin"); assert.equal(p.adults, 2);
  assert.match(p.tour_name, /Val d’Orcia/); assert.match(p.option_name, /with Guide 09:00/);
});
test("Italian tour grade label preserves the exact code and time", () => {
  const p = parse("Codice livello del tour: TG1~12:00");
  assert.equal(p.tour_grade, "TG1~12:00");
  assert.equal(p.activity_time, "12:00");
  assert.equal(p.warnings.length, 0);
});
test("European net amount with currency code and euro symbol parses without warnings", () => {
  const p = parse("Tariffa netta: EUR €40,32");
  assert.equal(parser.parseViatorNetAmount("EUR €40,32"), 40.32);
  assert.equal(p.net_amount_text, "EUR €40,32");
  assert.equal(p.net_amount, 40.32);
  assert.equal(p.currency, "EUR");
  assert.equal(p.warnings.includes("invalid_net_amount"), false);
});
test("real modified values: complete change text retained", () => {
  const p = parse(modified);
  assert.equal(p.event_type, "modified"); assert.equal(p.booking_reference, "BR-1436713371");
  assert.equal(p.product_code, "200401P8"); assert.equal(p.activity_date, "2026-09-04");
  assert.equal(p.lead_traveller, "Beth Scott"); assert.equal(p.change_text, changeText);
});
test("HTML table fields/entities and multiline requests normalize without losing archive original", async () => {
  const body = `<html><style>hidden</style><h1>Prenotazione confermata</h1><table>${confirmed.split("\n").slice(1).map(line => {
    const i = line.indexOf(":"); return `<tr><td><b>${line.slice(0, i)}:</b></td><td>${line.slice(i + 1).replace("€", "&euro;")}</td></tr>`;
  }).join("")}</table><p>Telefono: +32 123456789</p><p>Lingua: Inglese</p><p>Punto d'incontro: Fattoria<br>Ingresso nord</p><p>Richieste speciali: Allergia<br>Niente noci &amp; arachidi</p></html>`;
  const h = harness(); await h.send({ body });
  const row = h.tables.viator_email_imports[0];
  assert.equal(row.raw_body, body); assert.equal(row.raw_payload.body, body);
  assert.equal(row.parsed_data.adults, 2); assert.equal(row.parsed_data.net_amount, 40.32);
  assert.equal(row.parsed_data.phone, "+32 123456789"); assert.equal(row.parsed_data.language, "Inglese");
  assert.match(row.parsed_data.meeting_point, /Fattoria\nIngresso nord/);
  assert.match(row.parsed_data.special_requests, /Niente noci & arachidi/);
});
test("Italian dates, separate pax fields, missing values and invalid amounts stay explicit", () => {
  const p = parse("CONFIRMED\nBooking: BR-123\nData: 23 settembre 2026\nAdulti: 2\nBambini: 1\nNeonati: 0\nTelefono:\nLingua: Italiano");
  assert.equal(p.activity_date, "2026-09-23"); assert.equal(p.total_travellers, 3); assert.equal(p.phone, null);
  assert.equal(p.children, 1); assert.equal(p.infants, 0);
  assert.equal(parse("Data: 31/02/2026").activity_date, null);
  assert.equal(parser.parseViatorNetAmount("EUR €1.240,32"), 1240.32);
  assert.equal(parser.parseViatorNetAmount("EUR 40.32"), 40.32);
  for (const value of [null, "", "EUR free", "-40,32", "1,234", "40,32 * 2"]) assert.equal(parser.parseViatorNetAmount(value), null);
});
test("first persistence is raw email; missing mapping archives needs_mapping", async () => {
  const h = harness(); const result = await h.send();
  assert.equal(result.status, 200); assert.equal(result.body.status, "needs_mapping");
  assert.equal(h.operations[0].table, "viator_email_imports"); assert.equal(h.operations[0].operation, "insert");
  assert.equal(h.operations[0].payload.raw_body, confirmed); assert.equal(h.operations[0].payload.status, "archived");
  assert.equal(h.tables.bookings.length, 0);
});
test("same message_id twice and concurrent redelivery yield one archive and one processing attempt", async () => {
  const h = harness();
  await Promise.all([h.send(), h.send()]);
  const result = await h.send({ received_at: "2026-09-22T11:00:00Z" });
  assert.equal(result.status, 200); assert.equal(result.body.duplicate, true);
  assert.equal(h.tables.viator_email_imports.length, 1); assert.equal(h.tables.viator_email_imports[0].attempts, 1);
});
test("message_id content conflict cannot overwrite original archive or masquerade as success", async () => {
  const h = harness(); await h.send(); const before = structuredClone(h.tables.viator_email_imports);
  const result = await h.send({ body: cancelled });
  assert.equal(result.status, 409); assert.equal(result.body.error, "message_id_content_conflict");
  assert.deepEqual(h.tables.viator_email_imports, before);
});
test("absent message IDs are nullable, hash is diagnostic and not a uniqueness rule", async () => {
  const h = harness(); await h.send({ message_id: null }); await h.send({ message_id: "  " });
  assert.equal(h.tables.viator_email_imports.length, 2);
  assert.ok(h.tables.viator_email_imports.every(row => row.message_id === null));
  assert.equal(h.tables.viator_email_imports[0].content_hash, h.tables.viator_email_imports[1].content_hash);
});
for (const [body, event, status, reference] of [[cancelled, "cancelled", "cancellation_unmatched", "BR-1446150053"], [modified, "modified", "modification_unmatched", "BR-1436713371"]]) {
  test(`${event}: unmatched numeric legacy or another unit never used as fallback`, async () => {
    const bookings = [candidate(reference.slice(3)), candidate(reference, 2, 2)];
    const h = harness({ bookings }); const result = await h.send({ body, subject: "" });
    assert.equal(result.body.status, status); assert.deepEqual(h.tables.bookings, bookings);
    assert.equal(h.tables.viator_email_imports[0].booking_id, null);
  });
  test(`${event}: unique canonical candidate classified, multiple canonical candidates require review`, async () => {
    const bookings = [candidate(reference)];
    const h = harness({ bookings }); const result = await h.send({ body, subject: "" });
    assert.equal(result.body.status, event); assert.deepEqual(h.tables.bookings, bookings);
    assert.equal(h.tables.viator_email_imports[0].booking_id, null);
    assert.equal((await harness({ bookings: [...bookings, candidate(reference, 1, 2)] }).send({ body, subject: "" })).body.status, "needs_review");
  });
}
test("canonical confirmation against numeric historical reference blocks without linking or rewriting", async () => {
  const bookings = [candidate("1449799117")]; const h = harness({ bookings, mappings: [mapping] });
  const result = await h.send(); assert.equal(result.body.status, "duplicate_candidate");
  const row = h.tables.viator_email_imports[0]; assert.equal(row.booking_id, null);
  assert.equal(row.parsed_data.classification.reason, "historical_numeric_reference"); assert.deepEqual(h.tables.bookings, bookings);
});
test("canonical duplicate blocks creation; multiple canonical rows require review", async () => {
  assert.equal((await harness({ bookings: [candidate("BR-1449799117")] }).send()).body.status, "duplicate_candidate");
  assert.equal((await harness({ bookings: [candidate("BR-1449799117"), candidate("BR-1449799117", 1, 2)] }).send()).body.status, "needs_review");
});
test("many historical numeric rows cannot hide multiple canonical bookings", async () => {
  const bookings = [1, 2, 3].map(id => candidate("1449799117", 1, id));
  bookings.push(candidate("BR-1449799117", 1, 4), candidate("BR-1449799117", 1, 5));
  const h = harness({ bookings });
  assert.equal((await h.send()).body.status, "needs_review");
  assert.deepEqual(h.tables.bookings, bookings);
});
for (const flag of [undefined, "false", "true", "TRUE"]) {
  test(`ready confirmation never writes bookings even with processing env ${flag}`, async () => {
    const bookings = [candidate("BR-1449799117", 2), candidate("1449799117", 2, 2)];
    const h = harness({ bookings, mappings: [mapping], env: { VIATOR_EMAIL_PROCESS_BOOKINGS: flag } });
    const result = await h.send({ business_unit_id: 2, channel_id: 3, booking_source: "Bokun", process_bookings: true });
    assert.equal(result.body.status, "ready"); assert.equal(result.body.booking_writes_enabled, false);
    const row = h.tables.viator_email_imports[0]; assert.equal(row.business_unit_id, 1);
    const plan = row.parsed_data.classification.proposed_booking;
    assert.equal(plan.business_unit_id, 1); assert.equal(plan.channel_id, 2); assert.equal(plan.booking_source, "Viator");
    assert.equal(plan.experience_id, 999); assert.equal("total_to_you" in plan, false);
    assert.equal(row.parsed_data.net_amount, 40.32); assert.deepEqual(h.tables.bookings, bookings);
  });
}
test("mapping must be active, exact product AND grade, same BU and valid experience", async () => {
  for (const override of [{ active: false }, { business_unit_id: 2 }, { viator_tour_grade_code: "TG2~12:00" }, { viator_product_code: "200401P8" }]) {
    assert.equal((await harness({ mappings: [{ ...mapping, ...override }] }).send()).body.status, "needs_mapping");
  }
  const h = harness({ mappings: [mapping] }); h.tables.experiences[0].business_unit_id = 2;
  const result = await h.send(); assert.equal(result.body.status, "processing_failed");
  assert.equal(h.tables.viator_email_imports[0].error_message, "mapping_business_unit_mismatch");
});
test("missing fields never fabricate values or create bookings; configured default time is allowed", async () => {
  const h = harness({ mappings: [mapping] });
  const result = await h.send({ body: confirmed.replace("Data: Wed, Sep 23, 2026", "Data:").replace("Cliente: Amber De Clercq", "Cliente:") });
  assert.equal(result.body.status, "needs_review");
  assert.equal(h.tables.viator_email_imports[0].parsed_data.activity_date, null);
  const timed = harness({ mappings: [{ ...mapping, viator_tour_grade_code: "TG1", default_time: "10:30:00" }] });
  assert.equal((await timed.send({ body: confirmed.replace("TG1~12:00", "TG1") })).body.status, "ready");
  assert.equal(timed.tables.viator_email_imports[0].parsed_data.classification.proposed_booking.booking_time, "10:30");
});
test("unknown email and conflicting identities go to review, not implicit confirmed", async () => {
  const h = harness(); const result = await h.send({ body: "Informazioni generiche sulla policy di cancellazione", subject: "Newsletter" });
  assert.equal(result.body.status, "needs_review"); assert.equal(h.tables.viator_email_imports[0].event_type, "unknown");
  assert.equal(h.operations.some(o => o.table === "bookings"), false);
  assert.equal(parse(`${confirmed}\nBooking: BR-9876`).booking_reference, null);
  assert.equal((await harness().send({ body: cancelled })).body.status, "needs_review");
});
test("archive failure prevents lookup; lookup failure is persisted and same message can retry", async () => {
  const unavailable = harness(); unavailable.fail("viator_email_imports", "insert");
  const failed = await unavailable.send(); assert.equal(failed.status, 503);
  assert.equal(unavailable.operations.length, 1); assert.equal(unavailable.tables.viator_email_imports.length, 0);
  const h = harness(); h.fail("bookings", "select");
  const first = await h.send(); assert.equal(first.status, 503);
  assert.equal(h.tables.viator_email_imports[0].status, "processing_failed");
  assert.equal(h.tables.viator_email_imports[0].raw_body, confirmed);
  assert.equal(h.tables.viator_email_imports[0].parsed_data.product_code, "200401P10");
  assert.doesNotMatch(JSON.stringify(first), /sensitive/);
  assert.equal((await h.send()).body.status, "needs_mapping");
  assert.equal(h.tables.viator_email_imports[0].attempts, 2);
});
test("classification save failure can retry, active lease returns retryable 503, stale lease recovers", async () => {
  const h = harness(); h.fail("viator_email_imports", "update", { status: "needs_mapping" });
  assert.equal((await h.send()).status, 503); assert.equal((await h.send()).status, 200);
  const row = h.tables.viator_email_imports[0]; row.status = "processing"; row.processing_started_at = new Date().toISOString();
  assert.equal((await h.send()).status, 503);
  row.processing_started_at = "2000-01-01T00:00:00Z";
  assert.equal((await h.send()).body.status, "needs_mapping");
});
test("authentication and invalid envelopes are rejected before any database access", async () => {
  for (const auth of ["", "Basic isolated-test-secret", "Bearer incorrect", "isolated-test-secret"]) {
    const h = harness(); assert.equal((await h.send({}, { authorization: auth })).status, 401); assert.equal(h.operations.length, 0);
  }
  const unconfigured = harness({ env: { VIATOR_EMAIL_WEBHOOK_SECRET: "" } });
  assert.equal((await unconfigured.send()).status, 503); assert.equal(unconfigured.operations.length, 0);
  for (const body of [null, "", "   ", 23]) {
    const h = harness(); assert.equal((await h.send({ body })).status, 400); assert.equal(h.operations.length, 0);
  }
  const h = harness(); assert.equal((await h.send({}, {}, "{bad")).status, 400);
  assert.equal((await h.send({}, { "content-type": "text/html" })).status, 415);
  assert.equal((await h.send({ body: "x".repeat(2 * 1024 * 1024) })).status, 413);
  assert.equal(h.operations.length, 0);
});
test("invalid received_at preserved in raw payload; metadata does not stop archival", async () => {
  const h = harness(); assert.equal((await h.send({ received_at: "not a date" })).status, 200);
  assert.equal(h.tables.viator_email_imports[0].received_at, null);
  assert.equal(h.tables.viator_email_imports[0].raw_payload.received_at, "not a date");
});
test("internal review API provides scoped paginated metadata and detail, without writes", async () => {
  const h = harness(); await h.send(); await h.send({ message_id: "second" });
  h.tables.viator_email_imports.push({ id: 3, business_unit_id: 2 });
  const repository = h.load("lib/viator-email-imports.ts");
  const rows = await repository.listViatorEmailImports(h.db, { status: "needs_mapping", limit: 1 });
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 2); assert.equal("raw_body" in rows[0], false);
  const next = await repository.listViatorEmailImports(h.db, { beforeId: 2 }); assert.equal(next[0].id, 1);
  assert.equal((await repository.getViatorEmailImport(h.db, 1)).raw_body, confirmed);
  assert.equal(await repository.getViatorEmailImport(h.db, 3), null);
  await assert.rejects(repository.listViatorEmailImports(h.db, { limit: -1 }), /invalid_review_filter/);
});
