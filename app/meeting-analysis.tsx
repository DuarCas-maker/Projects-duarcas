"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FINDING_LABELS, existingMeetingTask, meetingProposalId, type MeetingAnalysis } from "@/lib/meeting-analysis";
import type { Workspace } from "@/lib/workspace-types";
import type { MeetingRevision } from "@/lib/meeting-revision";
import { MeetingFindingCorrection } from "./meeting-finding-correction";

const empty:MeetingAnalysis={status:"not_started",completedParts:0,totalParts:0,findings:[],summaries:[]};
type AnalysisResponse={analysis:MeetingAnalysis;error?:string;ai:{configured:boolean;enabled:boolean;used:number;limit:number}};
type ProposalResponse={state:Workspace;error?:string};
export function MeetingAnalysisPanel({meetingId,fingerprint,state,projectId,acceptState,resourceKind="meeting"}:{resourceKind?:"meeting"|"project_context";meetingId:string;fingerprint:string;state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const context = resourceKind === "project_context";
  const [analysis,setAnalysis]=useState(empty),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[sending,setSending]=useState(""),[error,setError]=useState("");
  const [proposalIds,setProposalIds]=useState<Record<string,string>>({}),[enabled,setEnabled]=useState(false),[usage,setUsage]=useState(""),[pausing,setPausing]=useState(false);
  const stop=useRef(false),alive=useRef(true);
  const [drafts,setDrafts]=useState<Record<string,MeetingRevision>>({}),[draftsLoading,setDraftsLoading]=useState(true);
  useEffect(()=>{if(analysis.status!=="ready")return;const controller=new AbortController();setDraftsLoading(true);fetch(`/api/meetings/revise?id=${encodeURIComponent(meetingId)}`,{signal:controller.signal}).then(async response=>{const result=await response.json() as {drafts:MeetingRevision[];error?:string};if(!response.ok)throw new Error(result.error||"No se pudieron cargar las correcciones guardadas.");setDrafts(Object.fromEntries(result.drafts.map(draft=>[draft.baseFindingId,draft])));}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);}).finally(()=>{if(!controller.signal.aborted)setDraftsLoading(false);});return()=>controller.abort();},[analysis.status,meetingId,fingerprint]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();fetch(`/api/meetings/analyze?id=${encodeURIComponent(meetingId)}`,{signal:controller.signal}).then(async response=>{const result=await response.json() as AnalysisResponse;if(!response.ok) throw new Error(result.error||"No se pudo cargar el análisis.");setAnalysis(result.analysis);setEnabled(result.ai.configured&&result.ai.enabled);setUsage(`${result.ai.used}/${result.ai.limit} consultas compartidas hoy`);}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>{alive.current=false;stop.current=true;controller.abort();};},[meetingId]);
  useEffect(()=>{let active=true;Promise.all(analysis.findings.map(async finding=>[finding.id,await meetingProposalId(meetingId,fingerprint,finding)] as const)).then(entries=>{if(active)setProposalIds(Object.fromEntries(entries));});return()=>{active=false;};},[analysis,meetingId,fingerprint]);
  const analyze=async()=>{
    if(busy) return;setBusy(true);setPausing(false);setError("");stop.current=false;
    try {
      while(alive.current&&!stop.current) {
        const response=await fetch("/api/meetings/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:meetingId,action:"analyze",requestId:crypto.randomUUID()})});
        const result=await response.json() as AnalysisResponse;if(!response.ok) throw new Error(result.error||"No se pudo analizar este fragmento.");
        if(!alive.current) return;setAnalysis(result.analysis);
        if(result.analysis.status==="ready"||stop.current) break;
        // Only a user's manual start continues; each part uses the shared quota.
        for(let second=0;second<21&&!stop.current&&alive.current;second++) await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:"No se pudo analizar la reunión.");}
    finally{if(alive.current){setBusy(false);setPausing(false);fetch(`/api/meetings/analyze?id=${encodeURIComponent(meetingId)}`).then(response=>response.json() as Promise<AnalysisResponse>).then(result=>{if(alive.current&&result.ai)setUsage(`${result.ai.used}/${result.ai.limit} consultas compartidas hoy`);}).catch(()=>undefined);}}
  };
  const propose=async(findingId:string)=>{
    if(sending) return;setSending(findingId);setError("");
    try {const response=await fetch("/api/meetings/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:meetingId,action:"propose",findingId})}),result=await response.json() as ProposalResponse;if(!response.ok) throw new Error(result.error||"No se pudo guardar la propuesta.");acceptState(result.state);}
    catch(failure){setError(failure instanceof Error?failure.message:"No se pudo enviar la propuesta.");}finally{setSending("");}
  };
  return <section className="meeting-analysis" aria-label={context?"Análisis del contexto":"Análisis de la reunión"}><div className="meeting-analysis-heading"><div><h3>{context?"Análisis del contexto":"Análisis de la reunión"}</h3><p>{loading?"Cargando análisis guardado…":analysis.status==="ready"?`Lectura completa · ${analysis.completedParts} fragmentos revisados`:analysis.completedParts?`${analysis.completedParts}/${analysis.totalParts} fragmentos guardados`:context?"Documento completo: objetivos, alcance, requisitos y entregables.":"Transcripción completa y notas. No se analiza el video."}</p></div>{busy?<Button size="sm" variant="outline" disabled={pausing} onClick={()=>{stop.current=true;setPausing(true);}}><Pause size={15}/>Pausar</Button>:analysis.status!=="ready"&&<Button size="sm" disabled={loading||!enabled} onClick={()=>void analyze()}><Sparkles size={15}/>{analysis.completedParts?"Continuar análisis":"Analizar y proponer tareas"}</Button>}</div>
    <p className="daily-hint">{context?"El contexto se transforma en un resumen y propuestas de tareas con citas del documento. Revisa los hallazgos, envíalos a Aprobaciones y aprueba las tareas que quieras crear.":"Las reuniones también generan propuestas de tareas desde sus transcripciones y notas; no necesitas subirlas otra vez a Memoria. Analiza, envía los hallazgos a Aprobaciones y aprueba las tareas que quieras crear."}</p>
    <p className="daily-hint">El texto se envía a OpenAI solo al iniciar. Cada fragmento consume una consulta de IA. {usage}. Puedes pausar y continuar sin releer las partes guardadas. Nada cambia en el proyecto sin aprobación.</p>
    {!loading&&!enabled&&analysis.status!=="ready"&&<p className="core-form-error">La IA no está habilitada en este servidor.</p>}
    {analysis.totalParts>0&&analysis.status!=="ready"&&<Progress aria-label="Avance del análisis" value={100*analysis.completedParts/analysis.totalParts}/>}
    {busy&&<p role="status">{pausing?"Terminando el fragmento actual…":"Analizando o esperando el siguiente fragmento…"}</p>}
    {error&&<p role="alert" className="core-form-error">{error}</p>}
    {analysis.status==="ready"&&<><details><summary>Resumen de los fragmentos</summary>{analysis.summaries.map((summary,index)=><p key={index}><strong>Fragmento {index+1}:</strong> {summary}</p>)}</details><p className="daily-hint">Hallazgos de IA por confirmar, no hechos verificados por una persona. Las citas sí coinciden con los documentos. Una aprobación de tarea crea una tarea; otros hallazgos se registran en el historial, sin modificar fechas ni bloqueos.</p>
      <div className="meeting-findings">{analysis.findings.map(finding=>{const proposal=state.suggestions.find(item=>item.id===proposalIds[finding.id]),duplicate=finding.kind==="task"&&existingMeetingTask(state,projectId,finding.title);return <article key={finding.id}><div className="meeting-finding-type">{FINDING_LABELS[finding.kind]} · fragmento {finding.part+1}</div><h4>{finding.title}</h4><p>{finding.description}</p>{finding.date&&<p>Fecha propuesta: {finding.date}</p>}<blockquote>{finding.quote}</blockquote><small>Confianza estimada: {finding.confidence}% · debe revisarse</small><div>{proposal?<p className="daily-hint">{proposal.status==="approved"?"Aprobada":proposal.status==="rejected"?"Rechazada":"Pendiente en Aprobaciones"}</p>:duplicate?<p className="daily-hint">Ya existe una tarea similar: {duplicate.title}</p>:!drafts[finding.id]&&<Button size="sm" variant="outline" disabled={draftsLoading||!!sending||!proposalIds[finding.id]} onClick={()=>void propose(finding.id)}>{sending===finding.id?"Guardando…":"Enviar a aprobaciones"}</Button>}</div><MeetingFindingCorrection meetingId={meetingId} finding={finding} draft={drafts[finding.id]} proposal={proposal} state={state} projectId={projectId} enabled={enabled} loading={draftsLoading||!!sending||!proposalIds[finding.id]} onDraft={draft=>setDrafts(previous=>({...previous,[finding.id]:draft}))} acceptState={acceptState} onUsage={(used,limit)=>setUsage(`${used}/${limit} consultas compartidas hoy`)}/></article>;})}</div>{!analysis.findings.length&&<p>No se detectaron acciones concretas en este recurso. Los documentos se conservan completos.</p>}</>}
  </section>;
}
