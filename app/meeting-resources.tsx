"use client";
import { useRef, useState } from "react";
import { CalendarDays, Download, FileText, Plus, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MEETING_ACCEPT, driveVideoUrl } from "@/lib/meetings";
import { orderedProjectMeetings } from "@/lib/memory-answer";
import type { Workspace } from "@/lib/workspace-types";
import { MeetingAnalysisPanel } from "./meeting-analysis";

export function MeetingResources({state,projectId,acceptState}: {state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const [open,setOpen] = useState(false), [selected,setSelected] = useState<string|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const operation = useRef<string|null>(null), formRef = useRef<HTMLFormElement>(null);
  const meetings = orderedProjectMeetings(state,state.projects.find(p=>p.id===projectId)?.userId??"",projectId);
  const current = meetings.find(({item}) => item.id === selected);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setError("");
    const form = new FormData(event.currentTarget);
    try { form.set("driveUrl",driveVideoUrl(String(form.get("driveUrl") ?? ""))); } catch (failure) { setError((failure as Error).message); return; }
    operation.current ??= crypto.randomUUID(); form.set("requestId",operation.current); form.set("projectId",projectId); setBusy(true);
    try {
      const response = await fetch("/api/meetings",{method:"POST",body:form}), result = await response.json() as {error?:string;state?:Workspace;item?:Workspace["knowledge"][number]};
      if (!response.ok || !result.state) throw new Error(result.error || "No se pudo guardar la reunión.");
      const savedId=result.item?.id??operation.current;
      acceptState(result.state); operation.current = null; formRef.current?.reset(); setOpen(false); setSelected(savedId); toast.success("Reunión guardada. Analízala para obtener el resumen y proponer tareas.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo guardar la reunión."); }
    finally { setBusy(false); }
  };
  return <section className="panel meeting-panel" aria-label="Reuniones del proyecto">
    <div className="section-heading"><div><p>RECURSOS</p><h2>Reuniones</h2></div><Button size="sm" onClick={() => {setError("");setOpen(true);}}><Plus size={16}/> Nueva reunión</Button></div>
    <p className="daily-hint">Transcripción y notas juntas. El video permanece en Drive; aquí solo guardamos su enlace.</p>
    <p className="daily-hint">Para generar tareas: abre la reunión → Analizar y proponer tareas → Enviar a aprobaciones → Aprobar. Subir o indexar archivos no crea tareas automáticamente.</p>
    <div className="meeting-grid">{meetings.map(({item,meeting}) => <article className="meeting-card" key={item.id}>
      <div className="meeting-card-heading"><span className="meeting-icon"><CalendarDays size={21}/></span><div><h3>{item.title}</h3><small>{meeting?.date ?? "Ficha no disponible"} · {item.processingStatus === "indexed" ? "Indexada en GBrain" : "Originales guardados"}</small></div></div>
      <div className="meeting-file-list">{meeting?.files.map(file => <p key={file.role}><FileText size={16}/><span><strong>{file.role === "transcript" ? "Transcripción" : "Notas"}</strong>{file.name}</span></p>)}</div>
      <div className="meeting-actions"><Button variant="outline" size="sm" disabled={!meeting} onClick={() => setSelected(item.id)}>Abrir y analizar reunión</Button>{meeting?.driveUrl && <Button variant="outline" size="sm" asChild><a href={meeting.driveUrl} target="_blank" rel="noopener noreferrer"><Video size={15}/> Ver video en Drive</a></Button>}</div>
    </article>)}</div>
    {!meetings.length && <p className="meeting-empty">Todavía no hay reuniones. Agrega la primera con su transcripción.</p>}
    <Dialog open={open} onOpenChange={value => {if (!busy) setOpen(value);}}><DialogContent className="meeting-dialog"><DialogHeader><DialogTitle>Nueva reunión</DialogTitle><DialogDescription>Guarda los documentos y pega el enlace del video. No se descarga ni se copia desde Drive.</DialogDescription></DialogHeader>
      <form ref={formRef} className="core-form" onSubmit={save} onChange={() => {operation.current = null;}}>
        <label><span>Título</span><Input name="title" placeholder="Ej. Seguimiento del proyecto" maxLength={180} required disabled={busy}/></label>
        <label><span>Fecha de la reunión</span><Input name="date" type="date" defaultValue={new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())} required disabled={busy}/></label>
        <label><span>Enlace del video en Drive (opcional)</span><Input name="driveUrl" type="url" placeholder="https://drive.google.com/file/d/…/view" maxLength={2048} disabled={busy}/></label>
        <label><span>Transcripción completa</span><Input name="transcript" type="file" accept={MEETING_ACCEPT} required disabled={busy}/></label>
        <label><span>Notas de la reunión (opcional)</span><Input name="notes" type="file" accept={MEETING_ACCEPT} disabled={busy}/></label>
        <small className="daily-hint">TXT, Markdown, SRT o VTT: hasta 256 KiB por archivo. PDF con texto o Word .docx: hasta 10 MiB. Procesamiento: hasta 100 páginas por PDF y 512 KiB de texto por reunión. Los archivos originales se conservan.</small>
        <p className="daily-hint">Los documentos quedan guardados en este proyecto. El video conserva los permisos que tenga en Drive.</p>
        {error && <p className="core-form-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando documentos…" : "Guardar reunión"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Dialog open={!!current} onOpenChange={value => {if (!value) setSelected(null);}}><DialogContent className="meeting-dialog"><DialogHeader><DialogTitle>{current?.item.title ?? "Reunión"}</DialogTitle><DialogDescription>{current?.meeting?.date} · Documentos originales y video de referencia</DialogDescription></DialogHeader>
      <div className="meeting-detail-files">{current?.meeting?.files.map(file => <div key={file.role}><FileText size={22}/><div><strong>{file.role === "transcript" ? "Transcripción completa" : "Notas de la reunión"}</strong><p>{file.name}</p><small>{Math.ceil(file.size/1024)} KiB</small></div><Button variant="outline" size="sm" asChild><a href={`/api/meetings?id=${encodeURIComponent(current.item.id)}&role=${file.role}`} download><Download size={15}/> Descargar</a></Button></div>)}</div>
      {current?.meeting?.driveUrl && <Button asChild><a href={current.meeting.driveUrl} target="_blank" rel="noopener noreferrer"><Video size={17}/> Ver video en Drive</a></Button>}
      <p className="daily-hint">La búsqueda puede responder sobre la reunión más reciente sin indexarla. Para buscar otros temas en GBrain, pulsa Procesar en las fuentes. El enlace de Drive no se analiza.</p>
      {current?.meeting && <MeetingAnalysisPanel key={current.item.id} meetingId={current.item.id} fingerprint={current.meeting.fingerprint} projectId={projectId} state={state} acceptState={acceptState}/>}
    </DialogContent></Dialog>
  </section>;
}
