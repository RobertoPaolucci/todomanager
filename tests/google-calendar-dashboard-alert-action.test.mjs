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
  const action = load('app/google-calendar-alert-actions.ts', {
    'next/headers':{cookies:async()=>({get:name=>{assert.equal(name,'tm-auth-token');return token ? {value:token} : undefined;}})},
    'next/cache':{revalidatePath:path=>refreshed.push(path)},
    '@/lib/supabase-server':{supabaseServer:{
      auth:{getUser:async value=>{calls.push(['getUser',value]);return {data:{user},error:authError};}},
      rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(throws) throw Error('network');return {data:saved,error:dbError};},
    }},
  }).acknowledgeGoogleCalendarAlert;
  return {action,calls,refreshed};
}

test('verified server user is recorded; only dedicated receipt RPC is called and Dashboard is revalidated',async()=>{
  const h=actionHarness();
  assert.equal((await h.action(625,version)).success,true);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[0][0],'getUser');
  assert.equal(h.calls[1][1],'acknowledge_google_calendar_dashboard_alert');
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
  for(const [id,v] of [[-1,version],[1.5,version],[625,''],[625,'forged']]) assert.ok((await h.action(id,v)).error);
  assert.equal(h.calls.length,0);
});

const nodes=tree=>Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree==='object' ? [tree,...nodes(tree.props?.children)] : [];
function buttonHarness(action) {
  let error=null,pending=false,refreshes=0;
  const tasks=[];
  const jsx=(type,props)=>({type,props});
  const Component=load('components/GoogleCalendarAlertReadButton.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},
    react:{useState:()=>[error,value=>{error=value;}],useTransition:()=>[pending,callback=>{
      pending=true;tasks.push(Promise.resolve().then(callback).finally(()=>{pending=false;}));
    }]},
    'next/navigation':{useRouter:()=>({refresh:()=>{refreshes++;}})},
    '@/lib/dashboard-alert-session': { withDashboardAlertSession: action => action() },
    '@/app/google-calendar-alert-actions':{acknowledgeGoogleCalendarAlert:action},
  }).default;
  return {render:()=>Component({alertId:625,eventVersion:version}),flush:()=>Promise.all(tasks),get refreshes(){return refreshes;}};
}

test('button waits for persistence then refreshes Dashboard without navigation',async()=>{
  let complete;
  const h=buttonHarness(()=>new Promise(resolve=>{complete=resolve;}));
  const tree=h.render();
  assert.equal(nodes(tree).find(n=>n.type==='button').props.children,'Letto · Nascondi avviso');
  nodes(tree).find(n=>n.type==='button').props.onClick();
  assert.equal(nodes(h.render()).find(n=>n.type==='button').props.disabled,true);
  assert.equal(h.refreshes,0);
  await Promise.resolve();
  complete({success:true});
  await h.flush();
  assert.equal(h.refreshes,1);
});
for(const action of [async()=>({error:'Salvataggio fallito'}),async()=>{throw Error('network');}]) {
  test('failed button action keeps alert visible, enables retry and renders accessible error',async()=>{
    const h=buttonHarness(action);
    nodes(h.render()).find(n=>n.type==='button').props.onClick();
    await h.flush();
    assert.equal(h.refreshes,0);
    const tree=h.render();
    assert.equal(nodes(tree).find(n=>n.type==='button').props.disabled,false);
    assert.ok(nodes(tree).some(n=>n.props?.role==='alert' && n.props.children));
  });
}

for (const [authError, expected] of [
  [{status:401}, 'AUTH_REQUIRED'], [{status:403,code:'bad_jwt'}, 'AUTH_REQUIRED'],
  [{status:403,code:'session_not_found'}, 'AUTH_REQUIRED'], [{status:403}, 'FORBIDDEN'],
  [{status:500}, 'AUTH_UNAVAILABLE'], [{status:0}, 'AUTH_UNAVAILABLE'],
]) {
  test(`authentication classification ${JSON.stringify(authError)} never writes`, async () => {
    const h=actionHarness({authError});
    const result=await h.action(671,version);
    assert.equal(result.code,expected);
    assert.ok(h.calls.every(call=>call[0]!=='rpc'));
    assert.equal(h.refreshed.length,0);
  });
}
