# Tuscan Escape reconciliation — local preparation, 9 October 2026

No migration, remote data update, webhook replay or deployment was performed.

## Runtime path

The authenticated Google webhook retains its existing parsing and canonical
planner. A linked Tuscan lunch may additionally reconcile the same booking via
`reconcile_tuscan_google_booking`; it never inserts a booking. The canonical
writer returns internal before/accepted snapshots only for eligible observations.
Legacy chronology remains blocked by `unverified_google_chronology`. These
internal snapshots are not included in the HTTP response.

Automatic reconciliation requires both canonical versions to be verified and
confirmed, one full Google UID and a unique booking/staging link. A plain initial
block must match its exact original title, date/time, 1-person placeholder and
zero economic values. A later lunch must match the previous verified source,
including paying pax, one guide, notes and standard economics. Ambiguous titles,
operational blocks, cancelled/reactivated events, manual-review markers, manual
flags, contact/customer changes, agreements, external references, payment changes,
unexpected tariffs or invoices in either affected month require review.

For safe updates, N includes one guide: adults=N-1, non_paying_adults=1,
total_people=N, pax=N-1 (Google import's paying-pax convention). Experience is 7.
The server reuses `effectiveFmdqInvoiceRates`: EUR36 for 8 paying clients with
guide evidence, otherwise EUR38. Standard new lunch imports also retain that
discount. Other channels and block defaults are unchanged.

The prepared service-role-only RPC locks all affected tables, including invoices,
catalog/prices and identity aliases, with a five-second timeout. It compares full
typed snapshots and rechecks identities, status, manual/payment guards and
tariffs. Booking plus staging completion is atomic; canonical changes continue
through the existing protected writer. Unexpected UPDATE hooks, missing function,
read errors, conflicts and lock timeouts fail closed to `needs_review`.

These locks briefly serialize reconciliation and competing writes. No external
network calls occur inside the transaction. This intentionally favors review
over proceeding without transaction/financial guarantees.

An exact replay makes no booking changes and marks staging imported atomically.
A later verified observation can update the same booking. If a booking no longer
matches the previous verified source, including recovery after a partial earlier
failure, it requires review. Cancellations retain the existing `gcal_cancelled`
review path: no automatic financial cancellation or reactivation of bookings.
The bulk importer cannot insert a second linked Tuscan booking after reset/force.

## Prepared SQL and rollout prerequisites

1. `202610090001_tuscan_google_booking_reconciliation.sql` installs the runtime
   function, with no repair, replay or scheduled work. It must be installed with
   explicit authorization before deploying the caller. Without it, safe candidates
   remain in review.
2. `202610090002_tuscan_escape_october_reviewed.sql` repairs exactly bookings
   2145,2144,2143,2142,2141,2190, using strict full before/final snapshots. It is
   rerunnable only while the snapshots remain unchanged; concurrent/manual edits,
   cancellations, duplicate references/links, changed aliases, invoices or a
   mixed repair state abort the entire transaction.

Google Calendar `read_event` confirmed all six full IDs, titles, times and dates
on 9 October. All are confirmed nonrecurring events. The Google connector does
not expose `updated`: the repair **does not manufacture verified chronology**.
The five legacy canonicals receive a manual-review attendance marker while
retaining `gcal_observation_verified=false` and their original timestamp fields.
Canonical 1322 (22 October) is already parsed and verified: it is retained whole.
Booking `was_modified=true` protects all six reviewed repairs from later automatic
overwrites, including the already-correct canonical's booking.

Read-only Supabase verification found agreements NULL, zero stored economics,
pending payment statuses and no October Tuscan invoice record. The historical
repair deliberately preserves every economic/payment field, including zeros.
Staging stays `needs_review`. In particular staging 612 has the correct title but
still 1 adult/experience 22: it is retained as evidence pending a separate review.
Updating participants will change invoice previews derived from counts; stored
economic totals remain zero until separately reviewed. Do not confuse that
preview change with an approved financial correction or issued invoice.

Before future execution, re-read all six Google events: SQL cannot detect a
Calendar-only change that has not arrived in Supabase. Verify agreements/invoices
again, and obtain authorization for data operations. Blocks 2140,2138,2137,2292
(12,17,19,20 October), May cases, September corrections and other channels are
outside the historical repair. Google search also confirmed the four block
titles on 9 October.

## Reproducibility and verification

The two fixtures contain only the six relevant records/evidence, no credentials.
`scripts/prepare-tuscan-october-correction.mjs` reads them offline and emits SQL
to stdout; it has no database client, env loading or apply mode. Tests assert the
committed preparation is identical to that output.

Tests exercise actual webhook modules, parsing, pricing, manual/legacy protection,
replays, subsequent changes, duplicates and cancellations. Both SQL files are
tested against PostgreSQL in isolated PGlite memory, including atomic refusal,
historical idempotency and preservation of unrelated sentinel rows. No tests
connect to Supabase or load production environment files.
