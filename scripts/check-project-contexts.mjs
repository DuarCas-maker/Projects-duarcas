import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

// Exercise real uploads, original extraction, analysis, revisions and approvals.
// All documents/storage/SQL/provider responses are isolated synthetic fixtures.
const sql=new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../drizzle/0001_empty_blade.sql",import.meta.url),"utf8"));
const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {async first(){return statement.get(...args);},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:statement.run(...args).changes}};}};}};}};
const userId="context-owner",projectId="context-project",id=crypto.randomUUID();
const text="Objetivo: diseñar la portada de la web del proyecto.\n```env\nOPENAI_API_KEY=\nOPENAI_DISCOVERY_MODEL=\nSUPABASE_SERVICE_ROLE_KEY=\n```\n"+"Información de contexto ficticia, sin acciones adicionales.\n".repeat(1400)+"Requisito: preparar el informe de requisitos del proyecto para el 20 de octubre de 2026.";
const storage=new Map(),fixtureEnv={DB,OPENAI_API_KEY:"synthetic-fixture-key",PROJECT_OS_AI_CONTEXT_ENABLED:"true"};
const workspace={projects:[{id:projectId,userId,name:"Contexto ficticio"},{id:"other-project",userId,name:"Otro proyecto"}],knowledge:[],tasks:[],suggestions:[],events:[],dependencies:[],milestones:[],financials:[],operations:[],calendar:[],inbox:[],repositories:[]};
let uploads=0,requests=0,denied=0,indexed=0,lastBody,providerStatus=200;
function apply(plan){for(const change of plan.changes){const key={tasks:"tasks",ai_suggestions:"suggestions",project_events:"events"}[change.table];assert.ok(key);const row=Object.fromEntries(Object.entries(change.row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));workspace[key]=workspace[key].filter(item=>item.id!==row.id);workspace[key].push(row);}}
const adapters={
  async currentWorkspaceId(request){if(denied)throw Object.assign(Error("Owner required"),{status:denied});if(request&&request.headers.get("origin")!=="https://app.fixture.test")throw Object.assign(Error("Origin rejected"),{status:403});return userId;},
  async getWorkspaceState(){return structuredClone(workspace);},
  async insertSupabaseRow(_table,item){workspace.knowledge.push(structuredClone(item));},
  async uploadSupabaseDocument(key,file){uploads++;storage.set(key,new Uint8Array(await file.arrayBuffer()));},
  async getSupabaseDocumentBytes(key){assert.ok(storage.has(key));return storage.get(key);},
  async indexKnowledge(){indexed++;},
  async persistCorePlan(owner,plan){assert.equal(owner,userId);apply(plan);return {state:structuredClone(workspace),id:plan.id};},
};
const stubs={
  "cloudflare:workers":"export const env=globalThis.fixtureEnv;",
  "@/db":"export function getDb(){throw Error('Unexpected database access')}",
  "@/db/schema":"export const knowledgeItems={};",
  "@/db/workspace":"export const getWorkspaceState=globalThis.adapters.getWorkspaceState;",
  "@/db/knowledge-search":"export const indexKnowledge=globalThis.adapters.indexKnowledge;",
  "@/db/core-mutations":"export const persistCorePlan=globalThis.adapters.persistCorePlan;",
  "@/lib/workspace-context":"export class WorkspaceConfigurationError extends Error{constructor(message,status=503){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return await globalThis.adapters.currentWorkspaceId(request)}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}",
  "@/db/supabase":"export const isSupabaseConfigured=()=>true;export const SUPABASE_TABLES={knowledge:'knowledge_items'};export const {insertSupabaseRow,uploadSupabaseDocument,getSupabaseDocumentBytes}=globalThis.adapters;export class SupabaseConflictError extends Error{};export function updateSupabaseRow(){throw Error('Unexpected update')}",
};
const compiled=await build({stdin:{contents:'import * as upload from "../app/api/project-contexts/route";import * as meetings from "../app/api/meetings/route";import * as analysis from "../app/api/meetings/analyze/route";import * as revise from "../app/api/meetings/revise/route";export {upload,meetings,analysis,revise};export * from "../lib/meetings";export * from "../lib/brain-provider";export * from "../lib/brain-content";export * from "../lib/daily-commands";export * from "../lib/meeting-proposals";export * from "../lib/global-search";export * from "../lib/ai-context";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",packages:"external",write:false,plugins:[{name:"context-fixtures",setup(builder){builder.onResolve({filter:/^(?:cloudflare:workers|@\/)/},args=>args.path in stubs?{path:args.path,namespace:"fixture"}:undefined);builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:stubs[args.path],loader:"js"}));}}]});
const context=vm.createContext({adapters,fixtureEnv,crypto,TextEncoder,TextDecoder,Uint8Array,URL,Request,Response,FormData,File,Blob,AbortSignal,Intl,Date,console,async fetch(url,options){
  assert.equal(url,"https://api.openai.com/v1/responses","Only the mocked provider may be called");requests++;lastBody=JSON.parse(options.body);
  if(providerStatus!==200)return Response.json({error:"Synthetic failure"},{status:providerStatus});
  const input=JSON.parse(lastBody.input[0].content);
  if(lastBody.text.format.name==="project_os_meeting_revision")return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({kind:"task",title:"Revisar objetivos de la portada",description:"Corrección ficticia del usuario",date:null,priority:3,urgency:3,estimatedMinutes:30})}]}]});
  assert.equal(input.metadata.resourceKind,"project_context");assert.equal(input.metadata.date,"");
  assert.match(lastBody.instructions,/DOCUMENTO DE CONTEXTO/);assert.match(lastBody.instructions,/no una reunión/);assert.match(lastBody.instructions,/fecha de subida/);
  const findings=[],tasks=[];
  const first=input.passages.find(p=>p.text.includes("Objetivo: diseñar")),last=input.passages.find(p=>p.text.includes("Requisito: preparar"));
  const finding=(kind,title,evidenceId,date=null)=>({kind,title,description:"Propuesta respaldada por el documento ficticio",evidenceId,date,confidence:90,priority:3,urgency:3,estimatedMinutes:45,responsibleNames:[]});
  if(first){tasks.push(finding("task","Diseñar la portada de la web",first.id));findings.push(finding("question","Confirmar los objetivos de la portada",first.id));}
  if(last)tasks.push(finding("task","Preparar el informe de requisitos",last.id,"2026-10-20"));
  return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({summary:"Resumen del contexto ficticio",findings,tasks})}]}],usage:{input_tokens:100,output_tokens:50}});
}});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(async specifier=>{assert.equal(specifier,"drizzle-orm");const exports=await import(specifier);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});});await module.evaluate();const api=module.namespace;
function form(overrides={}){const data=new FormData();for(const [key,value] of Object.entries({requestId:id,projectId,title:"Brief del proyecto",date:""}))data.set(key,value);data.set("context",new File([text],"brief.md",{type:"text/markdown"}));for(const [key,value] of Object.entries(overrides))value===null?data.delete(key):data.set(key,value);return data;}
const post=(data,origin="https://app.fixture.test")=>api.upload.POST(new Request("https://app.fixture.test/api/project-contexts",{method:"POST",headers:{origin},body:data}));
const json=(route,body)=>route.POST(new Request("https://app.fixture.test/api/meetings/analyze",{method:"POST",headers:{origin:"https://app.fixture.test","content-type":"application/json"},body:JSON.stringify({id,...body})}));
const ageRuns=()=>sql.exec("UPDATE ai_runs SET created_at='2026-01-01T00:00:00.000Z'");

