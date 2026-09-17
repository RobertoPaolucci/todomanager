# Google Calendar canonical source — Phase 1 (prepared, not applied)

## Scope

This phase adds an isolated schema proposal, a shared UID function, historical
backfill preparation and offline tests. No webhook/action/dashboard imports the
new modules. No production migration or backfill has been executed.

New files:

- `supabase/migrations/202609170001_google_calendar_canonical_phase1.sql`
- `lib/google-calendar-uid.mjs`
- `lib/google-calendar-historical-backfill.mjs`
- `scripts/prepare-google-calendar-historical-backfill.mjs`
- `tests/google-calendar-canonical.test.mjs`
- `tests/google-calendar-migration.test.mjs`
- `docs/google-calendar-canonical-phase1.md`

No existing file needs editing. JavaScript ESM is shared directly between the
offline Node script/tests and potential future application consumers, without
another runtime dependency or a second implementation of canonicalization.

## Schema

The complete SQL is the migration file above. It creates only two new tables,
their indexes and `google_calendar_events_monthly_control`. PostgreSQL 15+ is
required for `UNIQUE NULLS NOT DISTINCT`. A version guard fails before table
creation on older PostgreSQL. The real server version is not yet verified:
REST OpenAPI's `14.5` is PostgREST, NOT PostgreSQL. Current server credentials
provide REST only, with no exposed RPC and no database connection string.
The available Supabase plugin is not installed/connected. Before applying,
run this read-only query through the project's SQL editor or a connected SQL
access channel and retain its result:

```sql
select version(), current_setting('server_version_num')::integer as server_version_num,
       current_setting('server_version_num')::integer >= 150000 as supports_nulls_not_distinct;
```

Historical/staging references are logical IDs, deliberately not foreign keys to
operational tables: this migration cannot block an existing deletion workflow.
Aliases have a deferrable foreign key to their new canonical parent, identity
namespace and canonical UID. Writers must also use the parent's calendar and
occurrence discriminator for aliases; the prepared backfill uses NULL for both.

Both tables have RLS enabled without client policies. Public, anon and
authenticated receive no privileges. The service role has explicit permissions;
the aggregate view is security-invoker and SELECT-only. No trigger, scheduled
job, RPC, automatic update of `updated_at`, seed or live backfill is installed.

`effective_total_guests = NULL` means unknown. Excluded rows retain their original
attendance values; exclusion is a separate field, not zero or NULL attendance.
The control view excludes the explicit classifications `operational_block` and
`test`; `exclusion_reason` is audit text, not the validity predicate. Both those
classifications require nonblank audit text. It sums known values for
`customer_event`/`unclassified`, non-cancelled rows, including
unknown/tentative status for diagnosis only. This is not the chart's final rule.
If all eligible counts are NULL (or none are eligible), SUM is NULL, not zero.
NULL-attendance counters identify incomplete sums. Undated events have a NULL
month group rather than silently disappearing.

## UID identity

`canonicalizeGoogleUid(rawUid)` trims the outer whitespace while retaining the
original text. It identifies `manual-gcal-...` and the explicit `test-gcal-001`
as synthetic. It decodes only the observed `_` + 52 lowercase base32hex-symbol
format whose result is a 32-character hex UID. Padding bits and re-encoding must
match exactly. Unrecognized/malformed encodings remain opaque and unchanged.

It does not lowercase ordinary UIDs, strip hyphens, remove `@google.com`, guess
recurrences, or invent IDs for missing input. Its canonical value is idempotent.
Identity namespace and verified iCalUID occurrence scoping are separate. The
function cannot identify the UID's semantics from its spelling. All 13 known
real pairs are fixtures.

## Pre-flight: recurrence and calendar evidence (September 17, 2026)

Read-only inspection of all 597 staging rows and 1,057 historical rows found
no conventional recurring-instance UID suffix and no exact duplicate UID.
Staging UID shapes: 179 plain 32-hex, 408 encoded 32-hex, one explicit test and
nine other opaque formats. History: 1,055 plain 32-hex and two synthetic manual
UIDs. UID shapes alone do not prove that these are non-recurring events.

All 414 saved staging links contain an `eid`; decoding its event token matches
the saved gcal_uid in all 414 cases. There is one distinct calendar token, in
an address-like form that may be abbreviated. This is evidence about the links,
not an authenticated Calendar ID or a captured Make payload.

