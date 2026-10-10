import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../runtime/sqlite.mjs';
import { initializeNamesOnly, namesOnlySettings, namesOnlyProjectRows } from '../runtime/names-only.mjs';
import { requireAuxiliaryImport } from '../runtime/import-auxiliary.mjs';

const env = {
  PROJECT_OS_WORKSPACE_ID:'clean_00000000000000000000000000000001',
  PROJECT_OS_INITIAL_PROJECT_NAMES:JSON.stringify(['Proyecto uno','Proyecto dos']),
  SUPABASE_URL:'https://supabase.fixture.test',SUPABASE_SECRET_KEY:'server-fixture-never-log',
};
const open = () => { const sql = new DatabaseSync(':memory:'); migrate(sql); return sql; };
const databases = [];
const db = () => { const sql = open(); databases.push(sql); return sql; };
const fixture = () => {
  const state = {marker:false,projects:[],extra:{},calls:[],failAfterInsert:null,redirect:false};
  state.fetch = async (input, init) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1);
    assert.equal(url.origin,env.SUPABASE_URL); assert.equal(init.redirect,'manual');
    assert.equal(init.headers.apikey,env.SUPABASE_SECRET_KEY);
    assert.ok(['GET','POST'].includes(init.method),'No update or delete request is permitted');
    state.calls.push({table,method:init.method});
    if (state.redirect) return new Response('proxy-secret-body',{status:302,headers:{location:'https://attacker.fixture.test'}});
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(init.headers.Prefer,'resolution=ignore-duplicates,return=minimal');
      if (table === 'projects') {
        for (const row of body) {
          assert.equal(row.user_id,env.PROJECT_OS_WORKSPACE_ID);
          if (!state.projects.some(item => item.id === row.id)) state.projects.push(row);
        }
      } else { assert.equal(table,'workspace_bootstrap'); assert.equal(body.user_id,env.PROJECT_OS_WORKSPACE_ID); state.marker=true; }
      if (state.failAfterInsert === table) { state.failAfterInsert=null; return new Response('proxy-secret-body',{status:503}); }
      return new Response(null,{status:204});
    }
    assert.equal(url.searchParams.get('user_id'),`eq.${env.PROJECT_OS_WORKSPACE_ID}`);
    assert.ok(Number(url.searchParams.get('limit')) <= 101);
    const rows = table === 'workspace_bootstrap' ? state.marker ? [{user_id:env.PROJECT_OS_WORKSPACE_ID}] : [] : table === 'projects' ? state.projects : state.extra[table] || [];
    return Response.json(rows);
  };
  return state;
};

