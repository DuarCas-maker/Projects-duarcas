import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite,migrate,d1Adapter } from "../runtime/sqlite.mjs";
const dir=await mkdtemp(join(tmpdir(),"task-merge-http-")),sql=openSqlite(join(dir,"fixture.sqlite"));migrate(sql);const DB=d1Adapter(sql);
const owner="merge-http-fixture",projectId="fixture-project";
const time=new Date().toISOString();
sql.prepare("INSERT INTO projects(id,user_id,name,short_code,project_type,operational_status,commercial_status,created_at,updated_at) VALUES (?,?,?,?,'Por alcance','Activo','Sin definir',?,?)").run(projectId,owner,"Proyecto ficticio","FIX",time,time);
for(const id of ["first","second","third","fourth"])sql.prepare("INSERT INTO tasks(id,user_id,project_id,title,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id,owner,projectId,"Coordinar reunión "+id,"Reunión de diseño",time,time);
const tables={projects:"projects",tasks:"tasks",milestones:"milestones",dependencies:"task_dependencies",financials:"project_financials",events:"project_events",suggestions:"ai_suggestions",inbox:"inbox_items",calendar:"calendar_blocks",knowledge:"knowledge_items",repositories:"repositories",operations:"project_operations"};
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,x)=>x.toUpperCase()),v]));
const refresh=()=>Object.fromEntries(Object.entries(tables).map(([key,table])=>[key,sql.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(owner).map(camel)]));
let calls=0,providerMode="completed";
const draftFor=ids=>({mode:"single",title:"Coordinar reunión de diseño",description:"Resultado común",primaryId:null,deadline:null,reason:"Las convocatorias son equivalentes.",conflicts:[],groups:[{taskIds:ids,title:"Coordinar reunión de diseño",description:"Una convocatoria",criteria:"Invitación enviada",primaryId:null,deadline:null,estimatedMinutes:30,status:"pending"}]});
let draft=draftFor(["first","second"]);
const stubs={
  "cloudflare:workers":"export const env=globalThis.fixtureEnv;",
  "@/db/workspace":"export async function getWorkspaceState(){return globalThis.refresh();}",
  "@/db/supabase":"export const isSupabaseConfigured=()=>false;export function applySupabaseChanges(){throw Error('Unexpected upstream')};export class SupabaseConflictError extends Error{};",
  "@/lib/workspace-context":"export class WorkspaceConfigurationError extends Error{constructor(message,status){super(message);this.status=status}};export async function currentWorkspaceId(request){if(request.headers.get('x-fixture-owner')!=='yes')throw new WorkspaceConfigurationError('Owner required',403);return 'merge-http-fixture';}",
};
const compiled=await build({entryPoints:[fileURLToPath(new URL("../app/api/tasks/merge/route.ts",import.meta.url))],bundle:true,platform:"node",format:"esm",write:false,plugins:[{name:"synthetic-adapters",setup(b){b.onResolve({filter:/.*/},a=>{const path=["./workspace","./supabase"].includes(a.path)?"@/db/"+a.path.slice(2):a.path;return Object.hasOwn(stubs,path)?{path,namespace:"fixture"}:undefined;});b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:stubs[a.path],loader:"js"}));}}]});
const context=vm.createContext({crypto,Date,Intl,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Request,Response,console,refresh,fixtureEnv:{DB,OPENAI_API_KEY:"synthetic-key",PROJECT_OS_AI_CONTEXT_ENABLED:"true"},
  async fetch(url,options){assert.equal(url,"https://api.openai.com/v1/responses");calls++;const sent=JSON.parse(options.body);assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.ok(!sent.input[0].content.includes("synthetic-key"));return Response.json({status:providerMode,output:[{content:[{type:"output_text",text:JSON.stringify(draft)}]}],usage:{input_tokens:20,output_tokens:40}});}
});
const route=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await route.link(()=>{});await route.evaluate();
const post=(body,authorized=true)=>route.namespace.POST(new Request("https://fixture.test/api/tasks/merge",{method:"POST",headers:{"Content-Type":"application/json","x-fixture-owner":authorized?"yes":"no"},body:JSON.stringify(body)}));
try {
  const generation={action:"generate",projectId,ids:["first","second"],requestId:crypto.randomUUID()};
  assert.equal((await post(generation,false)).status,403);assert.equal(calls,0);
  assert.equal((await post({...generation,ids:["first","foreign"]})).status,409);assert.equal(calls,0);
  const result=await post(generation);assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM tasks").get().n,4);assert.equal(refresh().events.length,0);
  assert.equal((await post(generation)).status,200);assert.equal(calls,1);
  const application={action:"apply",projectId,requestId:generation.requestId,draft};
  assert.equal((await post({...application,draft:{...draft,groups:[{...draft.groups[0],taskIds:["first","foreign"]}]}})).status,409);
  const applied=await post(application);assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
  assert.equal(refresh().tasks.find(t=>t.id==="second").sourceType,"task_merge");
  assert.equal((await (await post(application)).json()).replayed,true);assert.equal(calls,1);assert.equal(refresh().events.length,1);
  draft=draftFor(["third","fourth"]);const stale={...generation,ids:["third","fourth"],requestId:crypto.randomUUID()};
  assert.equal((await post(stale)).status,200);
  sql.prepare("UPDATE tasks SET description=?,updated_at=? WHERE id='fourth'").run("Cambio concurrente",new Date().toISOString());
  assert.equal((await post({action:"apply",projectId,requestId:stale.requestId,draft})).status,409);
  providerMode="incomplete";assert.equal((await post({...stale,requestId:crypto.randomUUID()})).status,502);
  assert.equal((await post({...stale,requestId:crypto.randomUUID()})).status,429);assert.equal(calls,3);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE status='failed'").get().n,1);
  console.log("Merge HTTP passed: owner/scope checks, no task changes before approval, real structured provider parsing, shared SQL quota, atomic persistence, replay, invalid grouping, stale snapshot and incomplete response. Live API calls: 0.");
}finally{sql.close();await rm(dir,{recursive:true,force:true});}