assert.equal((await post(form(),"https://evil.fixture.test")).status,403);
assert.equal((await post(form({projectId:"unknown"}))).status,404);
assert.equal((await post(form({context:null}))).status,400);
assert.equal((await post(form({date:"2026-02-30"}))).status,400);
assert.equal((await post(form({context:new File(["video"],"video.mp4")}))).status,422);
assert.equal((await post(form({context:new File(["captions"],"captions.srt")}))).status,422);
assert.equal((await post(form({context:new File(["x".repeat(256*1024+1)],"oversize.txt")}))).status,413);
assert.equal(uploads,0);
let response=await post(form());assert.equal(response.status,201);const item=(await response.json()).item;
assert.equal(item.itemType,"project_context");assert.equal(uploads,1);assert.equal(indexed,1);assert.equal(api.readMeeting(item),null);assert.equal(api.readProjectContext(item).date,"");
assert.equal((await post(form())).status,200);assert.equal(uploads,1);assert.equal((await post(form({title:"Changed"}))).status,409);
assert.equal(api.readProjectContext({...item,sourceReference:item.sourceReference.replace("-context.md","-notes.md")}),null);
const dated=await post(form({requestId:crypto.randomUUID(),date:"2026-10-10"}));assert.equal(dated.status,201);assert.equal(api.readProjectContext((await dated.json()).item).date,"2026-10-10");
response=await api.upload.GET(new Request(`https://app.fixture.test/api/project-contexts?id=${id}&role=context`));assert.equal(response.status,200);assert.equal(await response.text(),text);assert.match(response.headers.get("content-disposition"),/attachment/);
assert.equal((await api.meetings.GET(new Request(`https://app.fixture.test/api/meetings?id=${id}&role=transcript`))).status,404);
const extracted=await api.knowledgeText(userId,item);assert.ok(extracted.endsWith(text));assert.ok(extracted.includes("Sin fecha de referencia"));assert.ok(extracted.length>48*1024);
const file=api.readProjectContext(item).files[0],original=storage.get(file.key);storage.set(file.key,new Uint8Array([1,2,3]));await assert.rejects(()=>api.knowledgeText(userId,item),e=>e.status===409);storage.set(file.key,original);
await assert.rejects(()=>api.knowledgeText("foreign-owner",item),e=>e.status===422);