try {
  for (const patch of [
    {PROJECT_OS_WORKSPACE_ID:'existing-site'}, {PROJECT_OS_INITIAL_PROJECT_NAMES:'[]'},
    {PROJECT_OS_INITIAL_PROJECT_NAMES:'["Duplicado","duplicado"]'},
    {PROJECT_OS_INITIAL_PROJECT_NAMES:'[{"name":"Nombre","tasks":[1]}]'},
    {PROJECT_OS_INITIAL_PROJECT_NAMES:'not-json'}, {PROJECT_OS_INITIAL_PROJECT_NAMES:JSON.stringify(['x'.repeat(181)])},
    {SUPABASE_URL:'http://supabase.fixture.test'}, {SUPABASE_SECRET_KEY:''},
  ]) assert.throws(() => namesOnlySettings({...env,...patch}));

  const rows = namesOnlyProjectRows(namesOnlySettings(env),'2026-10-10T12:00:00.000Z');
  assert.equal(rows.length,2); assert.equal(new Set(rows.map(row => row.id)).size,2);
  for (const row of rows) {
    assert.equal(row.description,''); assert.equal(row.current_summary,''); assert.equal(row.next_step_summary,'');
    assert.equal(row.target_end_date,null); assert.equal(row.blocked_reason,null);
    assert.equal(row.operational_status,'Por iniciar'); assert.equal(row.commercial_status,'Sin definir');
  }
  const live = fixture(), sql = db();
  const initial = await initializeNamesOnly(sql,env,live.fetch);
  assert.equal(initial.initialized,true); assert.equal(live.projects.length,2); assert.ok(live.marker);
  assert.equal(sql.prepare('SELECT phase FROM _workspace_initializations').get().phase,'ready');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM ai_runs').get().n,0);
  assert.throws(() => requireAuxiliaryImport(sql,env.PROJECT_OS_WORKSPACE_ID),'A clean receipt is not an invented history import');
  // Normal subsequent edits and deletions are preserved, not silently reseeded.
  live.projects[0].name='Nombre editado'; live.projects.pop(); live.extra.tasks=[{id:'owner-task'}];
  const writes = live.calls.filter(call => call.method==='POST').length;
  assert.equal((await initializeNamesOnly(sql,env,live.fetch)).initialized,false);
  assert.equal(live.calls.filter(call => call.method==='POST').length,writes);
  assert.equal(live.projects.length,1); assert.equal(live.projects[0].name,'Nombre editado');
  await assert.rejects(initializeNamesOnly(sql,{...env,PROJECT_OS_INITIAL_PROJECT_NAMES:'["Otra lista"]'},live.fetch),/configuration changed/);
  // A replacement volume cannot silently wipe auxiliary history.
  await assert.rejects(initializeNamesOnly(db(),env,live.fetch),/original volume is missing/);
  live.marker=false;
  await assert.rejects(initializeNamesOnly(sql,env,live.fetch),/never recreated/);

  for (const table of ['projects','workspace_bootstrap']) {
    const retry = fixture(), pending = db(); retry.failAfterInsert=table;
    await assert.rejects(initializeNamesOnly(pending,env,retry.fetch),/503/);
    assert.equal(pending.prepare('SELECT phase FROM _workspace_initializations').get().phase,'preparing');
    assert.equal((await initializeNamesOnly(pending,env,retry.fetch)).phase,'ready');
    assert.equal(retry.projects.length,2); assert.equal(new Set(retry.projects.map(row=>row.id)).size,2);
  }
  const populated = fixture(); populated.projects=rows;
  await assert.rejects(initializeNamesOnly(db(),env,populated.fetch),/destination workspace is not empty/);
  assert.ok(populated.calls.every(call=>call.method==='GET'));
  const extra = fixture(); extra.extra.knowledge_items=[{id:'existing-document'}];
  await assert.rejects(initializeNamesOnly(db(),env,extra.fetch),/already has content/);
  assert.ok(extra.calls.every(call=>call.method==='GET'));
  const imported = db(); imported.exec('CREATE TABLE _auxiliary_imports (workspace_id TEXT); INSERT INTO _auxiliary_imports VALUES (\'old\')');
  await assert.rejects(initializeNamesOnly(imported,env,fixture().fetch),/imported history/);
  const foreign = db(); foreign.prepare('INSERT INTO projects (id,user_id,name,short_code,project_type,operational_status,commercial_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('old','other-workspace','Old','OLD','Propio','Activo','Interno','now','now');
  const guarded = fixture(); await assert.rejects(initializeNamesOnly(foreign,env,guarded.fetch),/existing data/); assert.equal(guarded.calls.length,0);
  const redirect = fixture(); redirect.redirect=true;
  await assert.rejects(initializeNamesOnly(db(),env,redirect.fetch),error=>error.message.includes('302') && !error.message.includes('proxy-secret-body'));
  await assert.rejects(initializeNamesOnly(db(),env,async()=>{throw new Error('network-'+env.SUPABASE_SECRET_KEY);}),error=>!error.message.includes(env.SUPABASE_SECRET_KEY));
  await assert.rejects(initializeNamesOnly(db(),env,async()=>Response.json({error:'unexpected'})),/Invalid initialization response/);
  await assert.rejects(initializeNamesOnly(db(),env,async()=>new Response('x'.repeat(1024*1024+1))),/exceeded its limit/);
  console.log('Names-only passed: fresh scoped projects, empty content, persistent receipt, crash recovery, no reseeding, no overwrites, lost-volume guard, credential/origin validation. Live API calls: 0.');
} finally { for (const sql of databases) sql.close(); }
