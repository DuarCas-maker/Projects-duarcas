import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Synthetic fixtures only: no credentials, live services, or paid AI requests.
const state = {projects:[{id:"p1",userId:"owner",name:"Malajunta"},{id:"p2",userId:"owner",name:"Otro"},{id:"foreign",userId:"other",name:"Ajeno"}],repositories:[],knowledge:[]};
const files = new Map(); let authorized = true, indexReady = true, calls = [];
const head = "a".repeat(40), tree = "b".repeat(40);
const entries = [
  {path:"README.md",text:"# Malajunta\nEstado documentado, no una aprobación de tareas."},
  {path:"docs/plan.md",text:"Objetivo: contexto separado del proyecto."},
  {path:"src/private.ts",text:"API_KEY="+"sensitivefixture123456789"},
  {path:".env.local",text:"private fixture"},
  {path:"node_modules/example.md",text:"excluded"},
  {path:"link.md",text:"excluded",mode:"120000"},
  {path:"large.md",text:"x".repeat(9000)},
].map((entry,index)=>({...entry,sha:(index+1).toString(16).repeat(40),size:Buffer.byteLength(entry.text),type:"blob",mode:entry.mode??"100644"}));
const context = vm.createContext({Request,Response,Headers,URL,AbortSignal,TextEncoder,TextDecoder,Uint8Array,File,crypto,atob,console,
  fixtureState:state,fixtureFiles:files,
  fixtureAuth:request=>{if(!authorized)throw Object.assign(new Error("Acceso denegado"),{status:401});if(request && request.headers.get("origin")!=="https://app.fixture.test")throw Object.assign(new Error("Origen denegado"),{status:403});return "owner";},
  fixtureIndex:()=>({status:indexReady ? "ready" : "unavailable"}),
  async fetch(url,init){
    calls.push({url,init});const path=new URL(url).pathname;
    if(path.endsWith("/commits/main"))return Response.json({sha:head,commit:{tree:{sha:tree},message:"Proyecto documentado"}});
    if(path.endsWith(`/git/trees/${tree}`))return Response.json({tree:entries,truncated:false});
    if(path.includes("/git/blobs/")){const entry=entries.find(e=>path.endsWith(e.sha));assert.ok(entry);return Response.json({sha:entry.sha,size:entry.size,encoding:"base64",content:Buffer.from(entry.text).toString("base64")});}
    return Response.json({private:false,visibility:"public",full_name:"DuarCas-maker/mala-junta",html_url:"https://github.com/DuarCas-maker/mala-junta",default_branch:"main"});
  }
});
const stubs = {
  "cloudflare:workers":"export const env={};",
  "./index":"export function getDb(){throw new Error('Unexpected local database')} ",
  "./supabase":`export const SUPABASE_TABLES={repositories:'repositories',knowledge:'knowledge'};export const isSupabaseConfigured=()=>true;export class SupabaseConflictError extends Error{};export async function insertSupabaseRow(table,row){if(globalThis.fixtureState[table].some(x=>x.id===row.id))throw new SupabaseConflictError();globalThis.fixtureState[table].push(row);return row;}export async function updateSupabaseRow(table,user,id,patch){const row=globalThis.fixtureState[table].find(x=>x.userId===user && x.id===id);if(!row)throw new Error('scope');Object.assign(row,patch);}export async function uploadSupabaseDocument(key,file){globalThis.fixtureFiles.set(key,await file.text());}`,
  "./workspace":"export async function getWorkspaceState(){return globalThis.fixtureState}",
  "@/db/workspace":"export async function getWorkspaceState(){return globalThis.fixtureState}",
  "./knowledge-search":"export async function indexKnowledge(){return globalThis.fixtureIndex()}",
  "@/lib/brain-provider":"export async function knowledgeText(user,item){if(user!==item.userId || !item.storageKey.startsWith(user+'/'+item.projectId+'/'))throw new Error('scope');return globalThis.fixtureFiles.get(item.storageKey)}",
  "@/lib/workspace-context":"export class WorkspaceConfigurationError extends Error{constructor(message,status){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return globalThis.fixtureAuth(request)}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}"
};
const compiled=await build({stdin:{contents:'export * from "../lib/github-client";export * from "../lib/github-context";export * from "../db/repositories";export * as route from "../app/api/repositories/route";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"github-fixtures",setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:"fixture"}:null);builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:stubs[args.path]}));}}]});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();const api=module.namespace;
assert.equal(api.githubRepositoryUrl("https://github.com/DuarCas-maker/mala-junta.git").repo,"mala-junta");
for(const url of ["http://github.com/a/b","https://github.com/a/b/tree/main","https://evil.test/a/b","https://user:pass@github.com/a/b","https://github.com/a/b?key=x"])assert.throws(()=>api.githubRepositoryUrl(url));
for(const branch of ["../main","main.lock","main x","/main"])assert.throws(()=>api.githubBranch(branch));
const first=await api.linkGithubRepository("owner",state,"p1","https://github.com/DuarCas-maker/mala-junta.git");
assert.equal(first.replayed,false);assert.equal(state.repositories.length,1);
assert.equal((await api.linkGithubRepository("owner",state,"p1","https://github.com/duarcas-maker/MALA-JUNTA")).replayed,true);
await assert.rejects(api.linkGithubRepository("owner",state,"p1","https://github.com/DuarCas-maker/mala-junta","dev"),e=>e.status===409);
await assert.rejects(api.linkGithubRepository("owner",state,"foreign","https://github.com/DuarCas-maker/mala-junta"),e=>e.status===404);
const sync=await api.syncGithubRepository("owner",state,"p1",first.repository.id);
assert.equal(sync.indexPending,false);assert.equal(sync.source.included,2);assert.equal(sync.source.omitted,2);assert.equal(sync.source.excluded,3);
assert.equal(sync.source.activity.comparison,"initial");assert.equal(sync.source.activity.previousSha,null);
assert.equal(state.knowledge.length,1);assert.equal(files.size,1);
assert.ok(sync.source.files.includes("README.md"));assert.ok(!sync.source.files.includes("src/private.ts"));
for(const call of calls){assert.equal(new URL(call.url).origin,"https://api.github.com");assert.equal(call.init.method,"GET");assert.equal(call.init.redirect,"manual");assert.equal(call.init.headers.Authorization,undefined);}
assert.ok(calls.some(c=>c.url.includes(`/git/trees/${tree}`)));
await assert.rejects(api.syncGithubRepository("owner",state,"p1",first.repository.id),e=>e.status===429);
first.repository.lastSync="2020-01-01";indexReady=false;calls=[];
const unchanged=await api.syncGithubRepository("owner",state,"p1",first.repository.id);
assert.equal(unchanged.unchanged,true);assert.equal(unchanged.indexPending,true);assert.equal(calls.length,2);assert.equal(state.knowledge.length,1);
assert.equal(api.projectRepositorySources(state,"owner","p2").length,0);assert.equal(api.projectRepositorySources(state,"other","p1").length,0);
await assert.rejects(api.githubContextPack("owner",state,"p2",first.repository.id),e=>e.status===404);
const pack=await api.githubContextPack("owner",state,"p1");assert.equal(pack.records.length,1);assert.ok(pack.text.includes(head));assert.ok(!pack.text.includes("sensitivefixture"));
// A second repository in the same project remains a separately identified source.
const source2={...sync.source,repositoryId:"repo-two",repo:"second",url:`https://github.com/DuarCas-maker/second/tree/${head}`};
state.repositories.push({...first.repository,id:"repo-two",repo:"second",status:"read_only:item-two"});
state.knowledge.push({...state.knowledge[0],id:"item-two",title:"Segundo repositorio",sourceReference:api.GITHUB_SOURCE_PREFIX+JSON.stringify(source2),storageKey:"owner/p1/item-two.md"});files.set("owner/p1/item-two.md","SECOND REPOSITORY CONTEXT");
assert.equal(api.projectRepositorySources(state,"owner","p1").length,2);
assert.equal((await api.githubContextPack("owner",state,"p1")).records.length,2);
assert.equal((await api.githubContextPack("owner",state,"p1",first.repository.id)).records.length,1);
state.knowledge.at(-1).projectId="p2";assert.equal(api.projectRepositorySources(state,"owner","p1").length,1);
authorized=false;calls=[];
assert.equal((await api.route.GET(new Request("https://app.fixture.test/api/repositories?projectId=p1"))).status,401);assert.equal(calls.length,0);
authorized=true;
assert.equal((await api.route.POST(new Request("https://app.fixture.test/api/repositories",{method:"POST",headers:{Origin:"https://evil.fixture.test"},body:'{"action":"link","projectId":"p1"}'}))).status,403);
assert.equal((await api.route.GET(new Request("https://app.fixture.test/api/repositories?projectId=p2&context=1"))).headers.get("cache-control"),"private, no-store");
assert.equal((await api.route.POST(new Request("https://app.fixture.test/api/repositories",{method:"POST",headers:{Origin:"https://app.fixture.test"},body:"x".repeat(2000)}))).status,413);
const originalFetch=context.fetch;
context.fetch=async()=>Response.json({private:"never echo upstream private details"},{status:403});
await assert.rejects(api.githubGet("/repos/DuarCas-maker/mala-junta"),e=>e.status===429 && !e.message.includes("echo"));
context.fetch=async()=>Response.json({private:true,visibility:"private"});
await assert.rejects(api.githubMetadata("DuarCas-maker","mala-junta"),e=>e.status===403);
context.fetch=async()=>new Response(null,{status:302,headers:{Location:"https://evil.fixture.test"}});
await assert.rejects(api.githubGet("/repos/DuarCas-maker/mala-junta"),e=>e.status===502);
context.fetch=async()=>new Response("x",{headers:{"content-length":String(api.GITHUB_LIMITS.responseBytes+1)}});
await assert.rejects(api.githubGet("/repos/DuarCas-maker/mala-junta"),e=>e.status===413);
context.fetch=originalFetch;
// A second SHA is compared to the pinned previous SHA. Do not retain patches,
// credentials, binary paths, or a claim that a task/deployment is complete.
const changedHead="c".repeat(40),previousHead="d".repeat(40);let comparisonMode="ahead",failComparison=false;
context.fetch=async(url,init)=>{
  const path=new URL(url).pathname;
  if(path.endsWith("/commits/main"))return Response.json({sha:changedHead,commit:{tree:{sha:tree},message:"Technical update only",committer:{date:"2026-10-10T12:00:00Z"}}});
  if(path.includes("/compare/")){
    assert.ok(path.endsWith(`${previousHead}...${changedHead}`));
    if(failComparison)return Response.json({}, {status:404});
    return Response.json({base_commit:{sha:previousHead},status:comparisonMode,ahead_by:2,behind_by:comparisonMode==="diverged" ? 1 : 0,files:[{filename:"README.md",status:"modified",patch:"DO NOT STORE THIS PATCH"},{filename:".env.local",status:"modified"}]});
  }
  return originalFetch(url,init);
};
const updated=await api.readGithubSnapshot("DuarCas-maker","mala-junta","main",previousHead);
assert.equal(updated.activity.comparison,"ahead");assert.equal(updated.activity.files.length,1);assert.equal(updated.activity.partial,true);assert.ok(!JSON.stringify(updated.activity).includes("PATCH") && !JSON.stringify(updated.activity).includes(".env"));
comparisonMode="diverged";assert.equal((await api.readGithubSnapshot("DuarCas-maker","mala-junta","main",previousHead)).activity.comparison,"diverged");
failComparison=true;assert.equal((await api.readGithubSnapshot("DuarCas-maker","mala-junta","main",previousHead)).activity.comparison,"unavailable");
await assert.rejects(api.readGithubSnapshot("DuarCas-maker","mala-junta","main","../bad"),e=>e.status===400);
assert.equal(api.validGithubActivity({...updated.activity,previousSha:"invalid"}),false);
context.fetch=originalFetch;
console.log("GitHub passed: public GET-only, pinned commits, bounded complete files, secret exclusion, idempotency, index retry, multiple-repository isolation, owner auth and CSRF.");
