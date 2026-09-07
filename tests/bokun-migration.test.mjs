// Optional isolated SQL regression: see docs/bokun-rebooking.md for setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js';

const migration = readFileSync('supabase/migrations/202609060001_bokun_booking_identity.sql', 'utf8');
const schema = `create table bookings (id bigint primary key, booking_reference text, booking_date date);`;

for (const [label, constraint] of [
  ['UNIQUE constraint', 'alter table bookings add constraint legacy_ref unique (booking_reference);'],
  ['UNIQUE index', 'create unique index legacy_ref on bookings (booking_reference);'],
  ['no legacy uniqueness', ''],
]) {
  test(`migration preserves data and separates carts: ${label}`, async () => {
    const db = await PGlite.create();
    try {
      await db.exec(schema + constraint + "insert into bookings values (1999, 'GYGBLHFXQZ7B', '2026-10-24');");
      await db.exec(migration);
      const legacy = (await db.query('select * from bookings')).rows[0];
      assert.equal(legacy.bokun_booking_reference, null);
      assert.equal(legacy.booking_reference, 'GYGBLHFXQZ7B');
      await db.exec(`update bookings set bokun_booking_reference = 'GET-101955189' where id = 1999;
        insert into bookings values (2000, 'GYGBLHFXQZ7B', '2026-10-24', 'GET-103074524');`);
      assert.equal((await db.query('select * from bookings')).rows.length, 2);
      await assert.rejects(db.exec("insert into bookings values (2001, 'OTHER', '2026-10-24', 'GET-103074524');"), e => e.code === '23505');
      if (constraint) {
        await db.exec("insert into bookings values (3000, 'VIA123', '2026-10-24', null);");
        await assert.rejects(db.exec("insert into bookings values (3001, 'VIA123', '2026-10-24', null);"), e => e.code === '23505');
      }
    } finally { await db.close(); }
  });
}

for (const [label, extra] of [
  ['foreign key dependency', 'alter table bookings add constraint legacy_ref unique (booking_reference); create table dependent (ref text references bookings(booking_reference));'],
  ['composite unique', 'create unique index legacy_ref on bookings (booking_reference, booking_date);'],
  ['expression unique', 'create unique index legacy_ref on bookings (lower(booking_reference));'],
  ['partial unique', 'create unique index legacy_ref on bookings (booking_reference) where booking_reference is not null;'],
]) {
  test(`unsupported schema stops and rolls back: ${label}`, async () => {
    const db = await PGlite.create();
    try {
      await db.exec(schema + extra);
      await assert.rejects(db.exec(migration));
      await db.exec('rollback;');
      assert.equal((await db.query("select column_name from information_schema.columns where table_name = 'bookings' and column_name = 'bokun_booking_reference'")).rows.length, 0);
      assert.equal((await db.query("select indexname from pg_indexes where indexname = 'legacy_ref'")).rows.length, 1);
    } finally { await db.close(); }
  });
}
