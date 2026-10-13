"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FINDING_LABELS, existingMeetingTask, type MeetingFinding } from "@/lib/meeting-analysis";
import type { MeetingRevision } from "@/lib/meeting-revision";
import type { Workspace } from "@/lib/workspace-types";

export function MeetingFindingCorrection({meetingId,finding,draft,proposal,state,projectId,enabled,loading,onDraft,acceptState,onUsage}:{meetingId:string;finding:MeetingFinding;draft?:MeetingRevision;proposal?:Workspace["suggestions"][number];state:Workspace;projectId:string;enabled:boolean;loading:boolean;onDraft:(draft:MeetingRevision)=>void;acceptState:(state:Workspace)=>void;onUsage:(used:number,limit:number)=>void}) {
  const [open,setOpen]=useState(false),[instruction,setInstruction]=useState(""),[busy,setBusy]=useState(""),[error,setError]=useState("");
  useEffect(()=>{if(draft)setOpen(true);},[draft?.id]);
  const resolved=!!proposal&&proposal.status!=="pending";
  let sent=false;try{sent=!!draft&&JSON.parse(proposal?.payload??"{}").revision?.id===draft.id;}catch{}
  const duplicate=draft?.finding.kind==="task"&&existingMeetingTask(state,projectId,draft.finding.title);
  async function act(action:"revise"|"propose") {
    if(busy)return;setBusy(action);setError("");
    try {
      const response=await fetch("/api/meetings/revise",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:meetingId,findingId:finding.id,action,...(action==="revise"?{instruction,requestId:crypto.randomUUID(),previousRevisionId:draft?.id}:{revisionId:draft?.id})})});
      const result=await response.json() as {error?:string;draft?:MeetingRevision;state?:Workspace};
      if(!response.ok)throw new Error(result.error||"No se pudo completar la corrección.");
      if(result.draft){onDraft(result.draft);setInstruction("");}
      if(result.state)acceptState(result.state);
      if(action==="revise")fetch(`/api/meetings/revise?id=${encodeURIComponent(meetingId)}`).then(response=>response.json() as Promise<{ai?:{used:number;limit:number}}>).then(result=>{if(result.ai)onUsage(result.ai.used,result.ai.limit);}).catch(()=>undefined);
    }catch(failure){setError(failure instanceof Error?failure.message:"No se pudo corregir la propuesta.");}finally{setBusy("");}
  }
  return <div className="meeting-correction">
    {!resolved&&<Button size="sm" variant="outline" disabled={loading||!!busy} aria-expanded={open} onClick={()=>setOpen(!open)}><Sparkles size={15}/>{open?"Ocultar corrección":"Corregir con un prompt"}</Button>}
    {open&&<div className="meeting-correction-body">
      {!resolved&&<form onSubmit={event=>{event.preventDefault();void act("revise");}}><label htmlFor={`correction-${finding.id}`}>¿Qué quieres corregir?</label><Textarea id={`correction-${finding.id}`} value={instruction} onChange={event=>setInstruction(event.target.value)} maxLength={1200} disabled={!!busy} placeholder="Ej.: conviértelo en una tarea para entregar el primer avance el 20 de octubre de 2026 y deja el alcance más concreto."/><p className="daily-hint">Se enviarán a OpenAI tu instrucción y este hallazgo con su cita. Cada corrección consume una consulta de IA. Primero verás un borrador; no se aprueba ni se crea una tarea automáticamente.</p><Button size="sm" type="submit" disabled={!instruction.trim()||!enabled||!!busy||loading}><Sparkles size={15}/>{busy==="revise"?"Generando corrección…":draft?"Generar otra corrección":"Generar corrección"}</Button>{!enabled&&<p className="daily-hint">La IA no está habilitada en este servidor.</p>}</form>}
      {error&&<p role="alert" className="core-form-error">{error}</p>}
      {draft&&<div className="meeting-correction-preview" role="region" aria-label="Vista previa de la corrección"><span className="meeting-finding-type">{FINDING_LABELS[draft.finding.kind]} · borrador corregido</span><h5>{draft.finding.title}</h5><p>{draft.finding.description}</p><p>Fecha propuesta: {draft.finding.date??"Sin fecha"}</p>{draft.finding.kind==="task"&&<p>Prioridad: {draft.finding.priority}/5 · Urgencia: {draft.finding.urgency}/5 · Estimación: {draft.finding.estimatedMinutes} min</p>}<details><summary>Tu instrucción de corrección</summary><p>{draft.instruction}</p></details><p className="daily-hint">La cita original de arriba se conserva. Los cambios solicitados por ti no se presentan como hechos confirmados por el documento original.</p>{sent?<p role="status" className="meeting-correction-status">{resolved?"Corrección resuelta en Aprobaciones.":"Corrección enviada. Pendiente en Aprobaciones."}</p>:resolved?<p className="daily-hint">La propuesta ya se resolvió. Este borrador no la modifica.</p>:duplicate?<p className="daily-hint">Ya existe una tarea similar: {duplicate.title}. No se creará otra.</p>:<Button size="sm" disabled={!!busy||loading} onClick={()=>void act("propose")}>{busy==="propose"?"Enviando…":proposal?"Reemplazar pendiente con esta corrección":"Enviar corrección a aprobaciones"}</Button>}</div>}
    </div>}
  </div>;
}
