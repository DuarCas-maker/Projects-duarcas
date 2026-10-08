import assert from "node:assert/strict";
import vm from "node:vm";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const context=vm.createContext({crypto,TextEncoder,TextDecoder,Uint8Array,URL,console});
async function load(relative) {
  const compiled=await build({entryPoints:[fileURLToPath(new URL(relative,import.meta.url))],bundle:true,format:"esm",platform:"node",packages:"external",write:false});
  const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();return module.namespace;
}
const {memoryChunks,partRequestId,selectMemoryHits}=await load("../lib/brain-content.ts");
const {driveVideoUrl,readMeeting,MEETING_PREFIX}=await load("../lib/meetings.ts");
const text="[00:30:00] María: decisión con información y caracteres 🧠.\n".repeat(1200)+"[01:29:00] Fin: conservar esta última decisión.";
const parts=memoryChunks("Reunión","Proyecto",text);assert.ok(parts.length>1);assert.equal(parts.map(part=>part.text).join(""),text);for(const part of parts)assert.ok(new TextEncoder().encode(part.markdown).length<=48*1024);
assert.equal(await partRequestId("fixture",1),await partRequestId("fixture",1));assert.notEqual(await partRequestId("fixture",1),await partRequestId("fixture",2));
assert.throws(()=>memoryChunks("Reunión","Proyecto","PASSWORD=synthetic-sensitive-value"));
assert.throws(()=>memoryChunks("Reunión","Proyecto","x".repeat(512*1024+1)));
const link="https://drive.google.com/file/d/synthetic_meeting_reference/view";assert.equal(driveVideoUrl(link),link);
for(const url of ["javascript:alert(1)","https://drive.google.com.evil.example/file/d/video/view","https://drive.google.com/drive/folders/test","https://user:pass@drive.google.com/file/d/test/view","http://drive.google.com/file/d/test/view"]) assert.throws(()=>driveVideoUrl(url));
const row={source_id:"project-os",external_reference:"project-os/test/item",knowledge_id:"fixture",project_id:"project",title:"Reunión"};
assert.equal(selectMemoryHits([{source_id:"project-os",slug:row.external_reference+"/part-0002",chunk_text:"última decisión"}],[row])[0].knowledgeId,"fixture");
assert.equal(selectMemoryHits([{source_id:"other",slug:row.external_reference+"/part-0002",chunk_text:"wrong source"}],[row]).length,0);
assert.equal(selectMemoryHits([{source_id:"project-os",slug:row.external_reference+"/part-0017",chunk_text:"unlinked"}],[row]).length,0);
assert.equal(readMeeting({itemType:"meeting",sourceReference:MEETING_PREFIX+JSON.stringify({version:1,files:[]})}),null);
console.log(JSON.stringify({passed:true,chunks:parts.length,completeUnicodeTextRetained:true,stableReceipts:true,driveLinksValidated:true,scopedFragmentRetrieval:true,noApiCalls:true}));
