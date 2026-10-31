import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, ...globals, require(name) {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  } });
  return mod.exports;
}

function harness({ session = { access_token: 'current-token' }, sessionError = null,
  refreshed = { access_token: 'renewed-token' }, refreshError = null, authErrors = [] } = {}) {
  const calls = [], cookies = [], receipts = [];
  let cookie = 'stale-login-token';
  const document = { set cookie(value) { cookies.push(value); cookie = value.split(';')[0].split('=')[1]; } };
  const helper = load('lib/dashboard-alert-session.ts', {
    '@/lib/supabase': { supabase: { auth: {
      getSession: async () => { calls.push('getSession'); return { data: { session }, error: sessionError }; },
      refreshSession: async () => { calls.push('refresh'); return { data: { session: refreshed }, error: refreshError }; },
    } } },
  }, { document, window: { location: { protocol: 'https:' } } }).withDashboardAlertSession;
  function actionFor(file, exported) {
    return load(file, {
      'next/headers': { cookies: async () => ({ get: () => ({ value: cookie }) }) },
      'next/cache': { revalidatePath: path => calls.push(`revalidate:${path}`) },
      '@/lib/supabase-server': { supabaseServer: {
        auth: { getUser: async token => {
          calls.push(`verify:${token}`);
          return { data: { user: { id: 'verified-actor', role: 'authenticated', is_anonymous: false } },
            error: authErrors.shift() ?? null };
        } },
        rpc: async (name, args) => { receipts.push({ name, ...args }); return { data: true, error: null }; },
      } },
    })[exported];
  }
  return { helper, actionFor, calls, cookies, receipts };
}

const version = `v1:${'a'.repeat(32)}`;
for (const [file, exported, rpc] of [
  ['app/google-calendar-alert-actions.ts', 'acknowledgeGoogleCalendarAlert', 'acknowledge_google_calendar_dashboard_alert'],
  ['app/booking-cancellation-alert-actions.ts', 'acknowledgeBookingCancellationAlert', 'acknowledge_booking_cancellation_alert'],
]) {
  test(`${exported}: stale login cookie is replaced before server verification and receipt write`, async () => {
    const h = harness();
    const action = h.actionFor(file, exported);
    assert.equal((await h.helper(() => action(671, version))).success, true);
    assert.deepEqual(h.calls, ['getSession', 'verify:current-token', 'revalidate:/']);
    assert.match(h.cookies[0], /SameSite=Lax; Secure$/);
    assert.deepEqual(h.receipts, [{ name: rpc, alert_id: 671, expected_version: version, actor_id: 'verified-actor' }]);
  });

  test(`${exported}: expired JWT refreshes and retries once with same alert/version`, async () => {
    const h = harness({ authErrors: [{ status: 403, code: 'bad_jwt' }] });
    const action = h.actionFor(file, exported);
    assert.equal((await h.helper(() => action(671, version))).success, true);
    assert.deepEqual(h.calls, ['getSession', 'verify:current-token', 'refresh', 'verify:renewed-token', 'revalidate:/']);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0].actor_id, 'verified-actor');
    assert.equal(h.receipts[0].expected_version, version);
  });

  test(`${exported}: second auth failure stops recovery without writes`, async () => {
    const h = harness({ authErrors: [{ status: 401 }, { status: 401 }] });
    const action = h.actionFor(file, exported);
    assert.equal((await h.helper(() => action(671, version))).code, 'AUTH_REQUIRED');
    assert.equal(h.calls.filter(c => c === 'refresh').length, 1);
    assert.equal(h.calls.filter(c => c.startsWith('verify:')).length, 2);
    assert.equal(h.receipts.length, 0);
  });

  for (const error of [{ status: 403 }, { status: 500 }]) {
    test(`${exported}: forbidden/unavailable auth is never refreshed or written (${error.status})`, async () => {
      const h = harness({ authErrors: [error] });
      const action = h.actionFor(file, exported);
      assert.ok((await h.helper(() => action(671, version))).error);
      assert.ok(!h.calls.includes('refresh'));
      assert.equal(h.receipts.length, 0);
    });
  }
}

for (const options of [{ session: null }, { sessionError: { status: 400 } },
  { refreshed: null }, { refreshError: { status: 400 } }, { refreshError: { status: 503 } }]) {
  test(`missing or unrenewable session preserves alert without logout: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    let attempts = 0;
    const result = await h.helper(async () => { attempts++; return { code: 'AUTH_REQUIRED', error: 'expired' }; });
    assert.ok(result.error);
    assert.ok(attempts <= 1);
    assert.ok(h.calls.filter(c => c === 'refresh').length <= 1);
    assert.equal(h.receipts.length, 0);
    if (options.refreshError?.status === 503) assert.match(result.error, /temporaneamente/);
    else assert.match(result.error, /Accedi nuovamente/);
  });
}

for (const status of [0, 408, 429, 503]) {
  test(`temporary session error ${status} does not ask for login or invoke action`, async () => {
    const h = harness({ sessionError: { status } });
    const result = await h.helper(() => { throw Error('must not invoke action'); });
    assert.match(result.error, /temporaneamente/);
    assert.doesNotMatch(result.error, /Accedi nuovamente/);
    assert.deepEqual(h.calls, ['getSession']);
  });
}

test('stale event versions and database errors do not cause authentication retries', async () => {
  for (const result of [{ error: 'Avviso cambiato' }, { error: 'Salvataggio fallito' }]) {
    const h = harness();
    assert.equal(await h.helper(async () => result), result);
    assert.deepEqual(h.calls, ['getSession']);
  }
});
