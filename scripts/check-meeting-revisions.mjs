import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {build} from "esbuild";
import {DatabaseSync} from "node:sqlite";

// Real route/provider/SQL/approval plans; only synthetic records and upstream.
const sql=new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../drizzle/0001_empty_blade.sql",import.meta.url),"utf8"));
const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {async first(){return statement.get(...args);},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:statement.run(...args).changes}};}};}};}};
const userId="owner-fixture",projectId="project-a",meetingId="meeting-a",fingerprint="a".repeat(64),text="Ana: Prepararemos un primer avance funcional de la web para que Diego revise el diseño.";
const original={id:"0:0",part:0,kind:"deadline",title:"Primer avance funcional de la web",description:"Diego revisará el primer avance.",quote:"Prepararemos un primer avance funcional de la web para que Diego revise el diseño.",date:null,confidence:90,priority:3,urgency:3,estimatedMinutes:30};
const fields={kind:"task",title:"Entregar primer avance para revisión",description:"Preparar una demostración funcional para la revisión de Diego.",date:"2026-10-20",priority:4,urgency:4,estimatedMinutes:90};
const workspace={projects:[{id:projectId,userId,name:"Prueba sintética"},{id:"project-b",userId,name:"B"}],knowledge:[],suggestions:[],tasks:[],milestones:[],dependencies:[],events:[],financials:[],calendar:[],inbox:[],repositories:[]};
const fixtureEnv={DB,OPENAI_API_KEY:"synthetic-credential",PROJECT_OS_AI_CONTEXT_ENABLED:"true"};
let apiCalls=0,providerBody,providerStatus=200,providerResult={status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(fields)}]}]},denied=0,changedText=false,persisted=0,live=false;
const adapters={
  async currentWorkspaceId(request){if(denied)throw Object.assign(Error("Owner required"),{status:denied});if(request&&request.headers.get("origin")!=="https://app.fixture.test")throw Object.assign(Error("Origin rejected"),{status:403});return userId;},
  async getWorkspaceState(){return structuredClone(workspace);},
  async knowledgeText(owner,item){assert.equal(owner,item.userId);return changedText?text+" Changed":text;},
  async persistCorePlan(owner,plan){assert.equal(owner,userId);persisted++;apply(plan);return {state:structuredClone(workspace),id:plan.id};},
};
function apply(plan){for(const change of plan.changes){const key={ai_suggestions:"suggestions",project_events:"events",tasks:"tasks"}[change.table];assert.ok(key);const row=Object.fromEntries(Object.entries(change.row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));workspace[key]=workspace[key].filter(item=>item.id!==row.id);workspace[key].push(row);}}
const stubs={
  "cloudflare:workers":"export const env=globalThis.fixtureEnv;",
  "@/db/workspace":"export const getWorkspaceState=globalThis.adapters.getWorkspaceState;",
  "@/db/core-mutations":"export const persistCorePlan=globalThis.adapters.persistCorePlan;",
  "@/lib/workspace-context":"export class WorkspaceConfigurationError extends Error{constructor(message,status=503){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return await globalThis.adapters.currentWorkspaceId(request)}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}",
};
const compiled=await build({stdin:{contents:'export * from "../app/api/meetings/revise/route";export * from "../lib/meeting-revision";export * from "../lib/meeting-revision-proposals";export * from "../lib/meeting-revision-provider";export * from "../lib/meeting-analysis";export * from "../lib/meeting-proposals";export * from "../lib/daily-commands";export * from "../lib/meetings";export * from "../db/meeting-analysis";export * from "../db/meeting-revisions";export * from "../db/ai-history";export * from "../lib/brain-content";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"fixtures",setup(builder){builder.onResolve({filter:/brain-provider$/},()=>({path:"brain",namespace:"fixture"}));builder.onResolve({filter:/^(?:cloudflare:workers|@\/)/},args=>args.path in stubs?{path:args.path,namespace:"fixture"}:undefined);builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="brain"?"export const knowledgeText=globalThis.adapters.knowledgeText;":stubs[args.path],loader:"js"}));}}]});
const context=vm.createContext({fixtureEnv,adapters,crypto,TextEncoder,TextDecoder,Uint8Array,URL,Request,Response,AbortSignal,console,async fetch(url,options){assert.equal(url,"https://api.openai.com/v1/responses");apiCalls++;providerBody=JSON.parse(options.body);if(live)return fetch(url,options);return Response.json(providerResult,{status:providerStatus});}});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();const api=module.namespace;
const hash=await api.contentHash(text);
workspace.knowledge.push({id:meetingId,userId,projectId,itemType:"meeting",title:"Reunión ficticia",sourceReference:api.MEETING_PREFIX+JSON.stringify({version:1,date:"2026-10-08",driveUrl:"",fingerprint,files:[{role:"transcript",name:"transcripcion.txt",key:`${userId}/${projectId}/${meetingId}-${fingerprint}-transcript.txt`,hash,size:200,type:"text/plain"}]})});
const part={version:1,meetingId,fingerprint,contentHash:hash,part:0,totalParts:1,summary:"Resumen ficticio",findings:[original]},partId=crypto.randomUUID(),prefix=api.meetingQueryPrefix(meetingId,fingerprint);
await api.reserveMeetingPart(userId,partId,projectId,prefix+"0");await api.finishAiRun(userId,partId,part);
const request=(values={})=>new Request("https://app.fixture.test/api/meetings/revise",{method:"POST",headers:{origin:"https://app.fixture.test","content-type":"application/json"},body:JSON.stringify({id:meetingId,findingId:original.id,action:"revise",instruction:"Conviértelo en una tarea, entrega el 20 de octubre de 2026, prioridad y urgencia 4, duración 90 minutos.",requestId:crypto.randomUUID(),...values})});
const corrected=api.validateMeetingRevision(fields,original);assert.equal(corrected.quote,original.quote);assert.equal(corrected.confidence,90);assert.equal(corrected.id,original.id);
for(const bad of [{quote:"Reescribir evidencia"},{date:"2026-02-30"},{estimatedMinutes:900},{priority:0},{kind:"toString"}])assert.throws(()=>api.validateMeetingRevision({...fields,...bad},original));
const id=crypto.randomUUID();let response=await api.POST(request({requestId:id}));assert.equal(response.status,200);let result=await response.json(),draft=result.draft;
assert.equal(draft.finding.quote,original.quote);assert.equal(draft.baseFindingId,original.id);assert.equal(workspace.tasks.length,0);assert.equal(workspace.suggestions.length,0);assert.equal(persisted,0);
assert.equal(providerBody.store,false);assert.equal(providerBody.text.format.strict,true);assert.equal(providerBody.text.format.schema.properties.quote,undefined);assert.equal(JSON.parse(providerBody.input[0].content).instruction,draft.instruction);
const calls=apiCalls;response=await api.POST(request({requestId:id}));assert.equal(response.status,200);assert.ok((await response.json()).replayed);assert.equal(apiCalls,calls);
response=await api.POST(request({requestId:id,instruction:"Otra petición"}));assert.equal(response.status,409);
response=await api.GET(new Request(`https://app.fixture.test/api/meetings/revise?id=${meetingId}`));assert.equal(response.status,200);assert.equal((await response.json()).drafts[0].id,id);
assert.equal((await api.meetingRevisions("other-owner",projectId,meetingId,fingerprint)).length,0);assert.equal((await api.meetingRevisions(userId,"project-b",meetingId,fingerprint)).length,0);
changedText=true;response=await api.POST(request({action:"propose",revisionId:id}));assert.equal(response.status,409);assert.equal(persisted,0);changedText=false;
response=await api.POST(request({action:"propose",revisionId:id}));assert.equal(response.status,200);assert.equal(workspace.suggestions.length,1);assert.equal(workspace.tasks.length,0);
const proposalId=await api.meetingProposalId(meetingId,fingerprint,original),proposal=structuredClone(workspace.suggestions[0]);assert.equal(proposal.id,proposalId);assert.equal(proposal.suggestionType,"new_task");assert.equal(JSON.parse(proposal.payload).revision.id,id);assert.ok(proposal.evidence.includes(draft.instruction));
const writes=persisted;response=await api.POST(request({action:"propose",revisionId:id}));assert.equal(response.status,200);assert.ok((await response.json()).replayed);assert.equal(persisted,writes);
// Pending replacement keeps the original ID and protects the complete snapshot.
sql.exec("UPDATE ai_runs SET created_at='2026-01-01T00:00:00.000Z'");
const nextId=crypto.randomUUID();response=await api.POST(request({requestId:nextId,previousRevisionId:id}));assert.equal(response.status,200);draft=(await response.json()).draft;
const plan=await api.buildRevisionProposal(workspace,userId,original,draft),change=plan.changes.find(c=>c.table==="ai_suggestions");assert.equal(change.kind,"update");assert.equal(change.row.id,proposalId);assert.equal(change.expected.status,"pending");assert.equal(change.expected.payload,proposal.payload);assert.equal(change.row.created_at,proposal.createdAt);assert.ok(!plan.changes.some(c=>c.table==="tasks"));
await assert.rejects(()=>api.buildRevisionProposal(workspace,userId,original,{...draft,baseFindingHash:"wrong"}));
await assert.rejects(()=>api.buildRevisionProposal(workspace,userId,original,{...draft,finding:{...draft.finding,quote:"Inventada"}}));
const nonTask=await api.buildRevisionProposal(workspace,userId,original,{...draft,finding:{...draft.finding,kind:"deadline"}});assert.equal(nonTask.changes.find(c=>c.table==="ai_suggestions").row.suggestion_type,"meeting_deadline");assert.ok(!nonTask.changes.some(c=>c.table==="tasks"));
workspace.suggestions[0].title="Edición manual concurrente";response=await api.POST(request({action:"propose",revisionId:nextId}));assert.equal(response.status,409);workspace.suggestions[0].title=proposal.title;
response=await api.POST(request({action:"propose",revisionId:nextId}));assert.equal(response.status,200);assert.equal(workspace.suggestions.length,1);assert.equal(workspace.tasks.length,0);
const savedParts=await api.meetingParts(userId,projectId,prefix);assert.equal(JSON.stringify(savedParts[0]),JSON.stringify(part));
// Approving creates exactly one task; re-prompting cannot reopen approval.
const approval=api.buildDailyCommand(workspace,userId,"suggestion_status",{id:proposalId,status:"approved"},crypto.randomUUID());assert.equal(approval.changes.filter(c=>c.table==="tasks").length,1);apply(approval);assert.equal(workspace.tasks.length,1);assert.equal(workspace.tasks[0].deadline,"2026-10-20");
response=await api.POST(request());assert.equal(response.status,409);response=await api.POST(request({action:"propose",revisionId:id}));assert.equal(response.status,409);assert.equal(workspace.tasks.length,1);
workspace.suggestions[0].status="rejected";response=await api.POST(request());assert.equal(response.status,409);
// Failed provider consumes its reserved shared quota but saves no draft/action.
workspace.suggestions=[];sql.exec("UPDATE ai_runs SET created_at='2026-01-01T00:00:00.000Z'");providerStatus=429;
const failedId=crypto.randomUUID();response=await api.POST(request({requestId:failedId}));assert.equal(response.status,429);assert.equal((await api.findAiRun(userId,failedId)).status,"failed");providerStatus=200;
const before=apiCalls;response=await api.POST(request({instruction:"PASSWORD=synthetic-sensitive-value"}));assert.equal(response.status,422);assert.equal(apiCalls,before);
changedText=true;response=await api.POST(request());assert.equal(response.status,409);changedText=false;
denied=401;response=await api.POST(request());assert.equal(response.status,401);denied=0;
response=await api.POST(new Request("https://app.fixture.test/api/meetings/revise",{method:"POST",headers:{origin:"https://evil.fixture.test"},body:"{}"}));assert.equal(response.status,403);
response=await api.POST(request({findingId:"foreign"}));assert.equal(response.status,404);
providerResult={status:"incomplete"};await assert.rejects(()=>api.requestMeetingRevision(original,original,"Acorta el título",{title:"Prueba",date:"2026-10-08",project:"Ficticio"}));
providerResult={status:"completed",output:[{content:[{type:"refusal"}]}]};await assert.rejects(()=>api.requestMeetingRevision(original,original,"Acorta el título",{title:"Prueba",date:"2026-10-08",project:"Ficticio"}));
fixtureEnv.PROJECT_OS_AI_DAILY_LIMIT="1";response=await api.POST(request());assert.equal(response.status,429);
sql.close();console.log(JSON.stringify({passed:true,immutableEvidence:true,savedDraftsAndIdempotence:true,stableProposalId:true,pendingSnapshotGuard:true,resolvedProposalsProtected:true,noTaskUntilApproval:true,ownerAndCsrf:true,sharedQuota:true,liveApiCalls:0}));
if(process.argv.includes("--live-provider")) {
  assert.ok(process.env.OPENAI_API_KEY,"An existing key is required.");fixtureEnv.OPENAI_API_KEY=process.env.OPENAI_API_KEY;fixtureEnv.OPENAI_MODEL=process.env.OPENAI_MODEL;live=true;
  const output=await api.requestMeetingRevision(original,original,"Conviértelo en una tarea para entregar el primer avance funcional el 20 de octubre de 2026. Prioridad y urgencia 4, estimación 90 minutos.",{title:"Reunión ficticia",date:"2026-10-08",project:"Prueba sintética"});
  assert.equal(output.finding.kind,"task");assert.equal(output.finding.date,"2026-10-20");assert.equal(output.finding.quote,original.quote);
  console.log(JSON.stringify({liveProviderPassed:true,liveApiCalls:1,noProjectDataSent:true,exactEvidencePreserved:true}));
}
