import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openSqlite, migrate } from '../runtime/sqlite.mjs';

// Real HTTP/SQLite/storage; only Auth is replaced. The preload forbids live APIs.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = process.env.PROJECT_OS_NODE_DIST_DIR === '.next-node-qa' ? '.next-node-qa' : '.next-node';
await cp(join(root, dist, 'static'), join(root, dist, 'standalone', dist, 'static'), {recursive:true});
await cp(join(root, 'public'), join(root, dist, 'standalone', 'public'), {recursive:true});
const directory = await mkdtemp(join(tmpdir(), 'project-os-sharing-'));
const sql = openSqlite(join(directory, 'project-os.sqlite')); migrate(sql); sql.close();
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', new URL('fixtures/auth-upstream.mjs', import.meta.url).href, join(root, dist, 'standalone/server.js')], {cwd:root, env:{
  ...process.env, HOSTNAME:'127.0.0.1', PORT:String(port), NODE_ENV:'production', NEXT_TELEMETRY_DISABLED:'1',
  PROJECT_OS_AUTH_FIXTURE:'synthetic-only', PROJECT_OS_DATA_DIR:directory, PROJECT_OS_BACKEND:'sqlite', PROJECT_OS_WORKSPACE_ID:'existing-workspace',
  PROJECT_OS_APP_URL:origin, SUPABASE_URL:'https://supabase.fixture.test', SUPABASE_PUBLISHABLE_KEY:'public-fixture', SUPABASE_SECRET_KEY:'', PROJECT_OS_OWNER_EMAIL:'owner@fixture.test', PROJECT_OS_OWNER_ID:'', OPENAI_API_KEY:'', GBRAIN_CLIENT_SECRET:'',
}, stdio:['ignore','pipe','pipe']});
let log=''; child.stdout.on('data',data=>{log+=data}); child.stderr.on('data',data=>{log+=data});
const request=(path,init={})=>fetch(origin+path,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});
const ownerHeaders={Cookie:'project_os_access=access-fixture',Origin:origin,'Content-Type':'application/json'};
const owner=async(action,payload)=>{
  const response=await request('/api/action',{method:'POST',headers:ownerHeaders,body:JSON.stringify({action,payload,commandId:crypto.randomUUID()})});
  const data=await response.json();assert.ok(response.ok,`${action}: ${response.status} ${JSON.stringify(data)}`);return data;
};
const share=async(action,projectId,personId)=>{
  const response=await request('/api/project-shares',{method:'POST',headers:ownerHeaders,body:JSON.stringify({action,projectId,personId})});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
};
const sharedHeaders=token=>({Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'});
const publicWrite=(token,body,extra={})=>request('/api/shared-project',{method:'POST',headers:{...sharedHeaders(token),...extra},body:JSON.stringify({requestId:crypto.randomUUID(),...body})});
try {
  for(let attempt=0;;attempt++){
    try{if((await request('/login')).ok)break}catch{}
    if(attempt>60||child.exitCode!==null)throw new Error('Fixture server failed: '+log);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  for(const path of ['/api/project-shares?projectId=x','/api/project-deliveries?projectId=x&deliveryId=x'])assert.equal((await request(path)).status,401,path);
  assert.equal((await request('/compartir')).status,200);
  assert.equal((await request('/api/shared-project')).status,404);
  const projectId=(await owner('create_project',{name:'Colaboración de prueba',operationalStatus:'Activo'})).id;
  const otherProject=(await owner('create_project',{name:'Proyecto confidencial',operationalStatus:'Activo'})).id;
  const personId=(await owner('save_person',{projectId,name:'Ana',email:'ana@fixture.test'})).id;
  const self=(await owner('save_person',{projectId,name:'Propietario',isSelf:true})).id;
  const blocker=(await owner('create_task',{projectId,title:'Preparar contenido privado',primaryId:self})).id;
  const taskId=(await owner('create_task',{projectId,title:'Diseñar portada',primaryId:personId,plannedStart:'2026-10-12',plannedEnd:'2026-10-15',dependsOnTaskIds:[blocker]})).id;
  const foreignTask=(await owner('create_task',{projectId:otherProject,title:'Tarea confidencial'})).id;
  await owner('save_agreement',{projectId,direction:'income',mode:'fixed',title:'Contrato privado',currency:'COP',totalValue:1000000,startDate:'2026-10-11',installments:[{name:'Total',percentage:100}]});
  let {token}=await share('create',projectId,personId);
  const get=token=>request('/api/shared-project',{headers:sharedHeaders(token)});
  let response=await get(token);assert.equal(response.status,200);assert.ok(response.headers.get('cache-control').includes('no-store'));
  let data=await response.json();assert.deepEqual(data.tasks.map(t=>t.id),[taskId]);
  for(const secret of ['Contrato privado','1000000','ana@fixture.test','Proyecto confidencial','Preparar contenido privado','existing-workspace','tokenHash'])assert.ok(!JSON.stringify(data).includes(secret),secret);
  assert.equal((await publicWrite(token,{action:'status',taskId,status:'completed'})).status,409);
  assert.equal((await publicWrite(token,{action:'comment',taskId:foreignTask,body:'Intrusión'})).status,404);
  assert.equal((await publicWrite(token,{action:'comment',taskId,body:'Hola'},{Origin:'https://attacker.fixture.test'})).status,403);
  await owner('update_task_status',{id:blocker,status:'completed'});
  response=await publicWrite(token,{action:'status',taskId,status:'in_progress'});assert.equal(response.status,200);data=await response.json();assert.equal(data.tasks[0].status,'in_progress');
  assert.equal((await publicWrite(token,{action:'status',taskId,status:'review',updatedAt:'stale'})).status,409);
  const comment={action:'comment',taskId,body:'Primera entrega de Ana',requestId:crypto.randomUUID()};
  response=await publicWrite(token,comment);assert.equal(response.status,200);
  response=await publicWrite(token,comment);assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
  const form=new FormData();for(const [key,value]of Object.entries({action:'upload',taskId,requestId:crypto.randomUUID()}))form.set(key,value);
  form.set('file',new File(['entregable de prueba'], 'portada.txt',{type:'text/plain'}));
  response=await request('/api/shared-project',{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:origin},body:form});assert.equal(response.status,200);data=await response.json();
  assert.equal(data.comments.length,1);assert.equal(data.deliveries.length,1);
  const deliveryId=data.deliveries[0].id;
  response=await request(`/api/shared-project?deliveryId=${deliveryId}`,{headers:sharedHeaders(token)});assert.equal(response.status,200);assert.equal(await response.text(),'entregable de prueba');assert.ok(response.headers.get('content-disposition').startsWith('attachment;'));
  assert.equal((await request('/api/shared-project?resourceId=unknown',{headers:sharedHeaders(token)})).status,404);
  const stateResponse=await request('/api/state',{headers:ownerHeaders});const state=await stateResponse.json();
  assert.ok(JSON.stringify(state).includes('Primera entrega de Ana'));assert.ok(!JSON.stringify(state).includes(token));
  const old=token;({token}=await share('create',projectId,personId));assert.equal((await get(old)).status,404);assert.equal((await get(token)).status,200);
  await share('revoke',projectId,personId);assert.equal((await get(token)).status,404);assert.equal((await publicWrite(token,{action:'comment',taskId,body:'Después de revocar'})).status,404);
  ({token}=await share('create',projectId,personId));
  // Membership changes take effect immediately on an already issued link.
  await owner('update_task',{id:taskId,primaryId:self});assert.equal((await (await get(token)).json()).tasks.length,0);
  assert.equal((await request(`/api/shared-project?deliveryId=${deliveryId}`,{headers:sharedHeaders(token)})).status,404);
  await owner('update_task',{id:taskId,primaryId:personId});
  for(let i=0;i<20;i++)assert.equal((await publicWrite(token,{action:'comment',taskId,body:`Prueba ${i}`})).status,200);
  assert.equal((await publicWrite(token,{action:'comment',taskId,body:'Límite'})).status,429);
  ({token}=await share('create',projectId,personId));
  const rotations=await Promise.all([1,2].map(()=>request('/api/project-shares',{method:'POST',headers:ownerHeaders,body:JSON.stringify({action:'create',projectId,personId})})));
  const candidates=[token];
  for(const rotation of rotations){assert.ok([201,409].includes(rotation.status));if(rotation.ok)candidates.push((await rotation.json()).token);}
  const live=[];for(const candidate of candidates)if((await get(candidate)).ok)live.push(candidate);
  assert.equal(live.length,1);token=live[0];
  const listing=await (await request(`/api/project-shares?projectId=${projectId}`,{headers:ownerHeaders})).json();assert.equal(listing.shares.filter(s=>s.personId===personId&&s.active).length,1);
  console.log('Sharing HTTP passed: scoped anonymous access, hidden finances, dependency enforcement, comments, deliverable upload/download, idempotent retries, conflicts, cross-origin protection, rotation/revocation, membership changes, rate limits and private routes. Live API calls: 0.');
  if(process.argv.includes('--preview')){
    await writeFile(join(root,'outputs/sharing-preview.json'),JSON.stringify({origin,projectId,personId,taskId,shareUrl:`${origin}/compartir#${token}`}));
    console.log(`Synthetic browser preview ready at ${origin}/login`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});
  }
} finally {
  child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');await rm(directory,{recursive:true,force:true});
}
