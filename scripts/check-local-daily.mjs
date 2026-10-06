import assert from "node:assert/strict";
const base="http://127.0.0.1:3001";
async function request(path,body) { const response=await fetch(base+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}); const data=await response.json(); return {status:response.status,data}; }
async function act(action,payload,commandId=crypto.randomUUID()) { const result=await request("/api/action",{action,payload,commandId}); assert.ok(result.status<300,`${action}: ${result.data.error}`); return result.data; }
const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const fixture=await act("create_project",{name:`Verificación Daily OS · ${crypto.randomUUID().slice(0,8)}`,description:"Datos ficticios de verificación local. Sin información de clientes.",operationalStatus:"Activo"});
const projectId=fixture.id;
const note=await act("create_inbox",{content:`${fixture.project.name}: preparar una tarea de prueba`});
const before=(await request("/api/state")).data.tasks.length;
const proposed=await act("create_task_suggestion",{projectId,inboxId:note.id,title:"Tarea ficticia sin ejecutar",estimatedMinutes:25});
assert.equal(proposed.state.tasks.length,before);
await act("edit_suggestion",{id:proposed.id,title:"Tarea ficticia editada"});
const approvalId=crypto.randomUUID(), approved=await act("suggestion_status",{id:proposed.id,status:"approved"},approvalId);
assert.equal(approved.state.tasks.length,before+1);
assert.ok(approved.state.tasks.some((task)=>task.sourceId===proposed.id && task.title==="Tarea ficticia editada"));
const replay=await act("suggestion_status",{id:proposed.id,status:"approved"},approvalId); assert.equal(replay.state.tasks.length,before+1);
assert.equal((await request("/api/action",{action:"suggestion_status",payload:{id:proposed.id,status:"approved"},commandId:crypto.randomUUID()})).status,409);
const block=await act("create_calendar",{projectId,title:"Compromiso ficticio",day,start:"09:00",end:"10:00"}); await act("approve_calendar",{ids:[block.id]});
const overlap=await act("create_calendar",{projectId,title:"Colisión ficticia",day,start:"09:30",end:"10:30"});
assert.equal((await request("/api/action",{action:"approve_calendar",payload:{ids:[overlap.id]},commandId:crypto.randomUUID()})).status,409);
await act("cancel_calendar",{ids:[block.id,overlap.id]});
await act("update_task_status",{id:approved.state.tasks.find((task)=>task.sourceId===proposed.id).id,status:"completed"});
await act("update_project",{id:projectId,operationalStatus:"Archivado",nextStepSummary:"Verificación local terminada; contiene solamente datos ficticios."});
const reloaded=(await request("/api/state")).data;
assert.equal(reloaded.suggestions.find((row)=>row.id===proposed.id).status,"approved"); assert.equal(reloaded.projects.find((row)=>row.id===projectId).operationalStatus,"Archivado");
const ai=(await request("/api/ai")).data; assert.equal(ai.configured,true);
console.log(JSON.stringify({passed:true,proposalDoesNotCreateTask:true,approvalCreatesOneTask:true,replayDoesNotDuplicate:true,overlapRejected:true,reloadPersists:true,fixtureArchived:true,aiConfigured:ai.configured,aiContextEnabled:ai.enabled}));
