// PREPARATION ONLY. No apply flag, SQL executor, Supabase write or Bokun replay.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseAuditCsv, prepareCandidates, simulateBackfill } from '../lib/viator-backfill.mjs';

// Exact reviewed files; a different classification must be reviewed, never silently substituted.
const approvedHashes = {
  'AUTO_FIX.csv': 'd2f8e694947057a55ab879f4a90f605d5d7c608d3500f590c75922b45d08a495',
  'REVIEW.csv': '56e363be0e13e0cafeda5b82fad3e66bc47c07d2243c25e939dc6ca1ae35a05f',
  'snapshot.json': 'b104ad16f1341e44e9774f282f4c52cdc00db2486c13a50c6393f319931769f8',
};

export async function readCurrent({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Missing server configuration');
  async function get(route) {
    const response = await fetchImpl(new URL(route, url), {
      method: 'GET', redirect: 'error', headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Read failed: HTTP ${response.status}`);
    return response.json();
  }
  const schema = await get('/rest/v1/');
  const sourceColumnPresent = Boolean(schema.definitions?.bookings?.properties?.total_to_you_source);
  const fields = 'id,booking_reference,bokun_booking_reference,business_unit_id,channel_id,experience_id,experience_name,booking_date,adults,children,infants,total_people,total_to_you,total_supplier_cost,margin_total,is_cancelled,cancelled_at';
  async function all(table, select) {
    const rows = []; let lastId = 0;
    for (;;) {
      const query = new URLSearchParams({ select, id: `gt.${lastId}`, order: 'id.asc', limit: '500' });
      const data = await get(`/rest/v1/${table}?${query}`);
      if (!Array.isArray(data) || data.some(r => !Number.isSafeInteger(r.id) || r.id <= lastId)) throw new Error('Invalid read page');
      rows.push(...data);
      if (data.length < 500) return rows;
      lastId = data.at(-1).id;
    }
  }
  async function capture() {
    const results = await Promise.allSettled([
      all('bookings', fields + (sourceColumnPresent ? ',total_to_you_source' : '')),
      all('experiences', 'id,bokun_id'),
    ]);
    if (results.some(r => r.status === 'rejected')) throw new Error('Read-only capture failed');
    return { bookings: results[0].value, experiences: results[1].value };
  }
  const first = await capture();
  if (JSON.stringify(first) !== JSON.stringify(await capture())) throw new Error('Data changed during capture; repeat dry-run');
  return { ...first, sourceColumnPresent, capturedAt: new Date().toISOString() };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--help')) {
    console.log('Read-only dry-run: node scripts/prepare-viator-backfill.mjs --audit-dir DIRECTORY --output NEW.json');
    return;
  }
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--audit-dir', '--output'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error('Invalid arguments');
    flags.set(args[i], args[i + 1]);
  }
  if (flags.size !== 2) throw new Error('Missing arguments');
  const inputs = {};
  for (const [name, expectedHash] of Object.entries(approvedHashes)) {
    const bytes = await readFile(join(resolve(flags.get('--audit-dir')), name));
    if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Reviewed input changed');
    inputs[name] = bytes.toString('utf8');
  }
  const prepared = prepareCandidates(parseAuditCsv(inputs['AUTO_FIX.csv']), parseAuditCsv(inputs['REVIEW.csv']), JSON.parse(inputs['snapshot.json']));
  if (prepared.candidates.length !== 246 || prepared.alreadyCorrect.length !== 17 || prepared.reviewIds.length !== 153) throw new Error('Reviewed counts changed');
  const { exactCents } = await import('../lib/viator-backfill.mjs');
  if (prepared.candidates.reduce((n, r) => n + r.targetCents - exactCents(r.expected.total_to_you), 0) !== 26402) throw new Error('Reviewed delta changed');
  const envModule = await import('@next/env');
  (envModule.loadEnvConfig ?? envModule.default.loadEnvConfig)(process.cwd(), false, { info() {}, error() {} });
  const current = await readCurrent({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const report = simulateBackfill(prepared, current);
  report.sourceColumnPresent = current.sourceColumnPresent;
  report.migrationRequired = !current.sourceColumnPresent;
  report.inputSha256 = approvedHashes;
  report.note = 'PASS is a point-in-time simulation, not execution authorization. Recheck immediately before any future writes.';
  await writeFile(resolve(flags.get('--output')), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ...report.summary, capturedAt: report.capturedAt, migrationRequired: report.migrationRequired,
    skippedRows: report.rows.filter(r => r.status === 'SKIPPED'), applied: false }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Read-only preparation failed; no database writes performed. Check inputs/network and repeat.'); process.exitCode = 1; });
}
