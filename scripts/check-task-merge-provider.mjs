// One live API request with synthetic tasks only; no workspace records are read.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
const env={};
for(const file of [".env",".env.local"]){try{for(const line of (await readFile(new URL(`../${file}`,import.meta.url),"utf8")).split(/\r?\n/)){const m=line.match(/^\s*(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(["'])(.*)\1$/,"$2");}}catch(e){if(e.code!=="ENOENT")throw e;}}
for(const name of ["OPENAI_API_KEY","OPENAI_MODEL"])if(process.env[name])env[name]=process.env[name];
assert.ok(env.OPENAI_API_KEY,"Existing key required; no key values are printed.");
const state={projects:[{id:"fixture-project",userId:"fixture-owner",name:"Diseño ficticio"}],tasks:[],operations:[{id:"fixture-project",projectId:"fixture-project",data:JSON.stringify({version:1,revision:0,people:[{id:"fixture-person",name:"Diego",role:"Coordinación",active:true}],agreements:[],taskDetails:{},columns:[],comments:[],deliveries:[]})}]};
for(const [id,title,description]of [
  ["meeting-a","Coordinar reunión con diseñadora y fotógrafo","Una reunión para cerrar diseño web, manual de marca y catálogo. Diego convoca a ambas personas."],
  ["meeting-b","Organizar reunión para manual de marca y fotografía del catálogo","Es la misma reunión de coordinación de diseño web y marca, con las mismas personas. Diego convoca."],
  ["materials","Enviar materiales gráficos y contexto","Acción previa: enviar el brief y los materiales existentes a la diseñadora y al fotógrafo."],
  ["catalog","Definir catálogo visual y parámetros de personalización","Acción distinta: aprobar el catálogo visual y los parámetros con las personas del equipo."],
])state.tasks.push({id,userId:"fixture-owner",projectId:"fixture-project",title,description,parentTaskId:null,sourceType:"manual",status:"pending",deadline:null,estimatedMinutes:30});
const compiled=await build({stdin:{contents:'export * from "../lib/task-merge-provider";export * from "../lib/task-merge";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,plugins:[{name:"test-env",setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:"env",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const env=globalThis.fixtureEnv;",loader:"js"}));}}]});
let calls=0;const context=vm.createContext({crypto,Date,Intl,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Response,fixtureEnv:env,async fetch(...args){calls++;return fetch(...args);}});
const module=new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();
try {
  const output=await module.namespace.requestTaskMerge(JSON.stringify({project:"Proyecto ficticio",people:[{id:"fixture-person",name:"Diego"}],tasks:state.tasks.map(t=>({...t,assignment:{primaryId:"fixture-person",collaboratorIds:[]}})),dependencies:[]}));
  const draft=module.namespace.validateMergeDraft(output.result,state.tasks,state);
  assert.equal(draft.mode,"parent");assert.equal(draft.groups.length,3);
  assert.ok(draft.groups.some(g=>g.taskIds.length===2&&g.taskIds.includes("meeting-a")&&g.taskIds.includes("meeting-b")));
  assert.ok(draft.groups.some(g=>g.taskIds.length===1&&g.taskIds[0]==="materials"));
  assert.ok(draft.groups.some(g=>g.taskIds.length===1&&g.taskIds[0]==="catalog"));
  console.log(JSON.stringify({passed:true,mode:draft.mode,subtasks:draft.groups.length,duplicateMeetingConsolidated:true,distinctActionsPreserved:true,liveApiCalls:calls,noProjectDataSent:true}));
}catch(e){console.log(JSON.stringify({passed:false,errorName:e.name,status:e.status,message:e.message,liveApiCalls:calls,noProjectDataSent:true}));process.exitCode=1;}
