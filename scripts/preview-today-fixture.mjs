// Isolated browser QA. All records are synthetic; no env files, credentials or upstream APIs.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'outputs/today-fixture');
await mkdir(out,{recursive:true});
await build({stdin:{contents:"export * from './core-commands'; export * from './workspace-types'; export * from './daily-engine'; export * from './project-operations';",resolveDir:join(root,'lib')},bundle:true,format:'esm',platform:'node',outfile:join(out,'fixture-api.mjs')});
const api=await import(pathToFileURL(join(out,'fixture-api.mjs')));
let state=api.emptyWorkspace(),counter=0;
const keys={projects:'projects',tasks:'tasks',project_operations:'operations',project_events:'events',task_dependencies:'dependencies',milestones:'milestones',project_financials:'financials'};
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const apply=(action,payload,commandId=crypto.randomUUID())=>{
  const plan=api.buildCoreCommand(state,'synthetic-today',action,payload,commandId,new Date().toISOString(),()=>`fixture-${++counter}`);
  for(const c of plan.changes){const key=keys[c.table],row=camel(c.row);state[key]=state[key].filter(r=>r.id!==row.id);if(c.kind!=='delete')state[key].push(row);}
  state=api.deriveWorkspaceState(state);return plan.id;
};
const today=api.bogotaDay(),day=n=>api.addDays(today,n);
const design=apply('create_project',{name:'Identidad de marca',shortCode:'MAR',description:'Nueva identidad, piezas y entrega final de la marca.',currentSummary:'La identidad está aprobada. Falta cerrar las piezas y preparar la entrega.',operationalStatus:'Activo',projectPlannedStart:day(-20),projectActualStart:day(-17),targetEndDate:day(10)});
const website=apply('create_project',{name:'Plataforma web',shortCode:'WEB',currentSummary:'La entrega necesita atención: hay tareas vencidas y una aprobación pendiente.',operationalStatus:'Activo',projectPlannedStart:day(-40),projectActualStart:day(-35),targetEndDate:day(-5)});
const content=apply('create_project',{name:'Contenido y lanzamiento',shortCode:'LAN',description:'Preparar el contenido del lanzamiento.',operationalStatus:'Por iniciar',projectPlannedStart:day(2),targetEndDate:day(21)});
const noDates=apply('create_project',{name:'Investigación',shortCode:'INV',operationalStatus:'Activo'});
apply('create_project',{name:'Proyecto en pausa',operationalStatus:'Pausado'});
const task=(projectId,title,deadline,status='pending',extra={})=>apply('create_task',{projectId,title,deadline:deadline===null?null:day(deadline),status,description:'Registro sintético para comprobar el resumen de Hoy. No es una tarea real.',priority:4,urgency:4,estimatedMinutes:45,...extra});
task(design,'Ajustar las piezas para redes',-3);task(design,'Entregar los archivos editables',0);task(design,'Preparar la guía de uso',4);task(design,'Revisar referencias de aplicación',null,'pending',{tentativeDeliveryDate:day(-2)});task(design,'Aprobar la identidad',-10,'completed');task(design,'Diseñar una versión adicional',null,'cancelled');
task(website,'Corregir la navegación móvil',-7,'in_progress');task(website,'Confirmar los textos con el cliente',-2,'blocked',{blockingReason:'Pendiente de aprobación del cliente'});task(website,'Validar el formulario de contacto',1);task(website,'Preparar la entrega técnica',5);task(content,'Escribir el guion de lanzamiento',3);task(content,'Definir el calendario editorial',7);task(noDates,'Organizar hallazgos de investigación',null);
const operations=api.operationsFor(state,design);operations.people=[{id:'fixture-self',name:'Yo',email:'',role:'Dirección',active:true,isSelf:true},{id:'fixture-colleague',name:'Ana',email:'',role:'Diseño',active:true,isSelf:false}];operations.taskDetails[state.tasks.find(t=>t.title==='Preparar la guía de uso').id]={primaryId:'fixture-colleague',collaboratorIds:[],plannedStart:null,plannedEnd:null,columnId:null};state.operations=state.operations.map(r=>r.projectId===design?{...r,data:JSON.stringify(operations)}:r);
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectOS} from './app/project-os'; createRoot(document.getElementById('root')).render(<ProjectOS ownerEmail="demo@fixture.test" />);`,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',outfile:join(out,'app.js'),define:{'process.env.NODE_ENV':'"development"'},alias:{'@':root}});
// Build current styles directly so preview does not require a prior Next build.
const { default: postcss } = await import('postcss'), { default: tailwind } = await import('@tailwindcss/postcss');
const result = await postcss([tailwind()]).process(await readFile(join(root,'app/globals.css'),'utf8'), { from: join(root,'app/globals.css') });
const css=result.css+'\n'+await readFile(join(root,'app/project-os.css'),'utf8')+'\n'+await readFile(join(root,'app/notebook.css'),'utf8');
await writeFile(join(out,'style.css'),css);
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}
  if(req.url==='/api/action'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    try {const request=JSON.parse(body),id=apply(request.action,request.payload,request.commandId);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,state}));}
    catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}return;
  }
  if(req.url==='/app.js'||req.url==='/style.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(out,req.url.slice(1))));return;}
  if(req.url==='/'||req.url==='/login'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hoy · Vista de prueba</title><link rel="stylesheet" href="/style.css"></head><body><div style="position:fixed;bottom:76px;right:12px;z-index:1000;background:#2A0D3A;color:white;padding:7px 12px;border-radius:8px;font:11px sans-serif;pointer-events:none">VISTA DE PRUEBA · Datos sintéticos</div><div id="root"></div><script src="/app.js"></script></body></html>');return;}
  res.statusCode=404;res.end('Not found');
});
server.listen(3101,'127.0.0.1',()=>console.log('Today fixture preview: http://127.0.0.1:3101/ · synthetic data only · no upstream calls.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
