"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { Workspace } from "@/lib/workspace-types";
import { projectUpdateSignature, type ProjectUpdateSnapshot, type ProjectUpdateRecord, type UpdateClaim } from "@/lib/project-update";

type UpdateView={snapshot:ProjectUpdateSnapshot;revision:string;latest:ProjectUpdateRecord|null;stale:boolean;ai:{configured:boolean;enabled:boolean;used:number;limit:number}};
export function ProjectUpdatePanel({state,projectId,acceptState,onStatus}:{state:Workspace;projectId:string;acceptState:(state:Workspace)=>void;onStatus:(id:string,status:string)=>void}) {
  const meetings=useMemo(()=>state.knowledge.filter(k=>k.projectId===projectId && k.itemType==="meeting").sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)),[state.knowledge,projectId]);
  const [meetingId,setMeetingId]=useState(meetings[0]?.id??""),[view,setView]=useState<UpdateView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [confirm,setConfirm]=useState(false),[summary,setSummary]=useState(""),[nextStep,setNextStep]=useState("");
  const generation=useRef(0),signature=useMemo(()=>projectUpdateSignature(state,projectId,meetingId),[state,projectId,meetingId]);
  const project=state.projects.find(p=>p.id===projectId)!;
  const refresh=async()=>{
    const current=++generation.current,response=await fetch(`/api/projects/update?projectId=${encodeURIComponent(projectId)}&meetingId=${encodeURIComponent(meetingId)}`,{cache:"no-store"}),data=await response.json() as UpdateView & {error?:string};
    if(current!==generation.current)return;
    if(!response.ok)throw new Error(data.error||"No se pudo leer el proyecto.");setView(data);
  };
  useEffect(()=>{setView(null);setError("");void refresh().catch(e=>setError(e.message));return()=>{generation.current++;};},[signature]);
  const request=async(body:Record<string,unknown>)=>{
    const response=await fetch("/api/projects/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,meetingId,...body})}),data=await response.json() as {state:Workspace;error?:string};
    if(!response.ok)throw new Error(data.error||"No se pudo completar la actualización.");return data;
  };
  const generate=async()=>{
    if(busy)return;setBusy(true);setError("");
    try{await request({action:"generate",requestId:crypto.randomUUID()});await refresh();}
    catch(e){setError(e instanceof Error?e.message:"No se pudo generar la lectura.");await refresh().catch(()=>undefined);}
    finally{setBusy(false);}
  };
  const apply=async()=>{
    if(busy || !view?.latest)return;setBusy(true);setError("");
    try{const data=await request({action:"apply",runId:view.latest.id,summary,nextStep});acceptState(data.state);setConfirm(false);}
    catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el resumen.");}
    finally{setBusy(false);}
  };
  const latest=view?.latest,applied=!!latest && state.events.some(e=>e.id===`project-update-${latest.id}`);
  const claims=(title:string,rows:UpdateClaim[])=>rows.length>0 && <section><h3>{title}</h3>{rows.map((claim,index)=><div className="update-claim" key={index}><p>{claim.text}</p><small>Evidencia: {claim.sourceIds.map(id=>latest?.sources[id]??id).join(" · ")}</small></div>)}</section>;
  return <section className="panel project-update-panel" aria-label="Estado actualizado y siguiente acción">
    <div className="section-heading"><div><p>LECTURA DEL PROYECTO</p><h2>Estado actualizado y siguiente acción</h2></div><Button size="sm" variant="outline" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))} aria-label="Revisar cambios sin consumir IA"><RefreshCw size={15}/> Revisar cambios</Button></div>
    <div className="update-controls"><label>Reunión de referencia<select value={meetingId} disabled={busy} onChange={e=>{setMeetingId(e.target.value);setConfirm(false);}}><option value="">Estado general · sin reunión</option>{meetings.map(m=><option key={m.id} value={m.id}>{m.occurredAt.slice(0,10)} · {m.title}</option>)}</select></label><Button disabled={busy || !view?.ai.configured || !view.ai.enabled || (view.ai.used>=view.ai.limit && (!latest || view.stale))} onClick={()=>void generate()}><Sparkles size={16}/>{busy ? "Preparando…" : latest && !view?.stale ? "Ver lectura guardada" : "Generar actualización"}</Button></div>
    <p className="daily-hint">Solo al generar se envía el contexto a OpenAI y se busca memoria en GBrain. Una consulta compartida; no crea tareas ni cambia el proyecto. {view && `${view.ai.used}/${view.ai.limit} consultas de IA hoy.`}</p>
    {!view && !error && <p role="status" className="daily-hint">Leyendo cambios y prioridades…</p>}
    {view && <><div className="update-counts"><span>{view.snapshot.counts.open} tareas abiertas</span><span>{view.snapshot.counts.completed} completadas</span><span>{view.snapshot.counts.blocked} bloqueadas</span><span>{view.snapshot.counts.overdue} vencidas</span></div>
      {view.snapshot.meeting && <p className="daily-hint">Análisis de «{view.snapshot.meeting.title}»: {view.snapshot.meeting.status==="ready" ? "completo" : view.snapshot.meeting.status==="partial" ? `${view.snapshot.meeting.completedParts}/${view.snapshot.meeting.totalParts} fragmentos; aún incompleto` : "sin analizar"}. Los hallazgos por sí solos no son cambios aplicados.</p>}
      <div className="update-changes-grid"><section><h3>{meetingId ? "Qué cambió · confirmado desde esta reunión" : "Cambios recientes confirmados"}</h3>{view.snapshot.applied.length ? view.snapshot.applied.map(row=><div className="update-claim" key={row.id}><strong>{row.title}</strong><p>{row.description}</p></div>) : <p className="daily-hint">No hay cambios confirmados para esta referencia.</p>}</section><section><h3>Pendiente de decidir · no aplicado</h3>{view.snapshot.pending.length ? view.snapshot.pending.slice(0,5).map(row=><div className="update-claim" key={row.id}><strong>{row.title}</strong><p>{row.description}</p></div>) : <p className="daily-hint">No hay propuestas pendientes registradas para esta referencia.</p>}{view.snapshot.pending.length>5 && <details className="update-more"><summary>Ver {view.snapshot.pending.length-5} asuntos pendientes adicionales</summary>{view.snapshot.pending.slice(5).map(row=><div className="update-claim" key={row.id}><strong>{row.title}</strong><p>{row.description}</p></div>)}</details>}{view.snapshot.unreviewedCount>0 && <small className="daily-hint">{view.snapshot.unreviewedCount} hallazgos aún no enviados a Aprobaciones.</small>}</section></div>
      {view.snapshot.recent.length>0 && <details className="update-priorities"><summary>Otros cambios registrados desde la fecha de la reunión · {view.snapshot.recent.length} recientes</summary><p className="daily-hint">Incluye el mismo día. Estos cambios están en el historial, pero no se atribuyen a la reunión ni aseguran una hora posterior a ella.</p>{view.snapshot.recent.map(row=><div className="update-claim" key={row.id}><strong>{row.title}</strong><p>{row.description}</p></div>)}</details>}
      <details className="update-priorities"><summary>Prioridades actuales · reglas verificables</summary>{view.snapshot.candidates.length ? view.snapshot.candidates.map((task,index)=><p key={task.id}><strong>{index+1}. {task.title}</strong><small>{task.reason} · {task.minutes} min</small></p>) : <p className="daily-hint">No hay tareas elegibles: revisa bloqueos, aprobaciones o el estado operativo.</p>}</details>
    </>}
    {latest && <div className="update-ai-reading"><div className="compiled-head"><h3>Lectura de IA · recomendación</h3><small>{new Date(latest.createdAt).toLocaleString("es-CO",{timeZone:"America/Bogota"})}</small></div>
      {view?.stale && !applied && <p className="update-warning" role="status">Hay datos nuevos desde esta lectura. Genera una actualización antes de aplicarla.</p>}
      {applied && <p className="update-warning" role="status">Este resumen ya fue confirmado y quedó en el historial. Puedes generar otra lectura con el estado actual.</p>}
      <p className="update-summary">{latest.result.summary}</p><small className="ai-sources">Evidencia: {latest.result.summarySourceIds.map(id=>latest.sources[id]??id).join(" · ")}</small>
      {latest.coverage && latest.coverage.omitted>0 && <p className="update-warning">Lectura selectiva: {latest.coverage.included} registros incluidos y {latest.coverage.omitted} fuera del contexto por el límite de tamaño. Revisa también el historial completo.</p>}
      <p className="daily-hint">Memoria GBrain: {latest.memory.status==="connected" ? `${latest.memory.count} fuentes recuperadas (fragmentos, no toda la memoria)` : "no consultada; lectura de registros locales"}.</p>{latest.memory.warning && <p className="update-warning">{latest.memory.warning}</p>}
      {claims("Cambios interpretados por la IA",latest.result.changes)}{claims("Asuntos pendientes",latest.result.pending)}{claims("Riesgos · inferencias, no bloqueos aplicados",latest.result.risks)}
      <section className="update-next"><p className="eyebrow">SIGUIENTE ACCIÓN RECOMENDADA</p><h3>{latest.result.nextAction.title}</h3><p>{latest.result.nextAction.reason}</p><small>Evidencia: {latest.result.nextAction.sourceIds.map(id=>latest.sources[id]??id).join(" · ")}</small>
        {latest.result.nextAction.taskId && view?.snapshot.candidates.some(t=>t.id===latest.result.nextAction.taskId) && !view.stale && <Button size="sm" variant="outline" disabled={busy} onClick={()=>onStatus(latest.result.nextAction.taskId!,"in_progress")}><ArrowRight size={15}/> Empezar tarea existente</Button>}
      </section><Button variant="outline" disabled={busy || view?.stale || applied} onClick={()=>{setSummary(latest.result.summary);setNextStep(`${latest.result.nextAction.title}. ${latest.result.nextAction.reason}`);setConfirm(true);}}>Revisar y aplicar al resumen del proyecto</Button>
      <small className="daily-hint">La IA puede equivocarse. Guardar requiere tu confirmación y solo modifica el resumen y la siguiente acción; nunca estados, pagos ni fechas.</small>
    </div>}
    {error && <p className="core-form-error" role="alert">{error}</p>}
    <Dialog open={confirm} onOpenChange={value=>{if(!busy)setConfirm(value);}}><DialogContent className="meeting-dialog"><DialogHeader><DialogTitle>Confirmar actualización · {project.name}</DialogTitle><DialogDescription>Revisa y edita. Solo se guardan estos dos campos y un evento en el historial.</DialogDescription></DialogHeader><div className="core-form"><details><summary>Resumen y siguiente paso anteriores</summary><p>{project.currentSummary || "Sin resumen"}</p><p>{project.nextStepSummary || "Sin siguiente paso"}</p></details><label>Nuevo resumen<Textarea value={summary} maxLength={2000} disabled={busy} onChange={e=>setSummary(e.target.value)}/></label><label>Siguiente acción<Textarea value={nextStep} maxLength={2000} disabled={busy} onChange={e=>setNextStep(e.target.value)}/></label>{error && <p className="core-form-error" role="alert">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Cancelar</Button><Button disabled={busy || view?.stale || !summary.trim() || !nextStep.trim()} onClick={()=>void apply()}>{busy ? "Guardando…" : "Confirmar y guardar"}</Button></DialogFooter></div></DialogContent></Dialog>
  </section>;
}
