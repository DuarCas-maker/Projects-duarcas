"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SourceCoverage, SourceEntry } from "@/lib/project-sources";
import type { Workspace } from "@/lib/workspace-types";

const kindLabels:Record<string,string>={project_context:"Archivo de contexto",meeting:"Reunión",repository:"Repositorio",task_resource:"Recurso de tarea",task_attachment:"Adjunto de tarea",note:"Nota",document:"Documento",decision:"Decisión",link:"Enlace"};
const statusLabels={ready:"Disponible para IA",pending:"Pendiente de preparar",unavailable:"No se pudo leer",excluded:"Pendiente de incluir"};
const modeLabels={none:"Sin contenido en esta respuesta",summary:"Solo ficha o resumen",full:"Texto completo incluido",excerpt:"Extractos incluidos"};
function SourceRow({entry,snapshot=false}:{entry:SourceEntry;snapshot?:boolean}) {
  const [text,setText]=useState<string|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const read=async()=>{setBusy(true);setError("");try{const response=await fetch(`/api/search?sourceId=${encodeURIComponent(entry.id)}`,{cache:"no-store"}),data=await response.json() as {error?:string;version:string;content:string};if(!response.ok)throw new Error(data.error||"No se pudo leer la fuente.");if(data.version!==entry.version)throw new Error("La fuente cambió. Actualiza el catálogo para leer su versión vigente.");setText(data.content);}catch(e){setError(e instanceof Error?e.message:"No se pudo leer la fuente.");}finally{setBusy(false);}};
  return <li className="project-source-row"><div><strong>{entry.title}</strong><small>{kindLabels[entry.kind]??entry.kind} · {statusLabels[entry.status]}{snapshot?` · ${modeLabels[entry.mode]}`:""}</small>{!entry.sha&&<small>Versión {entry.version.slice(0,8)}</small>}{entry.date&&<small>Fecha de referencia: {entry.date.slice(0,10)}</small>}{entry.sha&&<small>Commit {entry.sha.slice(0,7)} · copia guardada{entry.syncedAt?` · sincronizada ${new Date(entry.syncedAt).toLocaleString("es-CO")}`:""}</small>}{entry.reason&&<p>{entry.reason}</p>}</div>
    {entry.text&&<details><summary>Ver texto incluido en esta respuesta</summary><pre>{entry.text}</pre></details>}
    {!snapshot&&entry.status==="ready"&&<details onToggle={e=>{if(e.currentTarget.open&&text===null&&!busy)void read();}}><summary>Leer texto preparado</summary>{busy?<p role="status">Leyendo…</p>:text!==null?<pre>{text}</pre>:null}{error&&<p role="alert">{error}</p>}</details>}
  </li>;
}
export function SourceCoverageView({coverage}:{coverage:SourceCoverage}) {
  return <details className="source-coverage"><summary>Ver fuentes consultadas · {coverage.used}/{coverage.total} con contenido o ficha</summary><p>Consulta del {new Date(coverage.generatedAt).toLocaleString("es-CO")} · {coverage.ready} disponibles · {coverage.pending} pendientes · {coverage.unavailable} no legibles · {coverage.excluded} sin incluir.</p><p>Disponible significa preparado para buscar. Cada fuente indica si esta respuesta recibió texto completo, extractos, solo su ficha o ningún contenido.</p>{!!coverage.omittedRecords&&<p>{coverage.omittedRecords} registros quedaron fuera por el límite de tamaño.</p>}{coverage.baseline?<p>Comparación de fuentes desde {new Date(coverage.baseline).toLocaleString("es-CO")}.</p>:<p>Primera lectura con inventario: todavía no hay una consulta anterior para comparar eliminaciones.</p>}{!!coverage.changes.length&&<ul>{coverage.changes.map(change=><li key={`${change.kind}:${change.id}`}>{change.kind==="added"?"Agregada":change.kind==="updated"?"Actualizada":"Eliminada o sustituida"}: {change.title}</li>)}</ul>}<ul className="project-source-list">{coverage.entries.map(entry=><SourceRow key={entry.id} entry={entry} snapshot/>)}</ul></details>;
}
export function ProjectSources({state,projectId,refreshKey=0,onPrepared}:{state:Workspace;projectId?:string;refreshKey?:number;onPrepared?:()=>void}) {
  const [coverage,setCoverage]=useState<SourceCoverage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[projectId]);
  const signature=JSON.stringify({knowledge:state.knowledge.filter(k=>!projectId||k.projectId===projectId),repositories:state.repositories.filter(r=>!projectId||r.projectId===projectId)});
  const url=`/api/project-sources${projectId?`?projectId=${encodeURIComponent(projectId)}`:""}`;
  useEffect(()=>{let cancelled=false;setCoverage(null);setError("");void fetch(url,{cache:"no-store"}).then(async response=>{const data=await response.json() as SourceCoverage & {error?:string};if(!response.ok)throw new Error(data.error);if(!cancelled)setCoverage(data);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[signature,url,refreshKey]);
  const prepare=async()=>{
    if(busy)return;setBusy(true);setError("");
    const activeGeneration=generation.current;
    try {
      // Process successive bounded batches; stop on transient failure instead
      // of looping indefinitely. No model calls or GBrain writes are involved.
      let previousPending=Infinity;
      for(let batch=0;batch<100;batch++) {
        const response=await fetch("/api/project-sources",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,retry:batch===0})}),data=await response.json() as {error?:string;coverage:SourceCoverage;prepared:number};
        if(generation.current!==activeGeneration)return;
        if(!response.ok)throw new Error(data.error||"No se pudieron preparar las fuentes.");
        const next=data.coverage as SourceCoverage;setCoverage(next);
        const remaining=next.entries.filter(e=>e.status==="pending"&&!e.id.startsWith("repository:")).length;
        if(!remaining||!data.prepared||remaining>=previousPending)break;
        previousPending=remaining;
      }
    }catch(e){if(generation.current===activeGeneration)setError(e instanceof Error?e.message:"No se pudieron preparar las fuentes.");}finally{if(generation.current===activeGeneration){setBusy(false);onPrepared?.();}}
  };
  return <section className="project-sources-panel" aria-label="Fuentes de Inteligencia"><div className="section-heading"><div><p>CONTEXTO COMPARTIDO</p><h3>Fuentes de Inteligencia</h3></div><Button variant="outline" size="sm" disabled={busy||!coverage} onClick={()=>void prepare()}>{busy?"Preparando…":"Preparar y reintentar"}</Button></div><p>Los archivos de contexto, reuniones, notas y recursos incluidos alimentan la IA de este proyecto. No necesitas duplicarlos en Memoria. Los repositorios usan su última copia sincronizada.</p>{coverage?<details><summary>{coverage.total} fuentes · {coverage.ready} disponibles · {coverage.pending} pendientes · {coverage.unavailable} no legibles · {coverage.excluded} sin incluir</summary><ul className="project-source-list">{coverage.entries.map(entry=><SourceRow key={`${entry.id}:${entry.version}`} entry={entry}/>)}</ul>{!coverage.total&&<p>Añade documentos o reuniones desde Contexto.</p>}</details>:!error&&<p role="status">Leyendo catálogo…</p>}{busy&&<p role="status">Preparando originales para búsqueda. No consume consultas de IA.</p>}{error&&<p className="core-form-error" role="alert">{error}</p>}</section>;
}
