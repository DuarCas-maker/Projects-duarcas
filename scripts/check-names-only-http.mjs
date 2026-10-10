import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const directory = await mkdtemp(join(tmpdir(),'project-os-clean-http-'));
assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\') || resolve(directory).startsWith(resolve(tmpdir())+'/'));
const data = join(directory,'data'), remote = join(directory,'synthetic-supabase.json');
const portHolder = createServer(); portHolder.listen(0,'127.0.0.1'); await once(portHolder,'listening');
const port = portHolder.address().port; await new Promise(resolve=>portHolder.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const workspace = 'clean_00000000000000000000000000000001';
const config = {
  ...process.env, NODE_ENV:'production', HOSTNAME:'127.0.0.1',PORT:String(port),NEXT_TELEMETRY_DISABLED:'1',
  PROJECT_OS_NAMES_ONLY_FIXTURE:'synthetic-only',PROJECT_OS_NAMES_ONLY_FIXTURE_FILE:remote,
  PROJECT_OS_WORKSPACE_ID:workspace,PROJECT_OS_DATA_DIR:data,PROJECT_OS_BACKEND:'supabase',
  PROJECT_OS_APP_URL:'https://app.fixture.test',PROJECT_OS_OWNER_EMAIL:'owner@fixture.test',PROJECT_OS_OWNER_ID:'',
  SUPABASE_URL:'https://supabase.fixture.test',SUPABASE_SECRET_KEY:'synthetic-server-key',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',
  PROJECT_OS_INITIALIZATION_MODE:'names-only',PROJECT_OS_INITIAL_PROJECT_NAMES:'["Proyecto uno","Proyecto dos"]',
  PROJECT_OS_REQUIRE_AUXILIARY_IMPORT:'true',OPENAI_API_KEY:'',GBRAIN_CLIENT_SECRET:'',
};
let child, log;
const start = (extra={}) => {
  log=''; child=spawn(process.execPath,['--import',new URL('fixtures/names-only-upstream.mjs',import.meta.url).href,'scripts/start-node.mjs'],{env:{...config,...extra},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{log+=data;}); child.stderr.on('data',data=>{log+=data;});
};
const stop = async () => { if (child?.exitCode===null) { child.kill('SIGTERM'); await once(child,'exit'); } };
const ready = async () => {
  for (let attempt=0; attempt<100; attempt++) {
    if (child.exitCode!==null) throw new Error('Fixture startup failed: '+log);
    try { if ((await fetch(origin+'/login',{signal:AbortSignal.timeout(1000)})).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Fixture server did not start');
};
try {
  start(); await ready();
  assert.ok(log.includes('"initialized":true'));
  assert.equal((await fetch(origin+'/',{redirect:'manual'})).headers.get('location'),'/login');
  assert.equal((await fetch(origin+'/api/state')).status,401);
  await stop();
  const sql = new DatabaseSync(join(data,'project-os.sqlite'));
  assert.equal(sql.prepare('SELECT phase FROM _workspace_initializations').get().phase,'ready');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM ai_runs').get().n,0);
  sql.prepare('INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) VALUES (?,?,?,?,?,?,?,?,?)').run('new-analysis',workspace,'new-project','chat','new-owner-data','completed','2026-10-10','2026-10-10T12:00:00.000Z','fixture');
  sql.close();
  const state = JSON.parse(await readFile(remote,'utf8'));
  assert.equal(state.projects.length,2);
  state.projects[0].name='Nombre completado por el propietario';
  state.projects[0].current_summary='Información nueva, no datos de pruebas anteriores.';
  await writeFile(remote,JSON.stringify(state));
  start(); await ready(); assert.ok(log.includes('"initialized":false')); await stop();
  const kept = new DatabaseSync(join(data,'project-os.sqlite'),{readOnly:true});
  assert.equal(kept.prepare('SELECT COUNT(*) n FROM ai_runs').get().n,1); kept.close();
  assert.equal(JSON.parse(await readFile(remote,'utf8')).projects[0].name,state.projects[0].name);
  start({PROJECT_OS_DATA_DIR:join(directory,'replacement-volume')});
  const [code] = await once(child,'exit'); assert.notEqual(code,0); assert.ok(log.includes('original volume is missing'));
  console.log('Names-only HTTP startup passed: actual entrypoint, first initialization, private routes, restart without reseeding, preserved new data, missing-volume refusal. Live API calls: 0.');
} finally { await stop(); await rm(directory,{recursive:true,force:true}); }