response=await json(api.analysis,{action:"propose",findingId:"0:0"});assert.equal(response.status,409);
let result;
do {
  ageRuns();const requestId=crypto.randomUUID();response=await json(api.analysis,{action:"analyze",requestId});assert.equal(response.status,200,(await response.clone().json()).error);result=await response.json();
  assert.equal(workspace.tasks.length,0);assert.equal(workspace.suggestions.length,0);
  const before=requests,replayed=await json(api.analysis,{action:"analyze",requestId});assert.equal(replayed.status,200);assert.equal((await replayed.json()).replayed,true);assert.equal(requests,before);
} while(result.analysis.status!=="ready");
assert.ok(result.analysis.completedParts>1);assert.equal(result.analysis.findings.filter(f=>f.kind==="task").length,2);assert.ok(result.analysis.findings.every(f=>extracted.includes(f.quote)));
const task=result.analysis.findings.find(f=>f.kind==="task"),question=result.analysis.findings.find(f=>f.kind==="question");
response=await json(api.analysis,{action:"propose",findingId:task.id});assert.equal(response.status,200);const proposalId=(await response.json()).proposalId;
let proposal=workspace.suggestions.find(s=>s.id===proposalId),payload=JSON.parse(proposal.payload);assert.equal(payload.contextId,id);assert.equal(payload.meetingId,undefined);assert.match(proposal.evidence,/Contexto del proyecto/);assert.equal(workspace.tasks.length,0);
const persisted=workspace.suggestions.length;response=await json(api.analysis,{action:"propose",findingId:task.id});assert.equal((await response.json()).replayed,true);assert.equal(workspace.suggestions.length,persisted);
assert.throws(()=>api.buildDailyCommand(workspace,userId,"edit_suggestion",{id:proposalId,projectId:"other-project"},crypto.randomUUID()));
apply(api.buildDailyCommand(workspace,userId,"edit_suggestion",{id:proposalId,estimatedMinutes:60},crypto.randomUUID()));
apply(api.buildDailyCommand(workspace,userId,"suggestion_status",{id:proposalId,status:"approved"},crypto.randomUUID()));assert.equal(workspace.tasks.length,1);assert.equal(workspace.tasks[0].estimatedMinutes,60);assert.equal(workspace.tasks[0].originMeetingId,null);assert.equal(workspace.tasks[0].sourceId,proposalId);assert.ok(workspace.tasks[0].aiGenerated);
assert.throws(()=>api.buildDailyCommand(workspace,userId,"suggestion_status",{id:proposalId,status:"approved"},crypto.randomUUID()));const relatedPlan=api.buildMeetingProposal(workspace,userId,id,task,crypto.randomUUID());
assert.ok(relatedPlan.changes.some(c=>c.table==="ai_suggestions"&&c.row.status==="pending"));
apply(relatedPlan);const relatedId=relatedPlan.id;
assert.throws(()=>api.buildDailyCommand(workspace,userId,"suggestion_status",{id:relatedId,status:"approved"},crypto.randomUUID()));

