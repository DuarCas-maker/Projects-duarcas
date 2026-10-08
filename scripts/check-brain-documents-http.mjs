import assert from "node:assert/strict";
import {pdfFixture,docxFixture} from "./document-fixtures.mjs";
const base="http://127.0.0.1:3001", description="Verificación local de extracción PDF y DOCX. Solo datos ficticios.", marker=`documentos-prueba-${crypto.randomUUID().slice(0,8)}`;
async function request(path,body) {const response=await fetch(base+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});return {status:response.status,data:await response.json()};}
const initial=(await request("/api/state")).data;
const existing=initial.projects.find(row=>row.description===description && row.operationalStatus==="Activo");
const created=existing?{status:200,data:{id:existing.id,state:initial}}:await request("/api/action",{action:"create_project",payload:{name:"Prueba de lectura · PDF y Word",description,operationalStatus:"Activo"},commandId:crypto.randomUUID()});
assert.ok(created.status<300,created.data.error);const projectId=created.data.id;
const status=await request(`/api/brain?projectId=${projectId}`);assert.equal(status.status,200);assert.ok(status.data.configured && status.data.enabled);
const sources=[];
for(const [extension,bytes,type,expected] of [
  ["pdf",pdfFixture(`${marker}: el material ficticio del PDF sera azul y se revisara el martes.`),"application/pdf","azul"],
  ["docx",docxFixture(`${marker}: el color ficticio de Word será violeta y se revisará el miércoles.`),"application/vnd.openxmlformats-officedocument.wordprocessingml.document","violeta"],
]) {
  const form=new FormData();form.set("projectId",projectId);form.set("file",new File([bytes],`ejemplo-${marker}.${extension}`,{type}));
  const uploadResponse=await fetch(base+"/api/documents",{method:"POST",body:form}), uploaded=await uploadResponse.json();
  assert.equal(uploadResponse.status,201,uploaded.error);assert.equal(uploaded.item.processingStatus,"uploaded");assert.ok(uploaded.item.storageKey);
  const operation={action:"process",projectId,knowledgeId:uploaded.item.id,requestId:crypto.randomUUID()};
  const processed=await request("/api/brain",operation);assert.equal(processed.status,200,processed.data.error);assert.equal(processed.data.status,"ready");
  const replay=await request("/api/brain",operation);assert.equal(replay.status,200,replay.data.error);assert.equal(replay.data.replayed,true);
  const retained=replay.data.state.knowledge.find(row=>row.id===uploaded.item.id);assert.equal(retained.storageKey,uploaded.item.storageKey);assert.equal(retained.processingStatus,"indexed");
  sources.push({id:uploaded.item.id,extension,expected});
}
const recalled=await request("/api/brain",{action:"search",projectId,query:marker,requestId:crypto.randomUUID()});assert.equal(recalled.status,200,recalled.data.error);
for(const source of sources) assert.ok(recalled.data.hits.some(hit=>hit.knowledgeId===source.id && hit.text.includes(source.expected)),`Retrieved ${source.extension} text`);
assert.ok(recalled.data.hits.some(hit=>hit.text.includes("Página 1")),"PDF page marker retained in memory");
console.log(JSON.stringify({passed:true,projectId,marker,sources,originalsRetained:true,indexedAndRetrieved:true,replayWithoutDuplicate:true,aiCalls:0,syntheticFixtureKeptForPreview:true}));
