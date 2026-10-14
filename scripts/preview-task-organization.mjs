// Isolated browser QA. All records are synthetic; no env files, credentials or upstream APIs.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'outputs/task-organization-fixture');
await mkdir(out,{recursive:true});
await build({stdin:{contents:"export * from './core-commands'; export * from './workspace-types'; export * from './daily-engine'; export * from './project-operations'; export * from './task-merge'; export * from './task-match-commands'; export * from './daily-commands'; export * from './operations-commands';",resolveDir:join(root,'lib')},bundle:true,format:'esm',platform:'node',outfile:join(out,'fixture-api.mjs')});
const api=await import(pathToFileURL(join(out,'fixture-api.mjs')));
let state=api.emptyWorkspace(),counter=0;
const keys={projects:'projects',tasks:'tasks',project_operations:'operations',project_events:'events',task_dependencies:'dependencies',milestones:'milestones',project_financials:'financials',ai_suggestions:'suggestions',inbox_items:'inbox',calendar_blocks:'calendar'};
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const applyPlan=plan=>{
  for(const c of plan.changes){const key=keys[c.table],row=camel(c.row);state[key]=state[key].filter(r=>r.id!==row.id);if(c.kind!=='delete')state[key].push(row);}
  state=api.deriveWorkspaceState(state);return plan.id;
};
const apply=(action,payload,commandId=crypto.randomUUID())=>applyPlan((api.OPERATIONS_ACTIONS.has(action)?api.buildOperationsCommand:api.DAILY_ACTIONS.has(action)?api.buildDailyCommand:api.buildCoreCommand)(state,'synthetic-organization',action,payload,commandId,new Date().toISOString(),()=>`fixture-${++counter}`));
const today=api.bogotaDay(),day=n=>api.addDays(today,n);
const design=apply('create_project',{name:'Identidad de marca',shortCode:'MAR',description:'Nueva identidad, piezas y entrega final de la marca.',currentSummary:'La identidad está aprobada. Falta cerrar las piezas y preparar la entrega.',operationalStatus:'Activo',projectPlannedStart:day(-20),projectActualStart:day(-17),targetEndDate:day(10)});
const website=apply('create_project',{name:'Plataforma web',shortCode:'WEB',currentSummary:'La entrega necesita atención: hay tareas vencidas y una aprobación pendiente.',operationalStatus:'Activo',projectPlannedStart:day(-40),projectActualStart:day(-35),targetEndDate:day(-5)});
const content=apply('create_project',{name:'Contenido y lanzamiento',shortCode:'LAN',description:'Preparar el contenido del lanzamiento.',operationalStatus:'Por iniciar',projectPlannedStart:day(2),targetEndDate:day(21)});
const noDates=apply('create_project',{name:'Investigación',shortCode:'INV',operationalStatus:'Activo'});
apply('create_project',{name:'Proyecto en pausa',operationalStatus:'Pausado'});
const task=(projectId,title,deadline,status='pending',extra={})=>apply('create_task',{projectId,title,deadline:deadline===null?null:day(deadline),status,description:'Registro sintético para comprobar el resumen de Hoy. No es una tarea real.',priority:4,urgency:4,estimatedMinutes:45,...extra});
task(design,'Ajustar las piezas para redes',-3);task(design,'Entregar los archivos editables',0);task(design,'Preparar la guía de uso',4);task(design,'Revisar referencias de aplicación',null,'pending',{tentativeDeliveryDate:day(-2)});task(design,'Aprobar la identidad',-10,'completed');task(design,'Diseñar una versión adicional',null,'cancelled');
task(website,'Corregir la navegación móvil',-7,'in_progress');task(website,'Confirmar los textos con el cliente',-2,'blocked',{blockingReason:'Pendiente de aprobación del cliente'});task(website,'Validar el formulario de contacto',1);task(website,'Preparar la entrega técnica',5);task(content,'Escribir el guion de lanzamiento',3);task(content,'Definir el calendario editorial',7);task(noDates,'Organizar hallazgos de investigación',null);
const operations=api.operationsFor(state,design);operations.people=[{id:'fixture-self',name:'Yo',email:'',role:'Dirección',active:true,isSelf:true},{id:'fixture-colleague',name:'Diego',email:'',role:'Diseño',active:true,isSelf:false}];operations.taskDetails[state.tasks.find(t=>t.title==='Preparar la guía de uso').id]={primaryId:'fixture-colleague',collaboratorIds:[],plannedStart:null,plannedEnd:null,columnId:null};state.operations=state.operations.map(r=>r.projectId===design?{...r,data:JSON.stringify(operations)}:r);
const first=task(design,'Coordinar reunión con diseñadora gráfica y fotógrafo',4),second=task(design,'Organizar reunión para definir manual de marca y fotografía del catálogo',4),materials=task(design,'Enviar materiales gráficos y contexto',3),catalog=task(design,'Definir catálogo visual y parámetros de personalización',6);
const parent=task(design,'Preparar lanzamiento',8);task(design,'Revisar textos de lanzamiento',5,'pending',{parentTaskId:parent,plannedStart:day(1),plannedEnd:day(2)});task(design,'Entregar imágenes de lanzamiento',6,'pending',{parentTaskId:parent,plannedStart:day(2),plannedEnd:day(4)});
const runs=new Map();
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectOS} from './app/project-os'; createRoot(document.getElementById('root')).render(<ProjectOS ownerEmail="demo@fixture.test" />);`,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',outfile:join(out,'app.js'),define:{'process.env.NODE_ENV':'"development"'},alias:{'@':root}});
// Build current styles directly so preview does not require a prior Next build.
const { default: postcss } = await import('postcss'), { default: tailwind } = await import('@tailwindcss/postcss');
const result = await postcss([tailwind()]).process(await readFile(join(root,'app/globals.css'),'utf8'), { from: join(root,'app/globals.css') });
const css=result.css+'\n'+await readFile(join(root,'app/project-os.css'),'utf8')+'\n'+await readFile(join(root,'app/notebook.css'),'utf8');
await writeFile(join(out,'style.css'),css);
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}
  if(req.url==='/api/tasks/merge'&&req.method==='POST') {
    let body='';for await(const chunk of req)body+=chunk;res.setHeader('Content-Type','application/json');
    try {const r=JSON.parse(body);if(r.action==='generate') {
      const selected=api.mergeTasks(state,'synthetic-organization',r.projectId,r.ids), meetings=selected.filter(t=>/reunión/.test(t.title));
      const buckets=meetings.length>1?[meetings,...selected.filter(t=>!meetings.includes(t)).map(t=>[t])]:selected.map(t=>[t]);
      const groups=buckets.map(rows=>({taskIds:rows.map(t=>t.id),title:rows.length>1?'Coordinar reunión de diseño y fotografía':rows[0].title,description:'Acción concreta con seguimiento propio.',criteria:'Resultado revisado y confirmado.',primaryId:null,deadline:rows[0].deadline,estimatedMinutes:30,status:'pending'}));
      const draft={mode:groups.length>1?'parent':'single',title:'Cerrar diseño web, manual de marca y catálogo',description:'Consolidar convocatorias y conservar las acciones distintas.',primaryId:null,deadline:null,reason:'Las convocatorias se refieren a una reunión. Enviar materiales y definir catálogo son acciones diferentes.',conflicts:['Comprueba responsables, fechas y alcance antes de aprobar.'],groups};
      runs.set(r.requestId,{ids:r.ids,snapshot:api.mergeSnapshot(state,r.projectId),draft});res.end(JSON.stringify({draft,requestId:r.requestId}));
    } else {const saved=runs.get(r.requestId);const id=applyPlan(api.buildTaskMerge(state,'synthetic-organization',r.projectId,saved.ids,r.draft,saved.snapshot,'merge-'+r.requestId));res.end(JSON.stringify({id,state}));}}catch(e){res.statusCode=409;res.end(JSON.stringify({error:e.message}));}return;
  }
  if(req.url==='/api/action'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    try {const request=JSON.parse(body),id=apply(request.action,request.payload,request.commandId);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,state}));}
    catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}return;
  }
  if(req.url==='/app.js'||req.url==='/style.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(out,req.url.slice(1))));return;}
  if(req.url==='/'||req.url==='/login'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tareas · Vista de prueba</title><link rel="stylesheet" href="/style.css"></head><body><div style="position:fixed;bottom:76px;right:12px;z-index:1000;background:#2A0D3A;color:white;padding:7px 12px;border-radius:8px;font:11px sans-serif;pointer-events:none">VISTA DE PRUEBA · Datos sintéticos</div><div id="root"></div><script src="/app.js"></script></body></html>');return;}
  res.statusCode=404;res.end('Not found');
});
server.listen(3110,'127.0.0.1',()=>console.log('Task organization fixture preview: http://127.0.0.1:3110/ · synthetic data only · no upstream calls.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
