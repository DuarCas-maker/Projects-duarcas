import assert from "node:assert/strict";
const base="http://127.0.0.1:3001";
async function request(path,body) { const response=await fetch(base+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}); return {status:response.status,data:await response.json()}; }
const initial=(await request("/api/state")).data, fixture=initial.projects.find(row=>row.name.startsWith("Verificación GBrain · ") && row.description==="Prueba local de memoria con texto ficticio. Sin datos de clientes." && row.operationalStatus==="Activo");
const created=fixture ? {status:200,data:{id:fixture.id,state:initial}} : await request("/api/action",{action:"create_project",payload:{name:`Verificación GBrain · ${crypto.randomUUID().slice(0,8)}`,description:"Prueba local de memoria con texto ficticio. Sin datos de clientes.",operationalStatus:"Activo"},commandId:crypto.randomUUID()});
assert.ok(created.status<300,created.data.error); const projectId=created.data.id, previous=initial.knowledge.find(row=>row.projectId===projectId && row.title.startsWith("Nota ficticia · memoria-prueba-")), marker=previous?.title.split(" · ")[1] ?? `memoria-prueba-${crypto.randomUUID().slice(0,8)}`;
const note={action:"create_note",projectId,title:`Nota ficticia · ${marker}`,content:`La decisión de prueba ${marker} establece que el material de ejemplo será verde y que la entrega ficticia será el jueves. Este texto no representa un compromiso real.`,requestId:previous?.id ?? crypto.randomUUID()};
const saved=await request("/api/brain",note); assert.equal(saved.status,200,saved.data.error); assert.equal(saved.data.status,"ready");
const replay=await request("/api/brain",note); assert.equal(replay.status,200,replay.data.error); assert.equal(replay.data.replayed,true); assert.equal(replay.data.state.knowledge.filter(row=>row.id===note.requestId).length,1);
const searchBody={action:"search",projectId,query:marker,requestId:crypto.randomUUID()};
const recalled=await request("/api/brain",searchBody); assert.equal(recalled.status,200,recalled.data.error); assert.ok(recalled.data.hits.some(hit=>hit.knowledgeId===note.requestId && hit.text.includes(marker)),"Memory retrieved from GBrain");
const before=(await request(`/api/brain?projectId=${projectId}`)).data.used;
assert.equal((await request("/api/brain",searchBody)).status,200); assert.equal((await request(`/api/brain?projectId=${projectId}`)).data.used,before,"Search replay does not consume another operation");
const other=created.data.state.projects.find(row=>row.id!==projectId).id;
assert.equal((await request("/api/brain",{...note,projectId:other})).status,409);
assert.equal((await request("/api/brain",{action:"process",projectId:other,knowledgeId:note.requestId,requestId:crypto.randomUUID()})).status,404);
const unrelated=await request("/api/brain",{action:"search",projectId:other,query:marker,requestId:crypto.randomUUID()}); assert.equal(unrelated.status,200); assert.equal(unrelated.data.hits.length,0);
assert.equal((await request("/api/brain",{...note,requestId:crypto.randomUUID(),content:"API_KEY=synthetic-sensitive-value"})).status,422);
if (process.argv.includes("--with-ai")) {
  const ai=await request("/api/ai",{kind:"chat",projectId,query:`¿Qué material establece la decisión ${marker}? Cita la memoria.`,requestId:crypto.randomUUID()});
  assert.equal(ai.status,200,ai.data.error); assert.equal(ai.data.memory.status,"connected"); assert.ok(ai.data.memory.count>0);
  assert.ok(ai.data.sources[`brain:${note.requestId}`],"Retrieved memory is a valid evidence source");
  assert.ok(ai.data.response.facts.some(claim=>claim.sourceIds.some(id=>[note.requestId,`brain:${note.requestId}`].includes(id))),"AI cites the original or its retrieved memory, both represent the same note");
}
await request("/api/action",{action:"update_project",payload:{id:projectId,operationalStatus:"Archivado",nextStepSummary:"Verificación local de GBrain terminada. Solo contiene datos ficticios."},commandId:crypto.randomUUID()});
console.log(JSON.stringify({passed:true,projectId,knowledgeId:note.requestId,storedAndRead:true,noDuplicateOnReplay:true,searchReplayNoExtraCost:true,otherProjectRejected:true,secretsRejected:true,aiTested:process.argv.includes("--with-ai"),fixtureArchived:true}));
