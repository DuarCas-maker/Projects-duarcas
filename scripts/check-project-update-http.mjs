import assert from "node:assert/strict";

// Local preview only. All writes and API context stay inside a newly created,
// clearly named synthetic project; no real meetings or other projects edited.
const base="http://127.0.0.1:3001";
let marker=`fase2-ficticia-${crypto.randomUUID().slice(0,8)}`;
async function request(path,body,expected=200){
  const response=await fetch(base+path,{method:body ? "POST" : "GET",headers:body && !(body instanceof FormData) ? {"Content-Type":"application/json",Origin:base} : {Origin:base},body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(90000)});
  const result=await response.json();if(response.status!==expected && !(expected===200 && response.status===201))throw Error(`${path}: expected ${expected}, got ${response.status}: ${result.error??"unknown failure"}`);return result;
}
const action=async(action,payload)=>request("/api/action",{action,payload,commandId:crypto.randomUUID()});
const initial=await request("/api/ai");
let created;
if(process.argv[2]){const saved=(await request("/api/state")).projects.find(p=>p.id===process.argv[2]);if(!saved || !/^Prueba fase 2 · fase2-ficticia-[a-f0-9]{8}$/.test(saved.name))throw Error("Only a synthetic phase 2 project may be resumed.");marker=saved.name.split(" · ")[1];created={id:saved.id};}
else created=await action("create_project",{name:`Prueba fase 2 · ${marker}`,operationalStatus:"Activo",currentSummary:"Resumen ficticio anterior",nextStepSummary:"Paso ficticio anterior",commercialStatus:"Interno",priority:2,strategicPriority:2});
const projectId=created.id;assert.ok(projectId);
console.log(JSON.stringify({fixtureProjectId:projectId,marker}));
const task=await action("create_task",{projectId,title:`Preparar informe ficticio ${marker}`,description:`Detalle profundo de tarea ${marker}-descripcion`,priority:5,urgency:5,estimatedMinutes:30});
await action("create_task",{projectId,title:`Revisar después ${marker}`,priority:5,urgency:5,status:"blocked",blockingReason:"Bloqueo ficticio de prueba"});
const meetingId=crypto.randomUUID(),tail=`${marker}-contenido-completo`;
const transcript=`## Reunión ficticia de prueba\r\nAna: Preparar el informe ficticio y revisar el bloqueo, sin cambiar fechas ni pagos.\r\n${"Contenido de relleno ficticio sin acuerdos adicionales.\r\n".repeat(2200)}Última línea de la transcripción: ${tail}.\r\n`;
const form=new FormData();form.set("projectId",projectId);form.set("requestId",meetingId);form.set("title",`Seguimiento ficticio ${marker}`);form.set("date","2026-10-09");form.set("transcript",new File([transcript],"transcripcion-ficticia.md",{type:"text/markdown"}));form.set("notes",new File([`Notas ficticias: ${marker}-notas-finales`],"notas-ficticias.md",{type:"text/markdown"}));
await request("/api/meetings",form,201);
const search=await request(`/api/search?q=${encodeURIComponent(tail)}`);assert.ok(search.results.some(r=>r.knowledgeId===meetingId));
assert.ok((await request(`/api/search?q=${marker}-notas-finales`)).results.some(r=>r.knowledgeId===meetingId));
assert.ok((await request(`/api/search?q=${marker}-descripcion`)).results.some(r=>r.id===task.id));
const source=await request(`/api/search?sourceId=${meetingId}`);assert.ok(source.content.includes(transcript.trim()));assert.ok(source.content.includes(`${marker}-notas-finales`));
await request("/api/search",{knowledgeId:"not-owned"},404);
const viewUrl=`/api/projects/update?projectId=${projectId}&meetingId=${meetingId}`,view=await request(viewUrl);assert.equal(view.snapshot.meeting.status,"not_started");assert.equal(view.snapshot.candidates[0].id,task.id);assert.equal(view.snapshot.counts.blocked,1);
const before=await request("/api/state"),runId=crypto.randomUUID();
const generated=await request("/api/projects/update",{action:"generate",projectId,meetingId,requestId:runId});assert.ok(generated.latest.result.summary);const confirmedIds=new Set([...view.snapshot.applied,...view.snapshot.recent].map(r=>r.id));assert.ok(generated.latest.result.changes.every(c=>c.sourceIds.every(id=>confirmedIds.has(id))));assert.ok(generated.latest.result.nextAction.taskId===task.id || generated.latest.result.nextAction.taskId===null);
const same=await request("/api/projects/update",{action:"generate",projectId,meetingId,requestId:crypto.randomUUID()});assert.equal(same.latest.id,generated.latest.id);assert.equal(same.replayed,true);
assert.equal(JSON.stringify((await request("/api/state")).projects),JSON.stringify(before.projects));
await action("update_task",{id:task.id,description:`Texto actualizado ${marker}-descripcion`});assert.equal((await request(viewUrl)).stale,true);
await request("/api/projects/update",{action:"apply",projectId,meetingId,runId:generated.latest.id,summary:generated.latest.result.summary,nextStep:generated.latest.result.nextAction.title},409);
const updated=await request("/api/projects/update",{action:"generate",projectId,meetingId,requestId:crypto.randomUUID()});
const beforeApply=await request("/api/state"),summary=`Resumen revisado manualmente para ${marker}`,nextStep=`Siguiente acción revisada para ${marker}`;
const applyBody={action:"apply",projectId,meetingId,runId:updated.latest.id,summary,nextStep},applied=await request("/api/projects/update",applyBody);assert.equal(applied.applied,true);
const project=applied.state.projects.find(p=>p.id===projectId),previous=beforeApply.projects.find(p=>p.id===projectId);assert.equal(project.currentSummary,summary);assert.equal(project.nextStepSummary,nextStep);
for(const field of ["operationalStatus","commercialStatus","priority","strategicPriority","targetEndDate","blockedReason"])assert.equal(project[field],previous[field]);assert.deepEqual(applied.state.tasks,beforeApply.tasks);assert.deepEqual(applied.state.financials,beforeApply.financials);
const replay=await request("/api/projects/update",applyBody);assert.equal(replay.replayed,true);assert.equal(replay.state.events.length,applied.state.events.length);
await request("/api/projects/update",{...applyBody,projectId:"charlo",meetingId:""},404);
await request("/api/projects/update?projectId=not-owned",undefined,404);
const after=await request("/api/ai");assert.equal(after.used-initial.used,2);
console.log(JSON.stringify({passed:true,projectId,meetingId,marker,liveApiCalls:2,completeTranscriptAndNotesSearch:true,taskDescriptionSearch:true,noAutomaticOperationalChanges:true,cachedReplayWithoutExtraCost:true,staleApplyRejected:true,manualEditedSummaryApplied:true,paymentsDatesTasksUnchanged:true,applyIdempotent:true}));