The webhook selects `event_id || id || uid`; it does not distinguish resource
ID from iCalUID. Its type accepts `calendar_id`/`calendarId`, but neither is
used or persisted. `recurringEventId`, `originalStartTime`, `iCalUID` and
recurrence rules are not consumed or saved. Neither source has calendar or
recurrence columns. No Make scenario export or raw Google webhook payload
archive was found in the repository. Thus actual delivery of these extra
fields is unverified, rather than proven absent.

Google's [event resource documentation](https://developers.google.com/workspace/calendar/api/v3/reference/events)
distinguishes instance `id` (different per occurrence) from `iCalUID` (shared
by the series). `recurringEventId` plus immutable `originalStartTime` identifies
an occurrence even after it moves. Cancelled exceptions can omit other fields.
There is no confirmed recurring example in the available persisted evidence.

### Corrected identity model

The former `(calendar_id, canonical_uid, occurrence_id)` key is replaced by
`UNIQUE NULLS NOT DISTINCT (identity_namespace, canonical_uid, occurrence_id)`:

- `identity_namespace = 'legacy_unscoped'` is an explicit technical namespace
  for existing inputs, NOT a made-up calendar identifier. `calendar_id` remains
  NULL. This scope is stable when calendar metadata is subsequently enriched.
- `uid_semantics = 'legacy_unknown'` for historical Google rows, `synthetic`
  for manual/test inputs. Do not guess `event_id`/`ical_uid` from UID shape.
- Verified resource IDs use `event_id` semantics with `occurrence_id = NULL`:
  the resource ID already identifies the instance. Recurrence data is metadata;
  adding it cannot create a second canonical event with the same key.
- Verified recurring iCalUID inputs use `ical_uid` semantics and an immutable
  occurrence discriminator from originalStartTime: `datetime:<UTC ISO instant>`
  or `date:<YYYY-MM-DD>` for all-day instances. Never use current start/date.
  A series master is not an attendance event: expand instances before ingestion.
- Unique indexes additionally cover `(identity_namespace, gcal_event_id)` and
  `(identity_namespace, recurring_event_id, original_start_at/date)` when those
  fields are known. This catches alternate representations of known instances.
  All-day original dates and IANA timezones have their own nullable fields.
- Bare recurring iCalUIDs without originalStartTime, unknown legacy-to-series
  matches or conflicting aliases must be held for reconciliation, not inserted
  or merged by title/current date. Phase 1 has no such ingestion writer.

### Future calendar enrichment without duplicates

Until the legacy calendar is identified and mapped, do not enable another
calendar feed or introduce arbitrary namespaces to bypass collisions. Within
the legacy namespace even a different/non-NULL calendar_id cannot bypass UID
uniqueness. This deliberately fails closed while provenance is unknown.

Once verified, update calendar_id on the existing event IDs and their aliases
in one explicitly authorized transaction, retaining the namespace and event
IDs. Route subsequent observations of that same calendar to this namespace;
look up verified aliases before insert. Do not insert replacement rows merely
because calendar_id changes from NULL to known. A genuinely different verified
calendar may use `calendar:<actual stable ID>` as its namespace only after
legacy mapping is resolved. Identical resource IDs in distinct verified
calendars can then remain separate. Never use the contextual Google `primary`
alias as the stable calendar ID. Namespace reassignment, if ever needed,
requires an explicit checked transaction with the alias FK deferred; no
automatic promotion or cross-calendar merge is installed in Phase 1.

### Observation provenance

`source` is replaced with `last_observation_source`. Initial backfill uses
`historical_bookings`; a future Google observation can set `google_calendar`
while preserving historical_booking_id, historical_source and the historical
reference counts. Historical baseline and live observation are not exclusive.

Aliases can represent both original/canonical UID forms with one event_id. An
encoded historical UID produces both aliases automatically in the prepared
plan. No staging aliases or the 13 live staging pairs are inserted in Phase 1.
`verified` confirms an identity mapping, not current Google activity. Synthetic
manual IDs are unverified and marked for reconciliation, never matched by name.

## Historical-only backfill

The CLI has no apply mode. Without arguments it prints offline help. With input
it prints aggregate preview only; `--output` writes a NEW SQL file, refusing to
overwrite an existing file. That SQL is not executed by the CLI.

Offline preparation from an exported JSON array:

```powershell
node scripts/prepare-google-calendar-historical-backfill.mjs --input snapshot.json
node scripts/prepare-google-calendar-historical-backfill.mjs --input snapshot.json --output review.sql
```

