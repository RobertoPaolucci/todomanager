import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const version = `v1:${'a'.repeat(32)}`;
function load(file, mocks) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module:mod, exports:mod.exports, require(name) {
    if (!(name in mocks)) throw Error(`Unexpected import ${name}`);
    return mocks[name];
  } });
  return mod.exports;
}
function actionHarness({ token='real-session', user={id:'server-verified-user',role:'authenticated',is_anonymous:false},
  authError=null, saved=true, dbError=null, throws=false }={}) {
  const calls=[], refreshed=[];
  const action = load('app/booking-cancellation-alert-actions.ts', {
    'next/headers':{cookies:async()=>({get:name=>{assert.equal(name,'tm-auth-token');return token ? {value:token} : undefined;}})},
    'next/cache':{revalidatePath:path=>refreshed.push(path)},
    '@/lib/supabase-server':{supabaseServer:{
      auth:{getUser:async value=>{calls.push(['getUser',value]);return {data:{user},error:authError};}},
      rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(throws) throw Error('network');return {data:saved,error:dbError};},
    }},
  }).acknowledgeBookingCancellationAlert;
  return {action,calls,refreshed};
}

test('verified server user is recorded; only dedicated receipt RPC is called and Dashboard is revalidated',async()=>{
  const h=actionHarness();
  assert.equal((await h.action(625,version)).success,true);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[0][0],'getUser');
  assert.equal(h.calls[1][1],'acknowledge_booking_cancellation_alert');
  assert.equal(h.calls[1][2].actor_id,'server-verified-user');
  assert.equal(h.calls[1][2].alert_id,625);
  assert.equal(h.calls[1][2].expected_version,version);
  assert.deepEqual(h.refreshed,['/']);
});

for(const options of [{token:null},{user:null},{authError:{message:'expired'}},
  {user:{id:'anon',role:'authenticated',is_anonymous:true}},{user:{id:'anon',role:'anon'}}]) {
  test(`unauthorized session rejected without writes: ${JSON.stringify(options)}`,async()=>{
    const h=actionHarness(options);
    assert.ok((await h.action(625,version)).error);
    assert.ok(h.calls.every(call=>call[0]!=='rpc'));
    assert.equal(h.refreshed.length,0);
  });
}
for(const options of [{saved:false},{dbError:{message:'missing migration'}},{throws:true}]) {
  test(`stale version or save error never hides notification: ${JSON.stringify(options)}`,async()=>{
    const h=actionHarness(options);
    assert.ok((await h.action(625,version)).error);
    assert.equal(h.refreshed.length,0);
  });
}
test('invalid IDs/versions rejected before authentication or data access',async()=>{
  const h=actionHarness();
  for(const [id,v] of [[-1,version],[1.5,version],['625',version],[625,''],[625,'forged'],[625,null],[625,{}]]) assert.ok((await h.action(id,v)).error);
  assert.equal(h.calls.length,0);
});

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object'
  ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);

// Stateful component harness: execute the real list and its per-row buttons,
// retaining independent hook state while the mocked network request is pending.
function listHarness(action, rows = [1, 2].map(id => ({ id, notes: '🔴 Prenotazione cancellata',
  customer_name: `Customer ${id}`, is_cancelled: true, dashboard_event_version: version }))) {
  const states = new Map(), tasks = [];
  let path = '', index = 0, refreshes = 0;
  const useState = initial => {
    const key = `${path}:${index++}`;
    if (!states.has(key)) states.set(key, initial);
    return [states.get(key), value => states.set(key, typeof value === 'function' ? value(states.get(key)) : value)];
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const List = load('components/NotificationCenterList.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    '@/app/booking-cancellation-alert-actions': { acknowledgeBookingCancellationAlert: action },
    react: { useState, useTransition: () => {
      const [pending, setPending] = useState(false);
      return [pending, callback => {
        setPending(true);
        tasks.push(Promise.resolve().then(callback).finally(() => setPending(false)));
      }];
    } },
  }).default;
  function resolve(tree, at) {
    if (Array.isArray(tree)) return tree.map((item, i) => resolve(item, `${at}/${item?.key ?? i}`));
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') {
      path = at; index = 0;
      return resolve(tree.type(tree.props), `${at}/rendered`);
    }
    return { ...tree, props: { ...tree.props, children: resolve(tree.props?.children, `${at}/children`) } };
  }
  return {
    render: () => resolve(jsx(List, { initialAlerts: rows, loadError: null }), 'list'),
    replaceRows: next => { rows = next; },
    flush: () => Promise.all(tasks),
    get refreshes() { return refreshes; },
  };
}

