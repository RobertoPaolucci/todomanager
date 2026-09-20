// Server-side, manually authorized execution only. No automatic retries or rollback.
import { mkdir, open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { exactCents, simulateBackfill } from '../lib/viator-backfill.mjs';
import { loadReviewedCandidates, readCurrent } from './prepare-viator-backfill.mjs';

export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const safeCode = error => /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'LOCAL_OR_NETWORK_ERROR';
const quote = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
// Horizontal eq values are literal scalars; quoting belongs only to logical OR expressions.
const eq = value => value === null ? 'is.null' : `eq.${String(value)}`;

// Every audited field and the row version are checked by the same SQL UPDATE as the write.
const guardFields = ['id', 'booking_reference', 'bokun_booking_reference', 'business_unit_id', 'channel_id',
  'experience_id', 'experience_name', 'booking_date', 'booking_time', 'adults', 'children', 'infants',
  'total_people', 'pax', 'non_paying_adults', 'total_to_you', 'total_supplier_cost', 'margin_total',
  'is_cancelled', 'cancelled_at', 'total_to_you_source', 'updated_at'];

export function guardedQuery(before) {
  if (!Number.isSafeInteger(before.id) || before.id < 1 || before.channel_id !== 2 || before.is_cancelled !== false
    || before.cancelled_at !== null) throw fail('INVALID_PATCH_SCOPE');
  const params = new URLSearchParams({ select: '*' });
  for (const field of guardFields) {
    if (!Object.hasOwn(before, field) || before[field] === undefined || (before[field] !== null && !['string', 'number', 'boolean'].includes(typeof before[field]))) {
      throw fail('MISSING_GUARD_FIELD');
    }
    params.set(field, eq(before[field]));
  }
  return params;
}

export function createRestClient({ url, key, fetchImpl = fetch }) {
  if (!url || !key || new URL(url).protocol !== 'https:') throw fail('MISSING_CONFIGURATION');
  async function request(table, query, method = 'GET', body) {
    const endpoint = new URL(`/rest/v1/${table}`, url); endpoint.search = query.toString();
    let response;
    try {
      response = await fetchImpl(endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw fail(method === 'PATCH' ? 'PATCH_OUTCOME_UNCERTAIN' : 'READ_FAILED'); }
    if (!response.ok) throw fail(`${method}_HTTP_${response.status}`);
    let rows;
    try { rows = await response.json(); } catch { throw fail(method === 'PATCH' ? 'PATCH_OUTCOME_UNCERTAIN' : 'INVALID_READ'); }
    if (!Array.isArray(rows)) throw fail('INVALID_RESPONSE');
    return rows;
  }
  return {
    async inspect(candidate) {
      const results = await Promise.allSettled([
        request('bookings', new URLSearchParams({ select: '*', id: `eq.${candidate.id}` })),
        request('bookings', new URLSearchParams({ select: 'id,bokun_booking_reference,booking_reference,channel_id,is_cancelled',
          id: `neq.${candidate.id}`, limit: '2',
          or: `(bokun_booking_reference.eq.${quote(candidate.confirmationCode)},and(is_cancelled.eq.false,channel_id.eq.2,booking_reference.eq.${quote(candidate.expected.booking_reference)}))` })),
        request('experiences', new URLSearchParams({ select: 'id,bokun_id', id: `eq.${candidate.expected.experience_id}` })),
      ]);
      if (results.some(r => r.status === 'rejected')) throw fail('PRE_UPDATE_READ_FAILED');
      if (results[0].value.length > 1) throw fail('DUPLICATE_ID');
      return { bookings: [...results[0].value, ...results[1].value], experiences: results[2].value };
    },
    match: before => request('bookings', guardedQuery(before)),
    patch(before, proposal) {
      const keys = Object.keys(proposal).sort();
      const expected = ['margin_total', 'total_to_you', 'total_to_you_source', ...(before.bokun_booking_reference === null ? ['bokun_booking_reference'] : [])].sort();
      if (canonical(keys) !== canonical(expected) || proposal.total_to_you_source !== 'bokun_api_backfill'
        || exactCents(proposal.margin_total) !== exactCents(proposal.total_to_you) - exactCents(before.total_supplier_cost)
        || (before.bokun_booking_reference === null && !/^VIA-\d+$/.test(proposal.bokun_booking_reference))) throw fail('INVALID_PROPOSAL');
      return request('bookings', guardedQuery(before), 'PATCH', proposal);
    },
  };
}

export function changedFields(before, after, proposal = {}) {
  if (!after) return ['ROW_MISSING'];
  // updated_at may be maintained by an existing database trigger; we never set it.
  const expected = { ...before, ...proposal };
  return [...new Set([...Object.keys(expected), ...Object.keys(after)])]
    .filter(key => key !== 'updated_at' && canonical(expected[key]) !== canonical(after[key]));
}

export async function executePlan({ prepared, initial, client, journal, delay = () => pause(300), progress = () => {} }) {
  const preflight = simulateBackfill(prepared, initial);
  const outcomes = [];
  let stopped = null;
  for (const candidate of prepared.candidates) {
    let attempted = false, acknowledged = false;
    try {
      const planned = preflight.rows.find(row => row.id === candidate.id);
      if (planned.status === 'SKIPPED') {
        const row = { id: candidate.id, status: 'SKIPPED', reasons: planned.reasons };
        outcomes.push(row); await journal(row); continue;
      }
      await delay();
      const live = await client.inspect(candidate);
      const checked = simulateBackfill({ ...prepared, candidates: [candidate] }, live).rows[0];
      if (checked.status === 'SKIPPED' || canonical(checked.before) !== canonical(planned.before)) {
        const row = { id: candidate.id, status: 'SKIPPED', reasons: checked.status === 'SKIPPED' ? checked.reasons : ['ROW_CHANGED_SINCE_SNAPSHOT'] };
        outcomes.push(row); await journal(row); continue;
      }
      // Validate the exact filter through GET before its first use for a PATCH.
      const matches = await client.match(checked.before);
      if (matches.length !== 1 || canonical(matches[0]) !== canonical(checked.before)) {
        if (matches.length > 1) throw fail('NON_UNIQUE_GUARDED_MATCH');
        const row = { id: candidate.id, status: 'SKIPPED', reasons: ['GUARDED_VALUES_CHANGED'] };
        outcomes.push(row); await journal(row); continue;
      }
      await journal({ id: candidate.id, status: 'INTENT', before: checked.before, proposal: checked.proposal });
      attempted = true;
      const result = await client.patch(checked.before, checked.proposal);
      if (!result.length) {
        const row = { id: candidate.id, status: 'SKIPPED', reasons: ['CONCURRENT_CHANGE_UPDATE_NOT_APPLIED'] };
        outcomes.push(row); await journal(row); continue;
      }
      if (result.length !== 1 || result[0].id !== candidate.id) throw fail('UNEXPECTED_PATCH_RESULT');
      acknowledged = true;
      const row = { id: candidate.id, status: 'UPDATED', before: checked.before, proposal: checked.proposal, after: result[0] };
      outcomes.push(row); await journal(row);
      if (changedFields(checked.before, result[0], checked.proposal).length) throw fail('PATCH_VERIFICATION_FAILED');
      if (outcomes.length % 25 === 0) progress({ processed: outcomes.length, updated: outcomes.filter(r => r.status === 'UPDATED').length });
    } catch (error) {
      stopped = { id: candidate.id, reason: safeCode(error), updateOutcomeUncertain: attempted && !acknowledged };
      await journal({ status: 'STOPPED', ...stopped });
      break;
    }
  }
  return { outcomes, stopped, notAttempted: prepared.candidates.filter(c => !outcomes.some(o => o.id === c.id)).map(c => c.id) };
}

export function verifyExecution({ prepared, before, after, execution }) {
  const byId = new Map(after.bookings.map(row => [row.id, row]));
  const updated = execution.outcomes.filter(row => row.status === 'UPDATED');
  const updates = new Map(updated.map(row => [row.id, row]));
  const targetIds = new Set(prepared.candidates.map(row => row.id));
  const issues = [];
  for (const row of before.bookings) {
    const current = byId.get(row.id), update = updates.get(row.id);
    const changed = update ? changedFields(row, current, update.proposal) : canonical(row) === canonical(current) ? [] : ['UNEXPECTED_CHANGE'];
    if (changed.length) issues.push({ id: row.id, changed });
  }
  const targetsBefore = before.bookings.filter(row => targetIds.has(row.id));
  const targetsAfter = after.bookings.filter(row => targetIds.has(row.id));
  if (targetsBefore.length !== prepared.candidates.length || targetsAfter.length !== prepared.candidates.length) issues.push({ reason: 'TARGET_COUNT_CHANGED' });
  const total = (rows, field) => rows.reduce((sum, row) => sum + exactCents(row[field]), 0);
  const revenueBefore = total(targetsBefore, 'total_to_you'), revenueAfter = total(targetsAfter, 'total_to_you');
  const marginBefore = total(targetsBefore, 'margin_total'), marginAfter = total(targetsAfter, 'margin_total');
  const expectedRevenueDelta = updated.reduce((sum, row) => sum + exactCents(row.proposal.total_to_you) - exactCents(row.before.total_to_you), 0);
  const expectedMarginDelta = updated.reduce((sum, row) => sum + exactCents(row.proposal.margin_total) - exactCents(row.before.margin_total), 0);
  if (revenueAfter - revenueBefore !== expectedRevenueDelta || marginAfter - marginBefore !== expectedMarginDelta) issues.push({ reason: 'TOTALS_MISMATCH' });
  const unchanged = ids => ids.every(id => canonical(before.bookings.find(row => row.id === id)) === canonical(byId.get(id)));
  return { updated: updated.length, skipped: execution.outcomes.filter(row => row.status === 'SKIPPED').length,
    totalToYouBefore: revenueBefore / 100, totalToYouAfter: revenueAfter / 100,
    marginBefore: marginBefore / 100, marginAfter: marginAfter / 100,
    revenueDelta: (revenueAfter - revenueBefore) / 100, marginDelta: (marginAfter - marginBefore) / 100,
    bokunReferencesAdded: targetsBefore.filter(row => row.bokun_booking_reference === null && byId.get(row.id)?.bokun_booking_reference != null).length,
    backfillSourceCount: targetsAfter.filter(row => row.total_to_you_source === 'bokun_api_backfill').length,
    backfillSourceCountAllBookings: after.bookings.filter(row => row.total_to_you_source === 'bokun_api_backfill').length,
    reviewUnchanged: unchanged(prepared.reviewIds), reviewCount: prepared.reviewIds.length,
    alreadyCorrectUnchanged: unchanged(prepared.alreadyCorrect.map(row => row.id)),
    supplierCostsUnchanged: targetsBefore.every(row => canonical(row.total_supplier_cost) === canonical(byId.get(row.id)?.total_supplier_cost)),
    updatedTimestampsChanged: updated.filter(row => row.before.updated_at !== byId.get(row.id)?.updated_at).length,
    stopped: execution.stopped, notAttempted: execution.notAttempted, issues };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('Explicit execution: node scripts/execute-viator-backfill.mjs --execute --audit-dir DIRECTORY --output-dir NEW_DIRECTORY'); return;
  }
  if (args.length !== 5 || args[0] !== '--execute' || args[1] !== '--audit-dir' || args[3] !== '--output-dir') throw fail('EXPLICIT_EXECUTION_REQUIRED');
  const auditDir = resolve(args[2]), outputDir = resolve(args[4]);
  const { prepared, inputSha256 } = await loadReviewedCandidates(auditDir);
  const env = await import('@next/env');
  (env.loadEnvConfig ?? env.default.loadEnvConfig)(process.cwd(), false, { info() {}, error() {} });
  const config = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const before = await readCurrent({ ...config, fullRows: true });
  if (!before.sourceColumnPresent) throw fail('MIGRATION_MISSING');
  const preflight = simulateBackfill(prepared, before);
  // Pin the full approved result whenever every row still passes.
  const expected = { pass: 246, skipped: 0, totalToYouBefore: 35485.2, totalToYouAfter: 35749.22,
    marginBefore: 10710, marginAfter: 10974.02, revenueDelta: 264.02, marginDelta: 264.02,
    bokunReferencesToPopulate: 235, alreadyCorrectUntouched: 17, reviewExcluded: 153, reviewIncluded: 0 };
  if (!preflight.summary.skipped && Object.entries(expected).some(([key, value]) => preflight.summary[key] !== value)) throw fail('PREFLIGHT_TOTALS_MISMATCH');
  const protectedIds = new Set([...prepared.reviewIds, ...prepared.alreadyCorrect.map(row => row.id)]);
  const targetIds = new Set(prepared.candidates.map(row => row.id));
  if (before.bookings.filter(row => protectedIds.has(row.id)).length !== 170) throw fail('PROTECTED_ROWS_MISSING');
  await mkdir(outputDir, { recursive: false });
  const snapshot = { capturedAt: before.capturedAt, inputSha256, sourceColumnPresent: true,
    targets: before.bookings.filter(row => targetIds.has(row.id)),
    protectedRows: before.bookings.filter(row => protectedIds.has(row.id)),
    allBookingFingerprints: before.bookings.map(row => ({ id: row.id, sha256: sha256(canonical(row)) })),
    experiences: before.experiences, preflight };
  const serialized = JSON.stringify(snapshot, null, 2) + '\n';
  const snapshotHandle = await open(join(outputDir, 'before.json'), 'wx');
  try { await snapshotHandle.writeFile(serialized); await snapshotHandle.sync(); } finally { await snapshotHandle.close(); }
  await writeFile(join(outputDir, 'before.sha256'), sha256(serialized) + '\n', { flag: 'wx' });
  // A durable lock survives failure and forbids automatic reruns against the same audit.
  const lock = await open(join(auditDir, 'real-backfill-execution.lock'), 'wx');
  try { await lock.writeFile(JSON.stringify({ outputDir, startedAt: new Date().toISOString() })); await lock.sync(); } finally { await lock.close(); }
  const handle = await open(join(outputDir, 'journal.jsonl'), 'wx');
  const journal = async event => { await handle.write(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); await handle.sync(); };
  try {
    console.log(JSON.stringify({ stage: 'PRE_UPDATE', ...preflight.summary, snapshotSha256: sha256(serialized) }));
    const execution = await executePlan({ prepared, initial: before, client: createRestClient(config), journal,
      progress: value => console.log(JSON.stringify({ stage: 'PROGRESS', ...value })) });
    await writeFile(join(outputDir, 'execution.json'), JSON.stringify(execution, null, 2), { flag: 'wx' });
    // Verification uses GET only, even after a stopped/uncertain execution.
    const after = await readCurrent({ ...config, fullRows: true });
    const summary = verifyExecution({ prepared, before, after, execution });
    const afterTargets = after.bookings.filter(row => targetIds.has(row.id));
    await writeFile(join(outputDir, 'after.json'), JSON.stringify({ capturedAt: after.capturedAt,
      targets: afterTargets, protectedRows: after.bookings.filter(row => protectedIds.has(row.id)) }, null, 2), { flag: 'wx' });
    const expectedFinal = { updated: 246, skipped: 0, totalToYouBefore: 35485.2, totalToYouAfter: 35749.22,
      marginBefore: 10710, marginAfter: 10974.02, revenueDelta: 264.02, marginDelta: 264.02,
      bokunReferencesAdded: 235, backfillSourceCount: 246, reviewUnchanged: true,
      alreadyCorrectUnchanged: true, supplierCostsUnchanged: true };
    summary.expectedDifferences = Object.entries(expectedFinal).filter(([key, value]) => summary[key] !== value)
      .map(([key, expected]) => ({ key, expected, actual: summary[key] }));
    summary.skippedRows = execution.outcomes.filter(row => row.status === 'SKIPPED');
    summary.success = !summary.stopped && !summary.issues.length && !summary.expectedDifferences.length;
    await writeFile(join(outputDir, 'result.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ stage: 'FINAL', outputDir, ...summary }, null, 2));
    if (!summary.success) process.exitCode = 2;
  } finally { await handle.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Execution stopped: ${safeCode(error)}. Inspect local journal; do not repeat or automatically correct.`); process.exitCode = 1; });
}
