// Execute SQL only in isolated PostgreSQL/WASM memory; never Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const enginePath = process.env.VIATOR_TEST_PGLITE_MODULE;
const PGlite = enginePath ? (await import(pathToFileURL(enginePath).href)).PGlite : null;
const options = { skip: !PGlite && "Set VIATOR_TEST_PGLITE_MODULE to a local PGlite module" };
const migration = readFileSync(new URL("../supabase/migrations/202609220001_viator_email_phase1.sql", import.meta.url), "utf8");

async function database() {
  const db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.business_units (id bigint primary key);
    create table public.experiences (id bigint primary key, business_unit_id bigint references public.business_units(id));
    create table public.bookings (id bigint primary key, business_unit_id bigint, booking_reference text, notes text);
    create index original_bookings_reference_idx on public.bookings(booking_reference);
    insert into public.business_units values (1), (2);
    insert into public.experiences values (999, 1), (998, 2);
    insert into public.bookings values (1, 1, '123456', 'untouched'), (2, 1, 'BR-123456', 'untouched'), (3, 2, 'BR-123456', 'untouched');
  `);
  return db;
}
const email = (id = "message-1") => `insert into public.viator_email_imports
  (message_id, raw_body, raw_payload, parser_version, content_hash)
  values (${id === null ? "NULL" : `'${id}'`}, 'Original body', '{"body":"Original body"}', 'test', repeat('a', 64))`;

test("migration preserves existing rows/bookings constraints and seeds no mappings", options, async () => {
  const db = await database();
  try {
    const before = (await db.query("select * from bookings order by id")).rows;
    const indexes = (await db.query("select indexdef from pg_indexes where tablename = 'bookings' order by indexname")).rows;
    const experiences = (await db.query("select * from experiences order by id")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query("select * from bookings order by id")).rows, before);
    assert.deepEqual((await db.query("select indexdef from pg_indexes where tablename = 'bookings' order by indexname")).rows, indexes);
    assert.deepEqual((await db.query("select * from experiences order by id")).rows, experiences);
    assert.equal((await db.query("select count(*)::int as n from viator_product_mappings")).rows[0].n, 0);
    await db.exec("insert into bookings values (4, 1, 'BR-123456', 'duplicate still allowed')");
  } finally { await db.close(); }
});

test("mapping FK enforces same BU on insert and parent/mapping changes; exact tuple is unique", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await assert.rejects(db.exec(`insert into viator_product_mappings (business_unit_id, viator_product_code, viator_tour_grade_code, experience_id)
      values (1, '200401P10', 'TG1~12:00', 998)`), e => e.code === "23503");
    await db.exec(`insert into viator_product_mappings (business_unit_id, viator_product_code, viator_tour_grade_code, experience_id)
      values (1, '200401P10', 'TG1~12:00', 999), (2, '200401P10', 'TG1~12:00', 998), (1, '200401P10', 'TG2', 999)`);
    await assert.rejects(db.exec(`insert into viator_product_mappings (business_unit_id, viator_product_code, viator_tour_grade_code, experience_id)
      values (1, '200401P10', 'TG1~12:00', 999)`), e => e.code === "23505");
    await assert.rejects(db.exec("update experiences set business_unit_id = 2 where id = 999"), e => e.code === "23503");
    await assert.rejects(db.exec("update viator_product_mappings set experience_id = 998 where business_unit_id = 1"), e => e.code === "23503");
    await assert.rejects(db.exec("update viator_product_mappings set viator_tour_grade_code = null"), e => e.code === "23502");
  } finally { await db.close(); }
});

test("archive unique message ID accepts NULLs; raw body mandatory; BR/hash are not globally unique", options, async () => {
  const db = await database();
  try {
    await db.exec(migration); await db.exec(email());
    await assert.rejects(db.exec(email()), e => e.code === "23505");
    await db.exec(email(null)); await db.exec(email(null));
    await db.exec("update viator_email_imports set booking_reference = 'BR-123456'");
    assert.equal((await db.query("select count(*)::int as n from viator_email_imports")).rows[0].n, 3);
    await assert.rejects(db.exec("update viator_email_imports set raw_body = NULL"), e => e.code === "23502");
    await assert.rejects(db.exec("update viator_email_imports set raw_body = ''"), e => e.code === "23514");
    await assert.rejects(db.exec("update viator_email_imports set business_unit_id = 2"), e => e.code === "23514");
    await assert.rejects(db.exec("update viator_email_imports set status = 'processing'"), e => e.code === "23514");
    await db.exec("update viator_email_imports set status = 'processing', processing_started_at = now(), attempts = 1");
    await assert.rejects(db.exec("update viator_email_imports set attempts = -1"), e => e.code === "23514");
  } finally { await db.close(); }
});

test("RLS and privileges deny browser roles; service role can archive/classify but not delete archive", options, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from viator_email_imports"), e => e.code === "42501");
      await assert.rejects(db.query("select * from viator_product_mappings"), e => e.code === "42501");
      await assert.rejects(db.exec(email()), e => e.code === "42501");
      await db.exec("reset role");
    }
    await db.exec("set role service_role"); await db.exec(email());
    await db.exec("update viator_email_imports set status = 'needs_review', processed_at = now()");
    assert.equal((await db.query("select * from viator_email_imports")).rows.length, 1);
    await assert.rejects(db.exec("delete from viator_email_imports"), e => e.code === "42501");
  } finally { await db.close(); }
});
