// Full upload/publish/revise/download flow with synthetic records and in-memory
// storage only. No credentials, customer records or live provider calls.
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { zipSync,strToU8 } from "fflate";
import { d1Adapter } from "../runtime/sqlite.mjs";
const sql=new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../drizzle/0001_empty_blade.sql",import.meta.url),"utf8"));
sql.exec(await readFile(new URL("../drizzle/0003_rare_senator_kelly.sql",import.meta.url),"utf8"));
const owner="fixture-owner",projectId="fixture-project",taskId="fixture-task",objects=new Map();
const state={projects:[{id:projectId,userId:owner,name:"Proyecto ficticio"}],tasks:[{id:taskId,userId:owner,projectId,title:"Preparar entrega ficticia",status:"completed"}],knowledge:[],milestones:[],events:[],financials:[],repositories:[],suggestions:[],inbox:[],calendar:[],dependencies:[]};
let deny=false,linkReads=0,imageReads=0,failLink=false,failRoot=false;
const fixture={
  async workspace(){return structuredClone(state);},
  async owner(){if(deny)throw Object.assign(new Error("Sin sesión"),{status:401});return owner;},
  async insert(row){if(failRoot&&row.itemType==="task_attachment"){failRoot=false;throw Error("interrupted manifest write");}if(state.knowledge.some(k=>k.id===row.id))throw Error("duplicate");state.knowledge.push(structuredClone(row));},
  async compare(previous,patch){const current=state.knowledge.find(k=>k.id===previous.id&&k.userId===previous.userId);if(!current||current.sourceReference!==previous.sourceReference)throw Error("conflict");Object.assign(current,patch);},
  async write(key,file){objects.set(key,new Uint8Array(await file.arrayBuffer()));},
  async read(user,project,key){assert.ok(key.startsWith(`${user}/${project}/`));assert.ok(objects.has(key));return objects.get(key);},
  async fetchLink(url){linkReads++;if(failLink)throw Error("link unavailable");return {bytes:strToU8(`<html><body><h1>Enlace ficticio</h1><p>Color ámbar para la entrega. ${url}</p><script>ignorar</script></body></html>`),mime:"text/html",name:"enlace.html"};},
};
const env={DB:d1Adapter(sql),OPENAI_API_KEY:"synthetic-test-key",PROJECT_OS_AI_CONTEXT_ENABLED:"true",BUCKET:{async get(key){const bytes=objects.get(key);return bytes?{body:bytes}:null;}}};
const context=vm.createContext({crypto,Intl,Date,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,URL,AbortSignal,Response,Request,File,FormData,setTimeout,clearTimeout,btoa,structuredClone,console,fixture,fixtureEnv:env,async fetch(){imageReads++;return Response.json({status:"completed",output:[{content:[{type:"output_text",text:"Imagen ficticia: etiqueta azul y número 42."}]}],usage:{input_tokens:20,output_tokens:20}});}});
const compiled=await build({stdin:{contents:'export {POST,GET} from "../app/api/task-attachments/route"; export * from "../lib/task-attachments"; export * from "../lib/global-search"; export {searchIndex} from "../db/knowledge-search"; export {recallMemory} from "../lib/brain-provider"; export {extractDocumentText} from "../lib/brain-documents"; export {publicAddress} from "../lib/task-resource-link";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,platform:"node",format:"esm",packages:"external",write:false,plugins:[{name:"fixture",setup(b){
  b.onResolve({filter:/^(cloudflare:workers|@\/db\/workspace|@\/db\/task-attachments|@\/lib\/workspace-context)$/},args=>({path:args.path,namespace:"fixture"}));
  b.onResolve({filter:/task-resource-link$/},args=>args.importer.endsWith("task-attachment-service.ts")?{path:"link",namespace:"fixture"}:undefined);
  b.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"js",contents:path==="cloudflare:workers"?'export const env=globalThis.fixtureEnv;':path==="@/db/workspace"?'export const getWorkspaceState=globalThis.fixture.workspace;':path==="@/db/task-attachments"?'export const insertAttachmentRow=globalThis.fixture.insert,compareAttachmentRow=globalThis.fixture.compare,writeTaskObject=globalThis.fixture.write,readTaskObject=globalThis.fixture.read;':path==="link"?'export const fetchTaskLink=globalThis.fixture.fetchLink;':'export class WorkspaceConfigurationError extends Error {constructor(message,status){super(message);this.status=status;}} export async function currentWorkspaceId(){try{return await globalThis.fixture.owner();}catch{throw new WorkspaceConfigurationError("Sin sesión",401);}}'}));
}}]});
const modules=new Map();
async function external(name){if(modules.has(name))return modules.get(name);const value=await import(name);const result=new vm.SyntheticModule(Object.keys(value),function(){for(const key of Object.keys(value))this.setExport(key,value[key]);},{context});modules.set(name,result);await result.link(external);await result.evaluate();return result;}
const root=new vm.SourceTextModule(compiled.outputFiles[0].text,{context,importModuleDynamically:external});await root.link(external);await root.evaluate();
const api=root.namespace;
async function post(action,{file,url,name,attachmentId,id=crypto.randomUUID(),task=taskId}={}){const form=new FormData();for(const [k,v] of Object.entries({action,taskId:task,requestId:id,file,url,name,attachmentId}))if(v!==undefined)form.set(k,v);const response=await api.POST(new Request("http://fixture/api/task-attachments",{method:"POST",body:form}));return {response,data:await response.json()};}
const oldFile=new File(["Entrega ficticia: color zafiro, presupuesto 120."],"entrega.txt",{type:"text/plain"});
const uploadId=crypto.randomUUID(),uploaded=await post("upload",{file:oldFile,id:uploadId});assert.equal(uploaded.response.status,201,uploaded.data.error);assert.equal(api.activeKnowledge(state).length,0);assert.equal((await api.searchIndex(owner,state,"zafiro")).matches.length,0);
let attachment=api.taskAttachments(state,taskId)[0];assert.ok(attachment);assert.equal(attachment.attachment.published,false);
const replay=await post("upload",{file:oldFile,id:uploadId});assert.equal(replay.data.replayed,true);assert.equal(attachment.attachment.versions.length,1);
const published=await post("publish",{attachmentId:attachment.item.id});assert.equal(published.data.status,"ready",published.data.warning);assert.equal((await api.searchIndex(owner,state,"zafiro")).matches.length,1);
const revised=await post("update",{attachmentId:attachment.item.id,file:new File(["Entrega ficticia: color rubí, presupuesto 240."],"entrega-final.txt",{type:"text/plain"})});assert.equal(revised.data.status,"ready",revised.data.warning);
attachment=api.taskAttachments(state,taskId)[0];assert.equal(attachment.attachment.versions.length,2);assert.equal((await api.searchIndex(owner,state,"zafiro")).matches.length,0);assert.equal((await api.searchIndex(owner,state,"rubí")).matches.length,1);
assert.equal(api.activeKnowledge(state).length,1);assert.equal(api.searchRecords(state,"zafiro").length,0);
const memory=await api.recallMemory(owner,[projectId],"presupuesto rubí",crypto.randomUUID(),state);assert.equal(memory.hits.length,1);assert.ok(memory.hits[0].text.includes("240"));assert.ok(!memory.hits[0].text.includes("120"));
const oldDownload=await api.GET(new Request(`http://fixture/api/task-attachments?taskId=${taskId}&versionId=${uploadId}`));assert.equal(oldDownload.status,200);assert.equal(await oldDownload.text(),await oldFile.text());
assert.equal((await post("update",{attachmentId:attachment.item.id,file:oldFile,task:"other-task"})).response.status,404);
assert.equal((await post("upload",{url:"http://localhost/private"})).response.status,400);
assert.equal((await post("upload",{file:new File(["script"],"malware.html")})).response.status,422);
const linked=await post("upload",{url:"https://example.com/public",name:"Referencia ficticia"});assert.equal(linked.response.status,201);assert.equal(linkReads,0);
let link=api.taskAttachments(state,taskId).find(a=>a.attachment.kind==="link");assert.equal((await post("publish",{attachmentId:link.item.id})).data.status,"ready");assert.equal(linkReads,1);
assert.equal((await post("retry",{attachmentId:link.item.id})).data.status,"ready");assert.equal(linkReads,1,"Ready link snapshots must not be reread or overwritten");
failLink=true;const failed=await post("update",{attachmentId:link.item.id,url:"https://example.com/unavailable"});assert.equal(failed.data.status,"pending");link=api.taskAttachments(state,taskId).find(a=>a.attachment.kind==="link");assert.equal(link.attachment.versions.length,2);assert.ok(link.attachment.versions[1].error);assert.equal((await api.searchIndex(owner,state,"ámbar")).matches.length,0);failLink=false;
assert.equal((await post("retry",{attachmentId:link.item.id})).data.status,"ready");
const oldSnapshot=await api.GET(new Request(`http://fixture/api/task-attachments?taskId=${taskId}&versionId=${link.attachment.versions[0].id}&snapshot=1`));assert.equal(oldSnapshot.status,200);assert.ok((await oldSnapshot.text()).includes("https://example.com/public"));
await post("upload",{file:new File([new Uint8Array([137,80,78,71,13,10,26,10])],"imagen.png",{type:"image/png"})});assert.equal(imageReads,0);const imageRoot=api.taskAttachments(state,taskId).find(a=>a.item.title==="imagen.png");assert.equal((await post("publish",{attachmentId:imageRoot.item.id})).data.status,"ready");assert.equal(imageReads,1);await post("retry",{attachmentId:imageRoot.item.id});assert.equal(imageReads,1);
const imageVersion=state.knowledge.find(k=>k.id===api.taskAttachments(state,taskId).find(a=>a.item.id===imageRoot.item.id).attachment.activeVersionId);
imageVersion.processingStatus="indexed";
assert.ok((await api.recallMemory(owner,[projectId],"etiqueta azul",crypto.randomUUID(),state)).hits.some(hit=>hit.knowledgeId===imageVersion.id));
assert.equal((await post("retry",{attachmentId:imageRoot.item.id})).data.status,"ready");assert.equal(imageReads,1,"GBrain indexing must not trigger another image read");
const xlsx=zipSync({"[Content_Types].xml":strToU8("<Types/>"),"xl/workbook.xml":strToU8('<workbook><sheets><sheet name="Presupuesto"/></sheets></workbook>'),"xl/sharedStrings.xml":strToU8("<sst><si><t>Importe ámbar</t></si></sst>"),"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>123</v></c><c t="inlineStr"><is><t>Confirmado</t></is></c></row></sheetData></worksheet>')});
const excel=await api.extractDocumentText("fixture.xlsx",xlsx,true);assert.ok(excel.includes("Importe ámbar"));assert.ok(excel.includes("123"));assert.ok(excel.includes("Confirmado"));
const pptx=zipSync({"[Content_Types].xml":strToU8("<Types/>"),"ppt/presentation.xml":strToU8("<p:presentation/>"),"ppt/slides/slide1.xml":strToU8("<p:sld><a:p><a:r><a:t>Entrega ficticia</a:t></a:r></a:p></p:sld>"),"ppt/notesSlides/notesSlide1.xml":strToU8("<p:notes><a:t>Nota verificable</a:t></p:notes>")});const slides=await api.extractDocumentText("fixture.pptx",pptx,true);assert.ok(slides.includes("Entrega ficticia"));assert.ok(slides.includes("Nota verificable"));
for(const address of ["127.0.0.1","10.0.0.1","169.254.169.254","172.16.0.1","192.168.1.1","::1","::ffff:127.0.0.1","fc00::1","2001:db8::1"])assert.equal(api.publicAddress(address),false,address);
for(const address of ["8.8.8.8","2606:4700:4700::1111"])assert.equal(api.publicAddress(address),true,address);
const resumedId=crypto.randomUUID();failRoot=true;
assert.equal((await post("upload",{file:oldFile,id:resumedId})).response.status,503);
assert.equal((await post("upload",{file:new File(["must not replace the original"],"changed.txt"),id:resumedId})).response.status,201);
assert.equal(state.knowledge.filter(k=>k.id===resumedId).length,1);
assert.equal(await (await api.GET(new Request(`http://fixture/api/task-attachments?taskId=${taskId}&versionId=${resumedId}`))).text(),await oldFile.text(),"Interrupted uploads must recover without overwriting their original");
deny=true;assert.equal((await post("upload",{file:oldFile})).response.status,401);assert.equal((await api.GET(new Request(`http://fixture/api/task-attachments?taskId=${taskId}&versionId=${uploadId}`))).status,401);deny=false;
assert.equal(state.tasks[0].status,"completed");assert.equal(state.tasks.length,1);assert.equal(state.events.length,0);
console.log(JSON.stringify({passed:true,manualFirstPublication:true,automaticVersionUpdate:true,originalHistoryPreserved:true,supersededContentExcludedFromSearchAndAI:true,linkSnapshotsAndRetry:true,imageReadOnlyOnPublication:true,xlsxAndPptxExtraction:true,privateAddressesRejected:true,taskAndOwnerIsolation:true,liveApiCalls:0}));
if(process.argv.includes("--preview")) {
  const {createServer}=await import("node:http");
  const directory=new URL("../outputs/task-resources-preview/",import.meta.url);await mkdir(directory,{recursive:true});
  const entry=new URL("entry.tsx",directory);
  await writeFile(entry,`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {TaskFilesButton,TaskResources} from '../../app/task-attachments';function App(){const [state,setState]=useState(null),[view,setView]=useState('tasks');useEffect(()=>{fetch('/fixture-state').then(r=>r.json()).then(setState)},[]);if(!state)return <p>Cargando…</p>;const task=state.tasks[0];return <main style={{maxWidth:1150,margin:'32px auto',padding:24}}><p className="eyebrow">VISTA LOCAL · DATOS FICTICIOS</p><h1 style={{fontSize:28,marginBottom:24}}>Recursos de las tareas</h1><nav style={{display:'flex',gap:16,marginBottom:24}}><button onClick={()=>setView('tasks')}>Tareas</button><button onClick={()=>setView('context')}>Contexto</button></nav>{view==='tasks'?<section className="panel"><h2>Ejecución</h2><div className="task-list compact"><article className="task-row"><button className="task-check">✓</button><div className="task-main"><div className="task-topline"><strong>Proyecto ficticio</strong><span className="status-pill">Completada</span></div><h3>{task.title}</h3><p>Los archivos conservan su historial de versiones.</p></div><div className="task-meta">45 min</div><div className="task-row-controls"><TaskFilesButton state={state} task={task} acceptState={setState}/><button data-slot="button">Editar tarea</button></div></article></div></section>:<TaskResources state={state} projectId={task.projectId} acceptState={setState}/>}</main>}createRoot(document.getElementById('root')).render(<App/>);`);
  await build({entryPoints:[fileURLToPath(entry)],bundle:true,format:"esm",platform:"browser",jsx:"automatic",outfile:fileURLToPath(new URL("preview.js",directory)),define:{"process.env.NODE_ENV":'"development"'},logLevel:"silent"});
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==="/fixture-state"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(state));return;}
      if(req.url?.startsWith("/api/task-attachments")){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
        const request=new Request(`http://127.0.0.1:4137${req.url}`,{method:req.method,headers:req.headers,...(req.method==="POST"?{body}: {})});
        const response=await (req.method==="POST"?api.POST:api.GET)(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.url==="/preview.js"){res.setHeader("Content-Type","text/javascript");res.end(await readFile(new URL("preview.js",directory)));return;}
      if(req.url==="/project.css"){res.setHeader("Content-Type","text/css");res.end(await readFile(new URL("../app/project-os.css",import.meta.url)));return;}
      if(req.url==="/tokens.css"){res.setHeader("Content-Type","text/css");res.end(`:root{--background:#fff;--foreground:#000;--primary:#722f37;--primary-foreground:#fff;--line:#e5e2e5;--muted-foreground:#656172;--brand-wine:#722f37;--wine-soft:#f7eef0;--brand-purple:#2a0d3a;}*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#faf9fb;color:#000;margin:0}button,input{font:inherit}button{cursor:pointer}button:disabled{opacity:.5}a{color:#722f37}input{padding:.5rem;border:1px solid #ccc;border-radius:.4rem}button[data-slot=button]{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .8rem;border:1px solid #ddd;border-radius:999px;background:white}button[data-variant=default]{background:#722f37;color:white}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0008;z-index:50}[data-slot=dialog-content]{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:51;background:white;padding:24px;border-radius:12px;display:grid;gap:16px}[data-slot=dialog-content]>button:last-child{position:absolute;right:12px;top:12px}`);return;}
      res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista local · Recursos por tarea</title><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/project.css"></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
    }catch{res.writeHead(500);res.end("Preview unavailable");}
  });server.listen(4137,"127.0.0.1",()=>console.log("Task resources preview: http://127.0.0.1:4137"));
}else sql.close();
