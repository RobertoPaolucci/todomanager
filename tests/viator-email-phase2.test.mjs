// Real HTTP route, parser, repository and transactional SQL; isolated local DB.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { confirmed, modified, cancelled } from "./fixtures/viator-emails.mjs";

const enginePath = process.env.VIATOR_TEST_PGLITE_MODULE;
const PGlite = enginePath ? (await import(pathToFileURL(enginePath).href)).PGlite : null;
const options = { skip: !PGlite && "Set VIATOR_TEST_PGLITE_MODULE to local PGlite" };
const migration = readFileSync("supabase/migrations/202609240001_viator_email_create_booking.sql", "utf8");

async function database() {
  const pg = await PGlite.create();
  // Columns, types, required fields and defaults checked against live OpenAPI.
  // Deliberately NO UNIQUE booking_reference: correctness cannot assume one.
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    create table business_units(id bigint primary key);
    create table channels(id bigint primary key, name text not null);
    create table suppliers(id bigint primary key);
    create table experiences(id bigint primary key, business_unit_id bigint not null references business_units,
      name text not null, active boolean not null default true, is_group_pricing boolean default false,
      supplier_id bigint references suppliers, supplier_unit_cost numeric not null default 0);
    create table experience_channel_prices(id bigint generated always as identity primary key,
      experience_id bigint references experiences, channel_id bigint references channels,
      your_unit_price numeric not null default 0, public_unit_price numeric not null default 0,
      currency text not null default 'EUR', your_child_unit_price numeric default 0,
      public_child_unit_price numeric default 0, supplier_adult_unit_cost numeric, supplier_child_unit_cost numeric default 0);
    create table bookings(id bigint generated always as identity primary key,
      business_unit_id bigint not null references business_units, channel_id bigint references channels,
      booking_reference text, bokun_booking_reference text, experience_id bigint references experiences,
      experience_name text not null, supplier_id bigint references suppliers, booking_date date not null,
      booking_time text, booking_created_at date default current_date,
      customer_name text not null, customer_phone text, customer_email text,
      adults integer not null default 1, children integer not null default 0, infants integer default 0,
      non_paying_adults integer not null default 0, total_people integer not null default 1, pax integer not null default 1,
      your_unit_price numeric not null default 0, public_unit_price numeric not null default 0,
      supplier_unit_cost numeric not null default 0, total_to_you numeric not null default 0,
      total_customer numeric not null default 0, total_amount numeric not null default 0,
      total_supplier_cost numeric not null default 0, margin_total numeric not null default 0,
      booking_source text not null default 'direct', notes text,
      customer_payment_status text not null default 'pending', supplier_payment_status text not null default 'pending',
      supplier_amount_paid numeric default 0, is_cancelled boolean not null default false, cancelled_at timestamptz,
      was_modified boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now());
    insert into business_units values (1), (2); insert into channels values (2, 'Viator'), (3, 'Other');
    insert into experiences(id,business_unit_id,name) values (8,1,'Test experience'), (9,2,'Other unit');
  `);
  await pg.exec(readFileSync("supabase/migrations/202609200001_booking_total_source.sql", "utf8"));
  await pg.exec(readFileSync("supabase/migrations/202609220001_viator_email_phase1.sql", "utf8"));
  await pg.exec(migration);
  await pg.exec(readFileSync("supabase/migrations/202609240002_viator_email_cancel_booking.sql", "utf8"));
  return pg;
}

// Minimal parameterized PostgREST adapter. All business decisions execute the
// actual repository/SQL; no mock of creation, duplicate checks or transactions.
function harness(pg, flag = "true") {
  const operations = [];
  const faults = {};
  const db = {
    from(table) {
      assert.ok(["bookings", "experiences", "viator_product_mappings", "viator_email_imports"].includes(table));
      let operation = "select", payload, columns = "*", maximum, single = false;
      const filters = [];
      const q = {
        select(value = "*") { columns = value; return q; },
        insert(value) { operation = "insert"; payload = value; return q; },
        update(value) { operation = "update"; payload = value; return q; },
        eq(key, value) { filters.push([key, value]); return q; },
        is(key, value) { filters.push([key, value]); return q; },
        in(key, value) { filters.push([key, value, "in"]); return q; },
        limit(value) { maximum = value; return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        async then(ok) {
          const values = [];
          const param = value => { values.push(value); return `$${values.length}`; };
          try {
            operations.push({ table, operation });
            let sql;
            if (operation === "insert") {
              sql = `insert into ${table} (${Object.keys(payload).join(",")}) values (${Object.values(payload).map(param).join(",")})`;
            } else if (operation === "update") {
              sql = `update ${table} set ${Object.entries(payload).map(([k, v]) => `${k}=${param(v)}`).join(",")}`;
            } else sql = `select ${columns} from ${table}`;
            if (filters.length) sql += ` where ${filters.map(([k, v, op]) => op === "in" ? `${k} in (${v.map(param).join(",")})` : v === null ? `${k} is null` : `${k}=${param(v)}`).join(" and ")}`;
            if (operation !== "select") sql += ` returning ${columns}`;
            else if (maximum) sql += ` limit ${Number(maximum)}`;
            const { rows } = await pg.query(sql, values);
            if (single && rows.length > 1) return ok({ data: null, error: { code: "multiple_rows" } });
            return ok({ data: JSON.parse(JSON.stringify(single ? rows[0] ?? null : rows)), error: null });
          } catch (error) { return ok({ data: null, error: { code: error.code } }); }
        },
      };
      return q;
    },
    async rpc(name, args) {
      assert.ok(["create_viator_email_booking", "cancel_viator_email_booking"].includes(name));
      operations.push({ table: name, operation: "rpc" });
      if (faults.beforeRpc) await faults.beforeRpc();
      if (faults.missingRpc) return { data: null, error: { code: "PGRST202" } };
      try {
        const { rows } = await pg.query(`select ${name}($1,$2,$3) as result`, [args.p_import_id, args.p_attempts, args.p_started_at]);
        if (faults.lostResponse) return { data: null, error: { code: "network" } };
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error: { code: error.code } }; }
    },
  };
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const loadedModule = { exports: {} };
    const require = name => {
      if (name === "node:crypto") return crypto;
      if (name === "server-only") return {};
      if (name === "@/lib/supabase-server") return { supabaseServer: db };
      if (name.startsWith("@/lib/viator-email-")) return load(`${name.replace("@/", "")}.ts`);
      if (name.startsWith("./viator-email-")) return load(resolve(dirname(file), `${name}.ts`));
      throw new Error(`Unexpected dependency ${name}`);
    };
    vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText, { module: loadedModule, exports: loadedModule.exports, require, Response, Request, Buffer, Date, Set, Map, Error,
      process: { env: { VIATOR_EMAIL_WEBHOOK_SECRET: "local-test", VIATOR_EMAIL_PROCESS_BOOKINGS: flag } } });
    cache.set(file, loadedModule.exports);
    return loadedModule.exports;
  }
  return {
    operations, faults,
    async send(overrides = {}) {
      const response = await load("app/api/webhooks/viator-email/route.ts").POST(new Request("http://localhost/api/webhooks/viator-email", {
        method: "POST", headers: { authorization: "Bearer local-test", "content-type": "application/json" },
        body: JSON.stringify({ message_id: "email-1", subject: "Prenotazione confermata", body: confirmed, ...overrides }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("Viator Phase 2 transactional integration", options, async t => {
  const pg = await database();
  const rows = async table => (await pg.query(`select * from ${table} order by id`)).rows;
  async function reset() {
    await pg.exec(`truncate bookings, viator_email_imports, viator_product_mappings, experience_channel_prices restart identity;
      update experiences set active=true, is_group_pricing=false;
      insert into viator_product_mappings(business_unit_id,viator_product_code,viator_tour_grade_code,experience_id)
        values (1,'200401P10','TG1~12:00',8);
      insert into experience_channel_prices(experience_id,channel_id,your_unit_price,public_unit_price,supplier_adult_unit_cost,supplier_child_unit_cost)
        values (8,2,25,30,5,3);`);
  }
  async function scenario(name, fn) { await t.test(name, async () => { await reset(); await fn(); }); }
  try {
    for (const flag of [undefined, "false", "TRUE"]) await scenario(`env ${flag}: dry-run without INSERT`, async () => {
      const h = harness(pg, flag === undefined ? "" : flag);
      assert.equal((await h.send()).body.status, "ready");
      assert.equal((await rows("bookings")).length, 0);
      assert.equal(h.operations.some(o => o.operation === "rpc"), false);
    });
    await scenario("confirmed creates once, links import and keeps net as total", async () => {
      const h = harness(pg);
      const result = await h.send();
      assert.equal(result.status, 200); assert.equal(result.body.action, "create_booking");
      assert.equal(result.body.booking_writes_enabled, true);
      const [b] = await rows("bookings"), [imp] = await rows("viator_email_imports");
      assert.equal(imp.booking_id, b.id); assert.equal(result.body.booking_id, b.id);
      assert.equal(imp.parsed_data.classification.reason, "booking_created");
      assert.equal(imp.parsed_data.classification.action, "create_booking");
      assert.equal(b.business_unit_id, 1); assert.equal(b.channel_id, 2); assert.equal(b.experience_id, 8);
      assert.equal(b.booking_reference, "BR-1449799117"); assert.equal(b.total_people, 2); assert.equal(b.pax, 2);
      assert.equal(Number(b.total_to_you), 40.32); assert.equal(Number(b.total_supplier_cost), 10);
      assert.equal(Number(b.margin_total), 30.32); assert.equal(Number(b.total_customer), 60);
      assert.equal(b.bokun_booking_reference, null); assert.equal(b.total_to_you_source, null);
      assert.match(b.notes, /Viator email FMDQ \| import_id=/);
      assert.equal((await h.send()).body.booking_id, b.id);
      assert.equal((await rows("bookings")).length, 1);
    });
    await scenario("real validated reference/date/time with synthetic economics", async () => {
      await pg.exec("update viator_product_mappings set viator_tour_grade_code='TG1~10:00'");
      const body = confirmed.replaceAll("BR-1449799117", "BR-1449764423").replace("TG1~12:00", "TG1~10:00").replace("Wed, Sep 23, 2026", "Thu, Sep 24, 2026");
      assert.equal((await harness(pg).send({ body })).body.action, "create_booking");
      const [b] = await rows("bookings");
      assert.equal(b.booking_reference, "BR-1449764423"); assert.equal(b.booking_time, "10:00");
      assert.equal(b.booking_date.toISOString().slice(0, 10), "2026-09-24");
    });
    for (const reference of ["BR-1449799117", "1449799117"]) await scenario(`existing ${reference} remains untouched`, async () => {
      await pg.query("insert into bookings(business_unit_id,booking_reference,customer_name,experience_name,booking_date,is_cancelled) values (1,$1,'Existing','Existing','2026-09-23',true)", [reference]);
      const before = await rows("bookings");
      assert.equal((await harness(pg).send()).body.status, "duplicate_candidate");
      assert.deepEqual(await rows("bookings"), before);
    });
    for (const [body, event, ref] of [[modified, "modified", "BR-1436713371"]]) {
      await scenario(`${event} matched booking stays entirely unchanged with env true`, async () => {
        await pg.query("insert into bookings(business_unit_id,channel_id,booking_reference,customer_name,experience_name,booking_date) values (1,2,$1,'Existing','Existing','2026-09-23')", [ref]);
        const before = await rows("bookings");
        assert.equal((await harness(pg).send({ body, subject: "" })).body.status, event);
        assert.deepEqual(await rows("bookings"), before);
      });
    }
    // Reported real identity; all other fields are synthetic and local only.
    const cancellation = { subject: "Prenotazione cancellata", body: "Prenotazione cancellata\nRiferimento prenotazione: BR-1413153957" };
    async function seedCancellation(reference = "1413153957", isCancelled = false, id = 1595, unit = 1, channel = 2) {
      await pg.query(`insert into bookings(id,business_unit_id,channel_id,booking_reference,customer_name,experience_name,
        booking_date,notes,total_to_you,total_supplier_cost,margin_total,adults,children,total_people,pax,is_cancelled)
        overriding system value values ($1,$2,$3,$4,'Synthetic customer','Original experience','2026-09-23',
        'Original note',99,60,39,2,1,3,3,$5)`, [id, unit, channel, reference, isCancelled]);
    }
    for (const reference of ["BR-1413153957", "1413153957"]) await scenario(`cancel ${reference}: only flag changes; import linked atomically`, async () => {
      await seedCancellation(reference);
      // Cancellation never depends on product mappings or prices.
      await pg.exec("delete from viator_product_mappings; delete from experience_channel_prices");
      const before = await rows("bookings"), h = harness(pg);
      const result = await h.send(cancellation);
      assert.equal(result.status, 200); assert.equal(result.body.status, "cancelled");
      assert.equal(result.body.action, "cancel_booking"); assert.equal(result.body.booking_id, 1595);
      assert.equal(result.body.booking_writes_enabled, true);
      assert.deepEqual(await rows("bookings"), before.map(b => ({ ...b, is_cancelled: true })));
      const [imp] = await rows("viator_email_imports");
      assert.equal(imp.booking_id, 1595); assert.equal(imp.parsed_data.classification.action, "cancel_booking");
      assert.equal(imp.parsed_data.classification.reason, "booking_cancelled");
      assert.equal(imp.parsed_data.classification.booking_id, 1595);
      assert.equal((await h.send(cancellation)).body.action, "cancel_booking");
      assert.equal(h.operations.filter(o => o.operation === "rpc").length, 1);
      assert.equal(h.operations.some(o => o.table === "bookings" && o.operation !== "select"), false);
      const repeated = await pg.query("select cancel_viator_email_booking($1,0,now()) as result", [imp.id]);
      assert.equal(repeated.rows[0].result.booking_id, 1595);
    });
    await scenario("cancel zero matches / wrong BU or channel: no booking writes or link", async () => {
      await seedCancellation("1413153957", false, 1595, 2, 2);
      await seedCancellation("BR-1413153957", false, 1596, 1, 3);
      const before = await rows("bookings"), h = harness(pg);
      assert.equal((await h.send(cancellation)).body.status, "cancellation_unmatched");
      assert.deepEqual(await rows("bookings"), before);
      assert.equal((await rows("viator_email_imports"))[0].booking_id, null);
      assert.equal(h.operations.some(o => o.operation === "rpc"), false);
    });
    await scenario("cancel unique scoped match ignores same references in other scopes", async () => {
      await seedCancellation();
      await seedCancellation("BR-1413153957", false, 1596, 2, 2);
      await seedCancellation("1413153957", false, 1597, 1, 3);
      const before = await rows("bookings");
      assert.equal((await harness(pg).send(cancellation)).body.booking_id, 1595);
      assert.deepEqual(await rows("bookings"), before.map(b => ({ ...b, is_cancelled: b.id === 1595 })));
    });
    for (const refs of [["BR-1413153957", "1413153957"], ["1413153957", "1413153957"], ["BR-1413153957", "BR-1413153957"]]) {
      await scenario(`cancel ambiguous ${refs.join(" + ")}: no writes, even if one is cancelled`, async () => {
        await seedCancellation(refs[0]); await seedCancellation(refs[1], true, 1596);
        const before = await rows("bookings"), h = harness(pg);
        assert.equal((await h.send(cancellation)).body.status, "needs_review");
        assert.deepEqual(await rows("bookings"), before);
        assert.equal((await rows("viator_email_imports"))[0].booking_id, null);
        assert.equal(h.operations.some(o => o.operation === "rpc"), false);
      });
    }
    await scenario("already cancelled / different message IDs: no UPDATE or duplicated notes", async () => {
      await seedCancellation("1413153957", true);
      const before = await rows("bookings");
      // Any UPDATE, including a no-op, would fail. Linking must still succeed.
      await pg.exec(`create function reject_test_booking_update() returns trigger language plpgsql as $$
        begin raise exception 'unexpected booking update'; end $$;
        create trigger reject_test_booking_update before update on bookings for each row execute function reject_test_booking_update();`);
      try {
        const h = harness(pg);
        for (const message_id of ["cancel-1", "cancel-2"]) {
          const result = await h.send({ ...cancellation, message_id });
          assert.equal(result.status, 200); assert.equal(result.body.action, "cancel_booking");
        }
        assert.deepEqual(await rows("bookings"), before);
        assert.ok((await rows("viator_email_imports")).every(imp => imp.booking_id === 1595));
      } finally { await pg.exec("drop trigger reject_test_booking_update on bookings; drop function reject_test_booking_update()"); }
    });
    for (const flag of ["", "false", "TRUE"]) await scenario(`cancel env ${flag}: dry-run, no RPC or link`, async () => {
      await seedCancellation(); const before = await rows("bookings"), h = harness(pg, flag);
      const result = await h.send(cancellation);
      assert.equal(result.body.booking_writes_enabled, false);
      assert.equal(result.body.action, undefined);
      assert.deepEqual(await rows("bookings"), before);
      assert.equal((await rows("viator_email_imports"))[0].booking_id, null);
      assert.equal(h.operations.some(o => o.operation === "rpc"), false);
    });
    for (const overrides of [{ business_unit_id: 2 }, { channel_id: 3 }, { subject: "Nuova richiesta di prenotazione" },
      { body: `${cancellation.body}\nBooking: BR-9999` }]) await scenario(`cancel unsafe envelope ${JSON.stringify(overrides)}`, async () => {
      await seedCancellation(); const before = await rows("bookings"), h = harness(pg);
      assert.equal((await h.send({ ...cancellation, ...overrides })).body.status, "needs_review");
      assert.deepEqual(await rows("bookings"), before);
      assert.equal(h.operations.some(o => o.operation === "rpc"), false);
    });
    for (const [name, sql, status] of [
      ["late second candidate", "insert into bookings(business_unit_id,channel_id,booking_reference,customer_name,experience_name,booking_date) values (1,2,'BR-1413153957','Other','Other','2026-09-23')", "needs_review"],
      ["candidate moved to other channel", "update bookings set channel_id=3", "cancellation_unmatched"],
      ["modified event", "update viator_email_imports set event_type='modified'", "needs_review"],
      ["processing disabled", "update viator_email_imports set parsed_data=jsonb_set(parsed_data,'{processing_requested}','false')", "needs_review"],
      ["scope tampered", "update viator_email_imports set parsed_data=jsonb_set(parsed_data,'{classification,channel_id}','3')", "needs_review"],
    ]) await scenario(`cancel RPC rechecks ${name}`, async () => {
      await seedCancellation(); const h = harness(pg); let before;
      h.faults.beforeRpc = async () => { await pg.exec(sql); before = await rows("bookings"); };
      assert.equal((await h.send(cancellation)).body.status, status);
      assert.deepEqual(await rows("bookings"), before);
      assert.equal((await rows("viator_email_imports"))[0].booking_id, null);
    });
    await scenario("cancel expired lease cannot write", async () => {
      await seedCancellation(); const before = await rows("bookings"), h = harness(pg);
      h.faults.beforeRpc = () => pg.exec("update viator_email_imports set attempts=attempts+1");
      assert.equal((await h.send(cancellation)).status, 503);
      assert.deepEqual(await rows("bookings"), before);
      assert.equal((await rows("viator_email_imports"))[0].status, "processing");
    });
    await scenario("cancel missing RPC fails closed; retry succeeds", async () => {
      await seedCancellation(); const before = await rows("bookings"), h = harness(pg);
      h.faults.missingRpc = true;
      const failed = await h.send(cancellation);
      assert.equal(failed.status, 503); assert.equal(failed.body.error, "booking_cancellation_failed");
      assert.deepEqual(await rows("bookings"), before);
      h.faults.missingRpc = false;
      assert.equal((await h.send(cancellation)).body.action, "cancel_booking");
    });
    await scenario("cancel link failure rolls back flag; retry succeeds", async () => {
      await seedCancellation(); const before = await rows("bookings"), h = harness(pg);
      await pg.exec("alter table viator_email_imports add constraint simulated_cancel_link_failure check(booking_id is null)");
      try {
        assert.equal((await h.send(cancellation)).status, 503);
        assert.deepEqual(await rows("bookings"), before);
        const [imp] = await rows("viator_email_imports");
        assert.equal(imp.status, "processing_failed"); assert.equal(imp.booking_id, null);
        assert.match(imp.error_message, /^booking_cancellation_failed:23514$/);
      } finally { await pg.exec("alter table viator_email_imports drop constraint simulated_cancel_link_failure"); }
      assert.equal((await h.send(cancellation)).body.action, "cancel_booking");
    });
    await scenario("cancel lost RPC response preserves committed result on redelivery", async () => {
      await seedCancellation(); const h = harness(pg); h.faults.lostResponse = true;
      assert.equal((await h.send(cancellation)).status, 503);
      const before = await rows("bookings");
      assert.equal(before[0].is_cancelled, true);
      assert.equal((await rows("viator_email_imports"))[0].booking_id, 1595);
      h.faults.lostResponse = false;
      const result = await h.send(cancellation);
      assert.equal(result.body.action, "cancel_booking"); assert.equal(result.body.booking_id, 1595);
      assert.deepEqual(await rows("bookings"), before);
      assert.equal(h.operations.filter(o => o.operation === "rpc").length, 1);
    });
    await scenario("cancel RPC denied to browser roles; service_role allowed", async () => {
      await seedCancellation();
      for (const role of ["anon", "authenticated"]) {
        await pg.exec(`set role ${role}`);
        await assert.rejects(pg.query("select cancel_viator_email_booking(1,1,now())"), e => e.code === "42501");
        await pg.exec("reset role");
      }
      await pg.exec("set role service_role");
      try { assert.equal((await harness(pg).send(cancellation)).body.action, "cancel_booking"); }
      finally { await pg.exec("reset role"); }
    });
    for (const [name, overrides, setup] of [
      ["modified", { body: modified, subject: "Prenotazione modificata" }],
      ["cancelled", { body: cancelled, subject: "Prenotazione cancellata" }],
      ["pending", { subject: "Rispondi. Nuova richiesta di prenotazione: Sat, Jan 09, 2027 (BR-1449715643)" }],
      ["needs_review", { body: confirmed.replace("Cliente: Amber De Clercq", "Cliente:") }],
      ["needs_mapping", {}, "delete from viator_product_mappings"],
      ["inactive mapping", {}, "update viator_product_mappings set active=false"],
      ["wrong BU", { business_unit_id: 2 }], ["wrong channel", { channel_id: 3 }],
      ["missing net", { body: confirmed.replace("Tariffa netta Viator: EUR €40,32", "") }],
      ["non-EUR", { body: confirmed.replace("EUR", "USD") }],
      ["non-EUR configured prices", {}, "update experience_channel_prices set currency='USD'"],
      ["unknown age breakdown", { body: confirmed.replace("2 Adulti", "2") }],
      ["mismatched counts", { body: confirmed.replace("2 Adulti", "3") + "\nAdulti: 2" }],
    ]) await scenario(`${name}: zero booking writes`, async () => {
      if (setup) await pg.exec(setup);
      const result = await harness(pg).send(overrides);
      assert.equal(result.status, 200); assert.notEqual(result.body.action, "create_booking");
      assert.equal((await rows("bookings")).length, 0);
    });
    await scenario("default time, children/infants and group pricing preserve total net", async () => {
      await pg.exec("update viator_product_mappings set viator_tour_grade_code='TG1',default_time='10:30'; update experiences set is_group_pricing=true where id=8");
      assert.equal((await harness(pg).send({ body: confirmed.replace("TG1~12:00", "TG1").replace("2 Adulti", "2 Adulti, 1 Bambino, 1 Neonato") })).body.action, "create_booking");
      const [b] = await rows("bookings");
      assert.equal(b.booking_time, "10:30"); assert.equal(b.children, 1); assert.equal(b.infants, 1); assert.equal(b.total_people, 4);
      assert.equal(Number(b.total_to_you), 40.32); assert.equal(Number(b.total_supplier_cost), 5);
    });
    await scenario("parallel same message and different messages/same BR create only once", async () => {
      const h = harness(pg);
      await Promise.all([h.send(), h.send(), h.send({ message_id: "email-2" })]);
      await h.send(); await h.send({ message_id: "email-2" });
      assert.equal((await rows("bookings")).length, 1);
    });
    for (const ref of ["BR-1449799117", "1449799117"]) await scenario(`late duplicate ${ref} checked inside transaction`, async () => {
      const h = harness(pg);
      h.faults.beforeRpc = () => pg.query("insert into bookings(business_unit_id,booking_reference,customer_name,experience_name,booking_date) values (1,$1,'Existing','Existing','2026-09-23')", [ref]);
      assert.equal((await h.send()).body.status, "duplicate_candidate");
      assert.equal((await rows("bookings")).length, 1);
    });
    await scenario("mapping disabled after classification blocks INSERT", async () => {
      const h = harness(pg); h.faults.beforeRpc = () => pg.exec("update viator_product_mappings set active=false");
      assert.equal((await h.send()).body.status, "needs_mapping"); assert.equal((await rows("bookings")).length, 0);
    });
    for (const [name, sql] of [
      ["wrong mapping experience", "update viator_product_mappings set experience_id=9,business_unit_id=2"],
      ["inactive experience", "update experiences set active=false where id=8"],
      ["modified event", "update viator_email_imports set event_type='modified'"],
      ["cancelled event", "update viator_email_imports set event_type='cancelled'"],
      ["pending subject", "update viator_email_imports set subject='Rispondi. Nuova richiesta di prenotazione'"],
      ["processing disabled", "update viator_email_imports set parsed_data=jsonb_set(parsed_data,'{processing_requested}','false')"],
      ["scope tampered", "update viator_email_imports set parsed_data=jsonb_set(parsed_data,'{classification,channel_id}','3')"],
      ["not ready", "update viator_email_imports set parsed_data=jsonb_set(parsed_data,'{classification,status}','\"needs_review\"')"],
    ]) await scenario(`RPC rechecks ${name}`, async () => {
      const h = harness(pg); h.faults.beforeRpc = () => pg.exec(sql);
      const result = await h.send(); assert.equal(result.status, 200);
      assert.notEqual(result.body.action, "create_booking"); assert.equal((await rows("bookings")).length, 0);
    });
    await scenario("expired worker cannot use a lease claimed by another worker", async () => {
      const h = harness(pg); h.faults.beforeRpc = () => pg.exec("update viator_email_imports set attempts=attempts+1");
      assert.equal((await h.send()).status, 503); assert.equal((await rows("bookings")).length, 0);
      assert.equal((await rows("viator_email_imports"))[0].status, "processing");
    });
    await scenario("missing RPC fails closed without fallback INSERT", async () => {
      const h = harness(pg); h.faults.missingRpc = true;
      assert.equal((await h.send()).status, 503); assert.equal((await rows("bookings")).length, 0);
      h.faults.missingRpc = false;
      assert.equal((await h.send()).body.action, "create_booking");
    });
    await scenario("lost RPC response preserves committed link and retry cannot duplicate", async () => {
      const h = harness(pg); h.faults.lostResponse = true;
      assert.equal((await h.send()).status, 503);
      const [imp] = await rows("viator_email_imports"); assert.ok(imp.booking_id);
      h.faults.lostResponse = false;
      assert.equal((await h.send()).body.booking_id, imp.booking_id);
      assert.equal((await rows("bookings")).length, 1);
    });
    await scenario("failed INSERT persists diagnosis and retry succeeds", async () => {
      await pg.exec("alter table bookings add constraint simulated_failure check(total_to_you <> 40.32)");
      const h = harness(pg);
      assert.equal((await h.send()).status, 503);
      const [imp] = await rows("viator_email_imports");
      assert.equal(imp.status, "processing_failed"); assert.equal(imp.processed_at, null);
      assert.match(imp.error_message, /^booking_creation_failed:23514$/);
      assert.equal((await rows("bookings")).length, 0);
      await pg.exec("alter table bookings drop constraint simulated_failure");
      assert.equal((await h.send()).body.action, "create_booking");
    });
    await scenario("link failure rolls back new booking, never leaves a partial creation", async () => {
      await pg.exec("alter table viator_email_imports add constraint simulated_link_failure check(booking_id is null)");
      const h = harness(pg); assert.equal((await h.send()).status, 503);
      assert.equal((await rows("bookings")).length, 0);
      assert.equal((await rows("viator_email_imports"))[0].status, "processing_failed");
      await pg.exec("alter table viator_email_imports drop constraint simulated_link_failure");
      assert.equal((await h.send()).body.action, "create_booking");
    });
    await scenario("RPC denied to browser roles, usable by service_role", async () => {
      for (const role of ["anon", "authenticated"]) {
        await pg.exec(`set role ${role}`);
        await assert.rejects(pg.query("select create_viator_email_booking(1,1,now())"), e => e.code === "42501");
        await pg.exec("reset role");
      }
      await pg.exec("set role service_role");
      assert.equal((await harness(pg).send()).body.action, "create_booking");
      await pg.exec("reset role");
    });
  } finally { await pg.close(); }
});
