import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {build} from "esbuild";
import {DatabaseSync} from "node:sqlite";

// In-memory SQL and synthetic provider only: no credentials or live API calls.
const sql=new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../drizzle/0001_empty_blade.sql",import.meta.url),"utf8"));
const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {async first(){return statement.get(...args);},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:statement.run(...args).changes}};}};}};}};
let requests=0,providerBody,providerStatus=200,providerResult;
const context=vm.createContext({crypto,Intl,Date,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Response,console,fixtureEnv:{DB,OPENAI_API_KEY:"synthetic-test-credential",PROJECT_OS_AI_CONTEXT_ENABLED:"true"},async fetch(_url,options){requests++;providerBody=JSON.parse(options.body);return Response.json(providerResult,{status:providerStatus});}});
const compiled=await build({stdin:{contents:'export * from "../lib/meeting-analysis"; export * from "../lib/meeting-evidence"; export * from "../lib/meeting-proposals"; export * from "../lib/daily-commands"; export * from "../lib/core-commands"; export * from "../lib/workspace-types"; export * from "../lib/meetings"; export * from "../db/meeting-analysis"; export * from "../db/ai-history"; export * from "../lib/meeting-ai-provider";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"test-env",setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:"env",namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const env=globalThis.fixtureEnv;",loader:"js"}));}}]});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();
const {meetingPassages,citablePassages,resolveMeetingEvidence,validateMeetingPart,combineMeetingParts,meetingProposalId,buildMeetingProposal,buildCoreCommand,buildDailyCommand,emptyWorkspace,deriveWorkspaceState,MEETING_PREFIX,meetingQueryPrefix,reserveMeetingPart,finishAiRun,meetingParts,requestMeetingAnalysis,bogotaDay}=module.namespace;
const text="Ana: Decidimos usar material zafiro. Luis: Preparar el informe de muestra el 15 de octubre de 2026.";
const finding={kind:"decision",title:"Usar material zafiro",description:"Acuerdo ficticio para la demostración",quote:"Decidimos usar material zafiro.",date:null,confidence:90,priority:3,urgency:3,estimatedMinutes:30};
const valid=validateMeetingPart({summary:"Resumen ficticio",findings:[finding]},text,0);
const formatted="## Notas de Gemini\r\n\r\n**Ana (00:02:10):** Decidimos usar material **zafiro**.\r\nLuis: La reunión usa comillas “curvas” y espacios\u00a0especiales.\n".repeat(200)+"🧠".repeat(410)+"\nFin de la reunión ficticia.";
const passages=meetingPassages(formatted);assert.equal(passages.map(passage=>passage.text).join(""),formatted);assert.ok(passages.every(passage=>passage.text.length<=400));assert.ok(passages.every(passage=>!/[\uD800-\uDBFF]$/.test(passage.text)));assert.ok(citablePassages(passages).length<1000);
const selected=passages[3],resolved=resolveMeetingEvidence({summary:"Resumen",findings:[{...finding,evidenceId:selected.id,quote:"Cita inventada que no debe almacenarse"}]},passages);assert.equal(resolved.findings[0].quote,selected.text.trim());assert.ok(formatted.includes(resolved.findings[0].quote));validateMeetingPart(resolved,formatted,0);
assert.throws(()=>resolveMeetingEvidence({summary:"Resumen",findings:[{...finding,evidenceId:"e9999"}]},passages));assert.throws(()=>resolveMeetingEvidence({summary:"Resumen",findings:[finding]},passages));
for(const bad of [{quote:"Cita inventada de reunión"},{kind:"toString"},{date:"2026-02-30"},{confidence:101},{priority:0},{estimatedMinutes:900}])assert.throws(()=>validateMeetingPart({summary:"Resumen",findings:[{...finding,...bad}]},text,0));
assert.throws(()=>validateMeetingPart({summary:"Resumen",findings:Array(4).fill({...finding,kind:"task"})},text,0));
const fingerprint="a".repeat(64),hash="b".repeat(64),meetingId=crypto.randomUUID();
const part={version:1,meetingId,fingerprint,contentHash:hash,part:0,totalParts:2,...valid};
const second={...part,part:1,summary:"Último fragmento",findings:[{...valid.findings[0],id:"1:0",part:1}]};
assert.equal(combineMeetingParts([part]).status,"partial");assert.equal(combineMeetingParts([part]).findings.length,0);
assert.equal(combineMeetingParts([second,part]).status,"ready");assert.equal(combineMeetingParts([part,second]).findings.length,1);
assert.equal(combineMeetingParts([second]).completedParts,0);assert.throws(()=>combineMeetingParts([part,{...second,contentHash:"different"}]));
assert.equal(await meetingProposalId(meetingId,fingerprint,valid.findings[0]),await meetingProposalId(meetingId,fingerprint,{...valid.findings[0],title:"USAR material záfiro!"}));

let state=emptyWorkspace();const userId="meeting-fixture-user";
const tables={projects:"projects",tasks:"tasks",milestones:"milestones",task_dependencies:"dependencies",project_financials:"financials",project_events:"events",ai_suggestions:"suggestions",inbox_items:"inbox",calendar_blocks:"calendar"};
function apply(plan){for(const change of plan.changes){const key=tables[change.table],row=Object.fromEntries(Object.entries(change.row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));state[key]=state[key].filter(item=>item.id!==row.id);if(change.kind!=="delete")state[key].push(row);}state=deriveWorkspaceState(state);return plan.id;}
const act=(action,payload)=>apply(buildDailyCommand(state,userId,action,payload,crypto.randomUUID()));
const projectId=apply(buildCoreCommand(state,userId,"create_project",{name:"Reunión ficticia",operationalStatus:"Activo"},crypto.randomUUID()));
const otherProject=apply(buildCoreCommand(state,userId,"create_project",{name:"Otro proyecto",operationalStatus:"Activo"},crypto.randomUUID()));
state.knowledge.push({id:meetingId,userId,projectId,itemType:"meeting",title:"Reunión ficticia",sourceReference:MEETING_PREFIX+JSON.stringify({version:1,date:"2026-10-08",driveUrl:"",fingerprint,files:[{role:"transcript",name:"transcripcion.txt",key:`${userId}/${projectId}/${meetingId}-${fingerprint}-transcript.txt`,hash,size:200,type:"text/plain"}]})});
const projectBefore=JSON.stringify(state.projects),financialsBefore=JSON.stringify(state.financials);
for(const kind of ["decision","commitment","deadline","blocker","question"]){const id=crypto.randomUUID(),proposal=buildMeetingProposal(state,userId,meetingId,{...valid.findings[0],kind},id);assert.ok(!proposal.changes.some(change=>change.table==="tasks"));apply(proposal);act("edit_suggestion",{id,title:`Hallazgo confirmado ${kind}`,deadline:"2026-10-15"});assert.equal(JSON.parse(state.suggestions.find(row=>row.id===id).payload).meetingId,meetingId);const approved=buildDailyCommand(state,userId,"suggestion_status",{id,status:"approved"},crypto.randomUUID());assert.deepEqual([...new Set(approved.changes.map(change=>change.table))].sort(),["ai_suggestions","project_events"]);apply(approved);assert.equal(state.tasks.length,0);assert.equal(state.events.at(-1).sourceId,meetingId);assert.equal(state.events.at(-1).eventType,`meeting_${kind}`);}
assert.equal(JSON.stringify(state.projects),projectBefore);assert.equal(JSON.stringify(state.financials),financialsBefore);
const task={...valid.findings[0],kind:"task",title:"Preparar informe de muestra",quote:"Preparar el informe de muestra el 15 de octubre de 2026.",date:"2026-10-15"};
const taskId=crypto.randomUUID();apply(buildMeetingProposal(state,userId,meetingId,task,taskId));assert.equal(state.tasks.length,0);
assert.throws(()=>buildDailyCommand(state,userId,"edit_suggestion",{id:taskId,projectId:otherProject},crypto.randomUUID()));
act("edit_suggestion",{id:taskId,description:"Descripción revisada",estimatedMinutes:45});assert.equal(JSON.parse(state.suggestions.find(row=>row.id===taskId).payload).findingKind,"task");
act("suggestion_status",{id:taskId,status:"approved"});assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].sourceId,taskId);assert.ok(state.tasks[0].aiGenerated);assert.equal(state.tasks[0].estimatedMinutes,45);
assert.throws(()=>buildDailyCommand(state,userId,"suggestion_status",{id:taskId,status:"approved"},crypto.randomUUID()));
assert.throws(()=>buildMeetingProposal(state,userId,meetingId,{...task,title:"PREPARAR informe de múestra!"},crypto.randomUUID()));
const rejected=crypto.randomUUID();apply(buildMeetingProposal(state,userId,meetingId,{...task,title:"Revisar material adicional"},rejected));act("suggestion_status",{id:rejected,status:"rejected"});assert.equal(state.tasks.length,1);

const prefix=meetingQueryPrefix(meetingId,fingerprint),runId=crypto.randomUUID();
await reserveMeetingPart(userId,runId,projectId,prefix+"0");await assert.rejects(()=>reserveMeetingPart(userId,crypto.randomUUID(),projectId,prefix+"0"));
await finishAiRun(userId,runId,part);assert.equal((await meetingParts(userId,projectId,prefix)).length,1);assert.equal((await meetingParts("other-user",projectId,prefix)).length,0);
await assert.rejects(()=>reserveMeetingPart(userId,crypto.randomUUID(),projectId,prefix+"0"));
for(const index of [1,2])await reserveMeetingPart(userId,crypto.randomUUID(),projectId,prefix+index);
await assert.rejects(()=>reserveMeetingPart(userId,crypto.randomUUID(),projectId,prefix+"3"));
const completed={status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({summary:"Resumen",findings:[{...finding,evidenceId:"e0001"}]})}]}],usage:{input_tokens:100,output_tokens:40}};
providerResult=completed;const grounded=await requestMeetingAnalysis(text,{title:"Reunión ficticia",date:"2026-10-08",project:"Prueba",part:1,totalParts:1,existingTasks:[]});assert.equal(providerBody.store,false);assert.equal(providerBody.text.format.strict,true);assert.equal(grounded.result.findings[0].quote,text);assert.equal(providerBody.text.format.schema.properties.findings.items.properties.quote,undefined);assert.equal(providerBody.text.format.schema.properties.findings.items.properties.evidenceId.enum[0],"e0001");assert.equal(JSON.parse(providerBody.input[0].content).passages.map(passage=>passage.text).join(""),text);
providerResult={...completed,status:"incomplete"};await assert.rejects(()=>requestMeetingAnalysis(text,{title:"Ficticia",date:"2026-10-08",project:"Prueba",part:1,totalParts:1,existingTasks:[]}));
providerResult={status:"completed",output:[{content:[{type:"refusal"}]}]};await assert.rejects(()=>requestMeetingAnalysis(text,{title:"Ficticia",date:"2026-10-08",project:"Prueba",part:1,totalParts:1,existingTasks:[]}));
providerStatus=429;await assert.rejects(()=>requestMeetingAnalysis(text,{title:"Ficticia",date:"2026-10-08",project:"Prueba",part:1,totalParts:1,existingTasks:[]}));
const before=requests;await assert.rejects(()=>requestMeetingAnalysis(text,{title:"PASSWORD=synthetic-sensitive-value",date:"2026-10-08",project:"Prueba",part:1,totalParts:1,existingTasks:[]}));assert.equal(requests,before);
sql.close();console.log(JSON.stringify({passed:true,exactEvidenceValidated:true,completePartsRequired:true,duplicateFindingsAndTasksPrevented:true,noPrematureTask:true,nonTaskApprovalHistoryOnly:true,originPreservedAfterEdit:true,rejectCreatesNoTask:true,fragmentReservationAndSharedLimits:true,providerEdgeCasesChecked:true,liveApiCalls:0}));
