// Read-only diagnostic. Never prints credentials or complete booking payloads.
async function main() {
  const { loadEnvConfig } = await import('@next/env');
  const { createClient } = await import('@supabase/supabase-js');
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configurazione Supabase server non disponibile');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const results = await Promise.all([
    db.from('bookings').select('id,booking_reference,booking_date,booking_time,is_cancelled,booking_source,channel_id,experience_id,created_at,booking_created_at').in('booking_reference', ['GYGBLHFXQZ7B', 'GET-101955189', 'GET-103074524', 'TOD-T143778845', 'TOD-T145243238']),
    db.from('channels').select('id,name'),
    fetch(new URL('/rest/v1/', url), { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } }).then(async response => {
      if (!response.ok) return { error: `OpenAPI HTTP ${response.status}` };
      const schema = await response.json();
      return { booking_schema: schema.definitions?.bookings || 'not exposed' };
    }),
  ]);
  results.forEach((result, i) => console.log(JSON.stringify({ check: i, result })));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