Later, with authorized read-only access, preparation from the configured server:

```powershell
node scripts/prepare-google-calendar-historical-backfill.mjs --from-db
node scripts/prepare-google-calendar-historical-backfill.mjs --from-db --output review.sql
```

The only live operation available is SELECT on `historical_bookings`, ordered and
paged by id. `bookings` and staging are not read. Credentials stay in the Node
process; errors/output do not echo credentials or full historical titles.
The review SQL does contain historical titles and should be kept locally.

Per historical row:

1. Accept only sources `google_calendar_ics`/`google_calendar_screenshot`.
2. Validate UID, ID, date and nullable nonnegative integer `total_guests`.
3. Canonicalize `google_uid`, retaining raw/synthetic identity.
4. Preserve `total_guests` exactly in historical/effective counts, including NULL.
5. Leave observed count/parser version, Google timestamps, staging reference,
   calendar/recurrence metadata and snapshot acquisition time NULL (unavailable).
6. Map explicitly present confirmed/tentative/cancelled state; absent/unrecognized
   state becomes unknown. Do not infer it from import workflow or source.
7. Exclude only the exact canonical test ID `test-gcal-001`, or an explicit
   `Tuscan Escape - Blocco data` experience/title (case-insensitive exact label).
   Merely naming Tuscan Escape in an old lunch does not prove it was a block.
8. Mark other events unclassified; synthetic rows have needs_review attendance.
9. Use the legacy technical namespace, explicit UID semantics and
   last_observation_source = historical_bookings; never populate Google IDs or
   recurrence metadata by guessing from the historical UID.

The historical source has no experience_id: no link to staging is invented to
infer id 22. Ambiguous historical block identification remains a Phase 2 review.
Likewise, synthetic screenshot rows retain their historical totals, but do not
claim verified Google identity; the control view is diagnostic only.

## Idempotency and conflict behavior

Duplicate historical IDs or duplicate canonical identities block SQL generation,
even with equal counts. No row is silently dropped and no arbitrary winner is
chosen. Invalid input blocks the entire plan. Every source reference is preserved.

Generated SQL runs in a transaction, locks only the two NEW tables, revalidates
the source fields against the exported plan, then inserts events/aliases with
`ON CONFLICT DO NOTHING`. Checks after insertion compare all planned fields and
alias parents. Any mismatch raises an exception: the entire transaction must be
rolled back, without overwriting existing records or reconciliations.

Running identical SQL again against unchanged sources/destination preserves rows,
IDs and timestamps (identity sequences can have gaps after conflict attempts).
New historical rows can be added by regenerating the complete plan. A source
change requires new preview/review. Existing destination enrichment causes a
conflict instead of being reset by a later baseline backfill. Applying the SQL
manually requires separate authorization; on exception issue ROLLBACK if the SQL
client has left the transaction open.

## Verification

Pure offline tests:

```powershell
node --test tests/google-calendar-canonical.test.mjs
```

SQL tests use a separately installed PGlite engine, in memory only (no Supabase,
env-file loading or network). Supply its `dist/index.js` module path:

```powershell
$env:GCAL_TEST_PGLITE_MODULE = 'absolute/path/to/pglite/dist/index.js'
node --test tests/google-calendar-migration.test.mjs
```

Without that explicit engine path, SQL tests report skipped, not passed. Tests
exercise actual migration/backfill SQL, namespace uniqueness, aliases, RLS, invalid
state rejection, NULL/exclusion/cancellation aggregation, replay, changed-source
rejection, destination enrichment/alias conflict rollback, literal SQL escaping
and preservation of all three existing table fixtures. Pre-flight tests also
cover calendar enrichment, resource-ID vs series-UID identity, moved/all-day
occurrences, namespace mismatch, recurrence uniqueness and classification-based
exclusion even when a valid event carries audit text.

Before production application: review complete migration and generated backfill,
confirm server version/roles, inspect preview conflicts and monthly totals, and
authorize migration/backfill separately. No annual chart connection in Phase 1.

## Operational invariants

`bookings`, `historical_bookings`, `google_calendar_import_staging`, webhook
parsing/mappings, Import/Ignore/Reset actions and annual chart remain unchanged.
The pre-existing local edit to `AGENTS.md` is unrelated and must not be included.
No commit/push. Build intentionally not run during this preparatory development
phase under AGENTS.md; targeted lint and offline tests are the applicable checks.