// Non-task findings retain their source through editing and history approval.
response=await json(api.analysis,{action:"propose",findingId:question.id});assert.equal(response.status,200);const questionId=(await response.json()).proposalId;
apply(api.buildDailyCommand(workspace,userId,"edit_suggestion",{id:questionId,title:"Confirmar objetivos y alcance"},crypto.randomUUID()));assert.equal(JSON.parse(workspace.suggestions.find(s=>s.id===questionId).payload).action,"record_context_finding");
apply(api.buildDailyCommand(workspace,userId,"suggestion_status",{id:questionId,status:"approved"},crypto.randomUUID()));assert.equal(workspace.tasks.length,1);assert.equal(workspace.events.at(-1).sourceType,"project_context");assert.equal(workspace.events.at(-1).eventType,"context_question");assert.equal(workspace.events.at(-1).sourceId,id);

// Corrections on a still-unsent finding use document semantics and preserve evidence.
ageRuns();const otherTask=result.analysis.findings.find(f=>f.kind==="task"&&f.id!==task.id),revisionId=crypto.randomUUID();
response=await json(api.revise,{action:"revise",findingId:otherTask.id,requestId:revisionId,instruction:"Revisar objetivos de la portada"});assert.equal(response.status,200,(await response.clone().json()).error);const draft=(await response.json()).draft;
assert.equal(draft.finding.quote,otherTask.quote);assert.match(lastBody.instructions,/documento de contexto/);assert.equal(JSON.parse(lastBody.input[0].content).metadata.resourceKind,"project_context");
response=await json(api.revise,{action:"propose",findingId:otherTask.id,revisionId});assert.equal(response.status,200);proposal=workspace.suggestions.find(s=>JSON.parse(s.payload).revision?.id===revisionId);assert.equal(JSON.parse(proposal.payload).contextId,id);assert.equal(workspace.events.at(-1).sourceType,"project_context");assert.equal(workspace.tasks.length,1);
const ai=api.aiContext(workspace,projectId);assert.ok(!ai.text.includes(file.key));assert.ok(!ai.text.includes(file.hash));
assert.ok(api.searchRecords(workspace,"brief").some(match=>match.knowledgeId===id));
denied=401;assert.equal((await api.upload.GET(new Request(`https://app.fixture.test/api/project-contexts?id=${id}&role=context`))).status,401);denied=0;
fixtureEnv.PROJECT_OS_AI_CONTEXT_ENABLED="false";const calls=requests;
const disabledId=crypto.randomUUID();assert.equal((await post(form({requestId:disabledId}))).status,201);
assert.equal((await json(api.analysis,{id:disabledId,action:"analyze",requestId:crypto.randomUUID()})).status,503);assert.equal(requests,calls);assert.equal(workspace.tasks.length,1);
sql.close();console.log(JSON.stringify({passed:true,completeOriginalAndMultipleParts:true,contextDistinctFromMeeting:true,optionalDocumentDate:true,hashAndOwnerChecks:true,retriesWithoutDuplicates:true,taskOnlyAfterApproval:true,historyAndCorrectionsKeepContextSource:true,privateStorageExcludedFromPrompts:true,liveApiCalls:0}));
