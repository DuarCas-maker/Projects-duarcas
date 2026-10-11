import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {build} from "esbuild";
import {DatabaseSync} from "node:sqlite";

// Real route, provider, context, quota and validation; synthetic data only.
// Never reads env files, user originals, Drive, GBrain or the live OpenAI API.
const sql=new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../drizzle/0001_empty_blade.sql",import.meta.url),"utf8"));
const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {async first(){return statement.get(...args);},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:statement.run(...args).changes}};}};}};}};
const workspace={projects:[{id:"project-a",userId:"owner-fixture",name:"A"},{id:"project-b",userId:"owner-fixture",name:"B"}],knowledge:[],repositories:[]};
const originals=new Map(),fixtureEnv={DB,OPENAI_API_KEY:"synthetic-credential",PROJECT_OS_AI_CONTEXT_ENABLED:"true"};
let memory={status:"connected",hits:[]},originalReads=0,recalls=0,apiCalls=0,providerBody,providerResult,providerStatus=200,denied=0;
const adapters={
  async currentWorkspaceId(request){if(denied) throw Object.assign(Error("Owner required"),{status:denied});if(request?.headers.get("origin")!=="https://app.fixture.test")throw Object.assign(Error("Origin rejected"),{status:403});return "owner-fixture";},
  async getWorkspaceState(){return structuredClone(workspace);},
  async knowledgeText(userId,item){originalReads++;assert.equal(userId,item.userId);if(!originals.has(item.id))throw Error("Unavailable original");return originals.get(item.id);},
  async recallMemory(_userId,ids){recalls++;assert.deepEqual([...ids],["project-a"]);return memory;},
};
const stubs={
  "cloudflare:workers":"export const env=globalThis.fixtureEnv;",
  "@/db/workspace":"export const getWorkspaceState=globalThis.adapters.getWorkspaceState;",
  "@/lib/workspace-context":"export class WorkspaceConfigurationError extends Error{constructor(message,status=503){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return await globalThis.adapters.currentWorkspaceId(request)}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}",
};
const compiled=await build({stdin:{contents:'export * from "../lib/memory-answer";export * from "../lib/memory-answer-context";export * from "../lib/memory-answer-provider";export * from "../app/api/brain/answer/route";export * from "../lib/meetings";export * from "../db/ai-history";export * from "../db/meeting-analysis";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"synthetic-adapters",setup(builder){builder.onResolve({filter:/brain-provider$/},()=>({path:"brain",namespace:"fixture"}));builder.onResolve({filter:/^(?:cloudflare:workers|@\/)/},args=>args.path in stubs?{path:args.path,namespace:"fixture"}:undefined);builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="brain"?"export const {knowledgeText,recallMemory}=globalThis.adapters;":stubs[args.path],loader:"js"}));}}]});
const context=vm.createContext({fixtureEnv,adapters,crypto,TextEncoder,TextDecoder,Uint8Array,URL,Request,Response,AbortSignal,console,async fetch(url,options){assert.equal(url,"https://api.openai.com/v1/responses");apiCalls++;providerBody=JSON.parse(options.body);return Response.json(providerResult,{status:providerStatus});}});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();const api=module.namespace;
const userId="owner-fixture",projectId="project-a",fingerprint="a".repeat(64),hash="b".repeat(64);
function meeting(id,date,title,project=projectId,owner=userId,notes=true) {
  const files=[{role:"transcript",name:"transcripcion-2099.md",key:`${owner}/${project}/${id}-${fingerprint}-transcript.md`,hash,size:400,type:"text/markdown"},...(notes?[{role:"notes",name:"notas.md",key:`${owner}/${project}/${id}-${fingerprint}-notes.md`,hash,size:200,type:"text/markdown"}]:[])];
  const item={id,userId:owner,projectId:project,itemType:"meeting",title,summary:"Metadatos",storageKey:null,processingStatus:"uploaded",occurredAt:"2099-01-01T12:00:00Z",sourceReference:api.MEETING_PREFIX+JSON.stringify({version:1,date,driveUrl:"https://drive.google.com/file/d/fixture/view",fingerprint,files})};workspace.knowledge.push(item);
  originals.set(id,`Reunión: ${title}\nFecha: ${date}\n\nTRANSCRIPCIÓN COMPLETA · transcripcion-2099.md\n\nSaludo inicial.\nDaniel: Acordamos entregar el manual de marca el jueves.\n\nNOTAS DE LA REUNIÓN · notas.md\n\n**Manual de marca**: Acordamos entregar el manual de marca el jueves.\n**Pendiente**: Diego enviará los colores para preparar el manual.\n*Revisa las notas de Gemini para asegurarte de que sean precisas. [Obtén sugerencias](https://support.google.com/meet/answer/14754931)*\n*Cómo es la calidad de estas notas específicas? [Encuesta](https://google.qualtrics.com/jfe/fixture)*`);
  return item;
}
const older=meeting("old","2026-09-17","Fichero 2099 - relevante"),latest=meeting("latest","2026-09-28","Título 04/09/26 - reunión más reciente");
meeting("other","2099-12-31","Otro proyecto","project-b");meeting("foreign","2099-12-31","Otro dueño",projectId,"foreign-owner");meeting("invalid","2026-02-31","Fecha imposible");
assert.equal(api.orderedProjectMeetings(workspace,userId,projectId)[0].item.id,"latest");
for(const question of ["Que fue lo ultimo que se hablo en el proyecto?","¿Qué se acordó en la última reunión?","La más reciente","ULTIMO ACUERDO"])assert.ok(api.asksForLatest(question));
assert.equal(api.asksForLatest("¿Qué colores tiene el manual de marca?"),false);
assert.equal(api.asksForLatest("¿Qué se habló sobre el manual de marca?"),false);
const cleaned=api.readableMemoryText(originals.get("latest"));assert.ok(!cleaned.includes("Gemini") && !cleaned.includes("qualtrics") && !cleaned.includes("**"));assert.ok(cleaned.includes("Manual de marca"));
let input=await api.memoryAnswerContext(userId,workspace,projectId,"¿Qué fue lo último que se habló?","auto",crypto.randomUUID());
assert.equal(input.policy,"latest_meeting");assert.equal(input.latestDate,"2026-09-28");assert.equal(recalls,0);assert.ok(input.sources.every(s=>s.knowledgeId==="latest"));assert.ok(input.sources.every(s=>s.date==="2026-09-28"));assert.ok(!JSON.stringify(input).includes(`${userId}/${projectId}`));
const noMeeting=await api.memoryAnswerContext(userId,{...workspace,knowledge:[]},projectId,"último","auto",crypto.randomUUID());assert.equal(noMeeting.sources.length,0);assert.ok(noMeeting.message);assert.equal(recalls,0);
const preserved=originals.get("latest");originals.delete("latest");const unavailable=await api.memoryAnswerContext(userId,workspace,projectId,"último","auto",crypto.randomUUID());assert.equal(unavailable.sources.length,0);assert.ok(unavailable.warnings.some(w=>w.includes("no están disponibles")));assert.ok(!JSON.stringify(unavailable).includes("Fichero 2099"));originals.set("latest",preserved);
const tied=meeting("latest-tie","2026-09-28","Reunión del mismo día");input=await api.memoryAnswerContext(userId,workspace,projectId,"último","auto",crypto.randomUUID());assert.equal(new Set(input.sources.map(s=>s.knowledgeId)).size,2);assert.ok(input.warnings.some(w=>w.includes("no se conoce su orden")));workspace.knowledge=workspace.knowledge.filter(k=>k.id!==tied.id);
// Cached complete analysis, including valid quotes, avoids rereading originals.
const prefix=api.meetingQueryPrefix(latest.id,fingerprint),part={version:1,meetingId:latest.id,fingerprint,contentHash:hash,part:0,totalParts:1,summary:"Acordamos entregar el manual de marca el jueves.",findings:[]};
const partId=crypto.randomUUID();await api.reserveMeetingPart(userId,partId,projectId,prefix+"0");await api.finishAiRun(userId,partId,part);
const reads=originalReads;input=await api.memoryAnswerContext(userId,workspace,projectId,"último","auto",crypto.randomUUID());assert.equal(originalReads,reads);assert.equal(input.sources[0].kind,"analysis");assert.equal(recalls,0);
sql.exec("DELETE FROM ai_runs");
originals.set("latest",preserved.replace("Saludo inicial.","Relleno de transcripción. ".repeat(13000)));input=await api.memoryAnswerContext(userId,workspace,projectId,"último","auto",crypto.randomUUID());assert.ok(input.sources.some(s=>s.partial));assert.ok(input.sources.reduce((n,s)=>n+s.text.length,0)<=api.MAX_ANSWER_CONTEXT_CHARS);assert.ok(input.warnings.some(w=>w.includes("Cobertura parcial")));assert.ok(input.sources[0].text.includes("Acordamos entregar"));originals.set("latest",preserved);
memory={status:"connected",hits:[{id:"brain:old",knowledgeId:"old",projectId,title:older.title,text:"Acordamos entregar el manual de marca el jueves.",score:100},{id:"brain:latest",knowledgeId:"latest",projectId,title:latest.title,text:"Acordamos entregar el manual de marca el jueves.",score:1},{id:"brain:other",knowledgeId:"other",projectId:"project-b",text:"OTRO PROYECTO"},{id:"brain:foreign",knowledgeId:"foreign",projectId,text:"OTRO DUEÑO"},{id:"brain:missing",knowledgeId:"deleted",projectId,text:"BORRADO"}]};
input=await api.memoryAnswerContext(userId,workspace,projectId,"manual de marca","auto",crypto.randomUUID());assert.equal(input.policy,"relevance");assert.equal(input.sources.length,2);assert.equal(input.sources[0].knowledgeId,"latest");assert.equal(input.sources[0].date,"2026-09-28");assert.ok(!JSON.stringify(input).includes("OTRO") && !JSON.stringify(input).includes("BORRADO"));
const result={answer:{text:"Se acordó entregar el manual de marca el jueves.",citations:[{sourceId:input.sources[0].id,quote:"Acordamos entregar el manual de marca el jueves."}]},points:[{kind:"agreement",text:"Entregar el manual de marca.",citations:[{sourceId:input.sources[0].id,quote:"Acordamos entregar el manual de marca el jueves."}]}]};
api.validateMemoryAnswer(result,input.sources);
for(const bad of [{answer:{...result.answer,citations:[{sourceId:"unknown",quote:"Acordamos entregar el manual de marca el jueves."}]}},{answer:{...result.answer,citations:[{sourceId:input.sources[0].id,quote:"La entrega se completó sin problemas."}]}},{points:[{...result.points[0],kind:"fake"}]},{answer:{text:"Sin evidencia",citations:[]}}])assert.throws(()=>api.validateMemoryAnswer({...result,...bad},input.sources));
providerResult={status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(result)}]}],usage:{input_tokens:100,output_tokens:80}};
await api.requestMemoryAnswer("manual de marca",input);assert.equal(providerBody.store,false);assert.equal(providerBody.text.format.strict,true);assert.equal(providerBody.model,"gpt-4.1-mini");assert.ok(providerBody.instructions.includes("Fecha de la reunión") && providerBody.instructions.includes("NO son cambios aprobados"));
providerResult={status:"incomplete"};await assert.rejects(()=>api.requestMemoryAnswer("manual",input));providerResult={status:"completed",output:[{content:[{type:"refusal"}]}]};await assert.rejects(()=>api.requestMemoryAnswer("manual",input));providerStatus=429;await assert.rejects(()=>api.requestMemoryAnswer("manual",input));providerStatus=200;
const beforeSensitive=apiCalls;await assert.rejects(()=>api.requestMemoryAnswer("PASSWORD=synthetic-sensitive-string",input));assert.equal(apiCalls,beforeSensitive);
function request(body,origin="https://app.fixture.test"){return new Request("https://app.fixture.test/api/brain/answer",{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify({projectId,query:"manual de marca",mode:"auto",requestId:crypto.randomUUID(),...body})});}
providerResult={status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(result)}]}]};
const unchanged=JSON.stringify(workspace),runId=crypto.randomUUID(),calls=apiCalls;let response=await api.POST(request({requestId:runId}));assert.equal(response.status,200);assert.equal(apiCalls,calls+1);assert.equal(JSON.stringify(workspace),unchanged);
const recallsBeforeReplay=recalls;response=await api.POST(request({requestId:runId}));assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);assert.equal(apiCalls,calls+1);assert.equal(recalls,recallsBeforeReplay);
assert.equal((await api.POST(request({requestId:runId,query:"otra pregunta"}))).status,409);
assert.equal((await api.POST(request({projectId:"project-unknown"}))).status,404);
assert.equal((await api.POST(request({mode:"bad"}))).status,400);
assert.equal((await api.POST(request({requestId:"bad"}))).status,400);
assert.equal((await api.POST(request({query:"x".repeat(1001)}))).status,400);
assert.equal((await api.POST(request({},"https://evil.fixture.test"))).status,403);denied=401;assert.equal((await api.POST(request({}))).status,401);denied=0;
const disabledCalls=apiCalls;fixtureEnv.PROJECT_OS_AI_CONTEXT_ENABLED="false";assert.equal((await api.POST(request({}))).status,503);assert.equal(apiCalls,disabledCalls);fixtureEnv.PROJECT_OS_AI_CONTEXT_ENABLED="true";
await api.reserveAiRun(userId,crypto.randomUUID(),projectId,"chat","another");await api.reserveAiRun(userId,crypto.randomUUID(),projectId,"chat","third");assert.equal((await api.POST(request({}))).status,429);
sql.exec("DELETE FROM ai_runs");fixtureEnv.PROJECT_OS_AI_DAILY_LIMIT="1";await api.reserveAiRun(userId,crypto.randomUUID(),projectId,"chat","first");assert.equal((await api.POST(request({}))).status,429);fixtureEnv.PROJECT_OS_AI_DAILY_LIMIT="40";
sql.exec("DELETE FROM ai_runs");const failId=crypto.randomUUID();providerResult={status:"incomplete"};assert.equal((await api.POST(request({requestId:failId}))).status,502);assert.equal((await api.findAiRun(userId,failId)).status,"failed");assert.equal((await api.POST(request({requestId:failId}))).status,409);
const noCalls=apiCalls;memory={status:"connected",hits:[]};response=await api.POST(request({}));assert.equal(response.status,200);assert.equal((await response.json()).result,null);assert.equal(apiCalls,noCalls);
sql.close();console.log("Memory answers passed: authoritative meeting dates over filenames/scores, equal-date coverage, latest original/analysis lookup without GBrain, no older fallback, boilerplate cleanup, partial coverage, scoped retrieval, verified citations, strict Responses, shared quotas, idempotent replay, owner/CSRF, errors and no automatic tasks. Live API calls: 0.");
