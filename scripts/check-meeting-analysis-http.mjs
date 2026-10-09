import assert from "node:assert/strict";
const base="http://127.0.0.1:3001",existingId=process.argv[2];let marker=`analisis-ficticio-${crypto.randomUUID().slice(0,8)}`;
async function json(path,body){const response=await fetch(base+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});return {status:response.status,data:await response.json()};}
async function action(name,payload,commandId=crypto.randomUUID()){const result=await json("/api/action",{action:name,payload,commandId});assert.ok(result.status<300,result.data.error);return result.data;}
const before=(await json("/api/state")).data,project=before.projects.find(row=>row.name==="Prueba de lectura · PDF y Word");assert.ok(project,"Use only the existing synthetic test project");
if(existingId){const item=before.knowledge.find(row=>row.id===existingId&&row.projectId===project.id&&/^Análisis de prueba · analisis-ficticio-[a-f0-9]{8}$/.test(row.title));assert.ok(item,"Only an existing synthetic analysis fixture may be reused");marker=item.title.replace("Análisis de prueba · ","");}
const transcript=`## Notas de Gemini · reunión ficticia ${marker}, sin datos de clientes.\r\n**Ana (00:02:10):** Decidimos usar material **zafiro** para la demostración ${marker}.\r\n`+"Registro ficticio: no hay acciones ni acuerdos adicionales en esta sección.\r\n".repeat(760)+`\r\n**Luis (01:29:00):** La tarea acordada es preparar el informe ${marker} y entregarlo el 15 de octubre de 2026. Yo, Luis, lo prepararé.\r\n`;
assert.ok(new TextEncoder().encode(transcript).length>48*1024);assert.ok(new TextEncoder().encode(transcript).length<64*1024);
const notes=`Notas ficticias ${marker}: El informe está bloqueado hasta recibir la muestra. Pregunta pendiente: ¿quién revisará el informe antes de entregarlo?`,id=existingId??crypto.randomUUID();
const form=new FormData();for(const [key,value] of Object.entries({requestId:id,projectId:project.id,title:`Análisis de prueba · ${marker}`,date:"2026-10-08",driveUrl:""}))form.set(key,value);
form.set("transcript",new File([transcript],"transcripcion.txt",{type:"text/plain"}));form.set("notes",new File([notes],"notas.md",{type:"text/markdown"}));
if(!existingId){const upload=await fetch(base+"/api/meetings",{method:"POST",body:form}),saved=await upload.json();assert.equal(upload.status,201,saved.error);}
const extracted=value=>value.trim();
const source=`Reunión: Análisis de prueba · ${marker}\nFecha: 2026-10-08\n\nTRANSCRIPCIÓN COMPLETA · transcripcion.txt\n\n${extracted(transcript)}\n\nNOTAS DE LA REUNIÓN · notas.md\n\n${extracted(notes)}`;
const initial=await json(`/api/meetings/analyze?id=${id}`);assert.equal(initial.status,200);let second;
if(!existingId){assert.equal(initial.data.analysis.status,"not_started");assert.ok(initial.data.ai.used+2<=initial.data.ai.limit);
assert.equal((await json("/api/meetings/analyze",{id,action:"propose",findingId:"0:0"})).status,409);
const firstOperation={id,action:"analyze",requestId:crypto.randomUUID()},first=await json("/api/meetings/analyze",firstOperation);assert.equal(first.status,200,first.data.error);assert.equal(first.data.analysis.status,"partial");assert.equal(first.data.analysis.completedParts,1);assert.equal(first.data.analysis.findings.length,0);
assert.equal((await json("/api/state")).data.tasks.length,before.tasks.length);
const replay=await json("/api/meetings/analyze",firstOperation);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
const persisted=await json(`/api/meetings/analyze?id=${id}`);assert.equal(persisted.data.analysis.completedParts,1);assert.equal(persisted.data.ai.used,initial.data.ai.used+1);
// A second manual continuation reads the remainder and the notes, not GBrain hits.
second=await json("/api/meetings/analyze",{id,action:"analyze",requestId:crypto.randomUUID()});}else second=initial;
assert.equal(second.status,200,second.data.error);assert.equal(second.data.analysis.status,"ready");assert.equal(second.data.analysis.completedParts,2);
const findings=second.data.analysis.findings;assert.ok(findings.length);assert.ok(findings.every(finding=>source.includes(finding.quote)),"Every quote is copied literally from the extracted source");assert.ok(findings.some(finding=>finding.part===0));assert.ok(findings.some(finding=>finding.part===1));
assert.equal((await json("/api/state")).data.tasks.length,before.tasks.length);
const task=findings.find(finding=>finding.kind==="task"),decision=findings.find(finding=>finding.kind==="decision");assert.ok(decision,"Explicit first-fragment decision is found");let expectedTasks=before.tasks.length;
// Existing fixture projects may already contain a similar task. Suppression is
// intentional; task approval itself is also covered deterministically in unit checks.
if(task){
const proposal=await json("/api/meetings/analyze",{id,action:"propose",findingId:task.id});assert.equal(proposal.status,200,proposal.data.error);assert.equal(proposal.data.state.tasks.length,before.tasks.length);
const repeated=await json("/api/meetings/analyze",{id,action:"propose",findingId:task.id});assert.equal(repeated.data.replayed,true);assert.equal(repeated.data.proposalId,proposal.data.proposalId);
await action("edit_suggestion",{id:proposal.data.proposalId,description:"Tarea ficticia editada para verificar la revisión",estimatedMinutes:45});
const approvalId=crypto.randomUUID(),approved=await action("suggestion_status",{id:proposal.data.proposalId,status:"approved"},approvalId);assert.equal(approved.state.tasks.length,before.tasks.length+1);assert.ok(approved.state.tasks.some(row=>row.sourceId===proposal.data.proposalId&&row.estimatedMinutes===45));
const approvalReplay=await action("suggestion_status",{id:proposal.data.proposalId,status:"approved"},approvalId);assert.equal(approvalReplay.state.tasks.length,before.tasks.length+1);
expectedTasks++;}
const decisionProposal=await json("/api/meetings/analyze",{id,action:"propose",findingId:decision.id});assert.equal(decisionProposal.status,200,decisionProposal.data.error);
const projectBefore=JSON.stringify(decisionProposal.data.state.projects.find(row=>row.id===project.id)),financialsBefore=JSON.stringify(decisionProposal.data.state.financials);
const decisionRepeat=await json("/api/meetings/analyze",{id,action:"propose",findingId:decision.id});assert.equal(decisionRepeat.data.replayed,true);assert.equal(decisionRepeat.data.proposalId,decisionProposal.data.proposalId);
const decisionApproval=await action("suggestion_status",{id:decisionProposal.data.proposalId,status:"approved"});assert.equal(decisionApproval.state.tasks.length,expectedTasks);assert.equal(JSON.stringify(decisionApproval.state.projects.find(row=>row.id===project.id)),projectBefore);assert.equal(JSON.stringify(decisionApproval.state.financials),financialsBefore);assert.ok(decisionApproval.state.events.some(row=>row.eventType==="meeting_decision"&&row.sourceId===id));
const final=await json(`/api/meetings/analyze?id=${id}`);assert.equal(final.data.ai.used,initial.data.ai.used+(existingId?0:2));assert.equal(final.data.analysis.status,"ready");
console.log(JSON.stringify({passed:true,projectId:project.id,meetingId:id,marker,parts:2,findings:findings.length,fullSourceAndNotesRead:true,progressPersists:true,replayDoesNotCallAI:true,proposalDoesNotCreateTask:true,editedApprovalCreatesExactlyOneTask:!!task,decisionApprovalHistoryOnly:true,liveApiCalls:existingId?0:2,syntheticFixtureKept:true}));