test('click saves one cancellation before removing it and decrementing the counter without navigation', async () => {
  let complete;
  const calls = [];
  const h = listHarness((id, v) => { calls.push([id, v]); return new Promise(resolve => { complete = resolve; }); });
  assert.match(text(h.render()), /2 Avvisi/);
  nodes(h.render()).find(n => n.type === 'button').props.onClick();
  const pending = h.render();
  assert.match(text(pending), /2 Avvisi/);
  assert.equal(nodes(pending).filter(n => n.type === 'button')[0].props.disabled, true);
  assert.equal(nodes(pending).filter(n => n.type === 'button')[1].props.disabled, false);
  assert.equal(h.refreshes, 0);
  await Promise.resolve();
  assert.deepEqual(calls, [[1, version]]);
  complete({ success: true });
  await h.flush();
  const tree = h.render();
  assert.match(text(tree), /1 Avviso/);
  assert.doesNotMatch(text(tree), /Customer 1/);
  assert.match(text(tree), /Customer 2/);
  assert.equal(h.refreshes, 1);
  assert.deepEqual(nodes(tree).filter(n => n.type === 'a').map(n => n.props.href), ['/prenotazioni?highlight=2']);
});

for (const action of [async () => ({ error: 'Salvataggio fallito' }), async () => { throw Error('network'); },
  async () => ({ error: 'Sessione scaduta' }), async () => ({})]) {
  test('save/auth/network error preserves row and counter, shows error and enables retry', async () => {
    const h = listHarness(action);
    nodes(h.render()).find(n => n.type === 'button').props.onClick();
    await h.flush();
    const tree = h.render();
    assert.match(text(tree), /2 Avvisi/);
    assert.match(text(tree), /Customer 1/);
    assert.equal(h.refreshes, 0);
    assert.ok(nodes(tree).some(n => n.props?.role === 'alert' && text(n)));
    assert.ok(nodes(tree).filter(n => n.type === 'button').every(n => n.props.disabled === false));
  });
}

test('independent clicks remove both alerts; a new version of the same booking remains visible', async () => {
  const h = listHarness(async () => ({ success: true }));
  for (const button of nodes(h.render()).filter(n => n.type === 'button')) button.props.onClick();
  await h.flush();
  assert.match(text(h.render()), /Nessun avviso da leggere/);
  h.replaceRows([{ id: 1, customer_name: 'New situation', notes: '🔴 Prenotazione cancellata',
    dashboard_event_version: `v1:${'b'.repeat(32)}` }]);
  assert.match(text(h.render()), /1 Avviso/);
  assert.match(text(h.render()), /New situation/);
});

test('unrelated alerts have a booking link but no read action', () => {
  const h = listHarness(() => { throw Error('must not run'); }, [
    { id: 3, notes: '🟢 Nuova prenotazione', is_cancelled: false },
    { id: 4, notes: '🟡 Prenotazione modificata', is_cancelled: false },
    { id: 5, notes: '🔴 Altro problema', is_cancelled: true },
  ]);
  const tree = h.render();
  assert.equal(nodes(tree).filter(n => n.type === 'button').length, 0);
  assert.equal(nodes(tree).filter(n => n.type === 'a').length, 3);
});

