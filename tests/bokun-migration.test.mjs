// Isolated PostgreSQL regression; never connects to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js';
const migration = readFileSync('supabase/migrations/202609060001_bokun_booking_identity.sql', 'utf8');

test('composite partial uniqueness, rebooking, NULL protection and unchanged legacy indexes', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create table bookings (id bigint primary key, business_unit_id bigint, booking_reference text, booking_date date, booking_time time, is_cancelled boolean);
      create index existing_external_lookup on bookings(booking_reference);
      insert into bookings values (1999, 2, 'GYGBLHFXQZ7B', '2026-10-24', '10:00', true);`);
    const before = (await db.query('select * from bookings')).rows;
    const indexes = (await db.query("select indexname, indexdef from pg_indexes where tablename = 'bookings' order by indexname")).rows;
    await db.exec(migration);
    const after = (await db.query('select * from bookings')).rows;
    assert.equal(after[0].bokun_booking_reference, null);
    delete after[0].bokun_booking_reference;
    assert.deepEqual(after, before);
    const finalIndexes = (await db.query("select indexname, indexdef from pg_indexes where tablename = 'bookings' order by indexname")).rows;
    assert.equal(finalIndexes.length, indexes.length + 1);
    for (const index of indexes) assert.deepEqual(finalIndexes.find(i => i.indexname === index.indexname), index);
    await db.exec(`update bookings set bokun_booking_reference = 'GET-101955189' where id = 1999;
      insert into bookings values (2000, 2, 'GYGBLHFXQZ7B', '2026-10-24', '17:00', false, 'GET-103074524');`);
    assert.equal((await db.query('select * from bookings')).rows.length, 2);
    await assert.rejects(db.exec("insert into bookings(id, business_unit_id, bokun_booking_reference) values(2001, 2, 'GET-103074524')"), e => e.code === '23505');
    await db.exec("insert into bookings(id, business_unit_id, bokun_booking_reference) values(2002, 3, 'GET-103074524')");
    await assert.rejects(db.exec("insert into bookings(id, bokun_booking_reference) values(2003, 'GET-103074524')"), e => e.code === '23514');
    await db.exec("insert into bookings(id, booking_reference) values(2004, 'GYGBLHFXQZ7B'), (2005, 'GYGBLHFXQZ7B')");
    assert.equal((await db.query('select * from bookings')).rows.length, 5);
  } finally { await db.close(); }
});
