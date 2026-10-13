"use client";
import { useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PROJECT_CONTEXT_ACCEPT, readProjectContext } from "@/lib/meetings";
import type { Workspace } from "@/lib/workspace-types";
import { MeetingAnalysisPanel } from "./meeting-analysis";

export function ProjectContextResources({state,projectId,acceptState}:{state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const operation=useRef<string|null>(null),formRef=useRef<HTMLFormElement>(null);
  const resources=state.knowledge.filter(item=>item.projectId===projectId && ["project_context","document","note"].includes(item.itemType)).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  const current=resources.find(item=>item.id===selected),context=current&&readProjectContext(current);
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setError("");
    const form=new FormData(event.currentTarget);operation.current??=crypto.randomUUID();form.set("requestId",operation.current);form.set("projectId",projectId);setBusy(true);
    try {
      const response=await fetch("/api/project-contexts",{method:"POST",body:form}),result=await response.json() as {error?:string;state?:Workspace;item?:Workspace["knowledge"][number]};
      if(!response.ok||!result.state||!result.item)throw new Error(result.error||"No se pudo guardar el archivo de contexto.");
      acceptState(result.state);operation.current=null;formRef.current?.reset();setOpen(false);setSelected(result.item.id);toast.success("Contexto guardado. Analízalo para obtener un resumen y proponer tareas.");
    }catch(failure){setError(failure instanceof Error?failure.message:"No se pudo guardar el archivo de contexto.");}
    finally{setBusy(false);}
  }
  return <>
    <div className="context-resource-intro"><div><h3>Contexto y documentos del proyecto</h3><p className="daily-hint">Sube un brief, requisitos, un plan o documentación del proyecto. La IA analiza el contenido completo y lo transforma en un resumen y propuestas de tareas.</p></div><Button size="sm" onClick={()=>{setError("");setOpen(true);}}><Upload size={16}/> Subir archivo de contexto</Button></div>
    <p className="daily-hint">Abre el archivo → Analizar y proponer tareas → Enviar a aprobaciones → Aprobar.</p>
    <div className="meeting-grid">{resources.map(item=>{const resource=readProjectContext(item);return <article className="meeting-card" key={item.id}>
      <div className="meeting-card-heading"><span className="meeting-icon"><FileText size={21}/></span><div><span className="context-resource-kind">{resource?"Contexto del proyecto":item.itemType==="note"?"Nota":"Documento"}</span><h3>{item.title}</h3><small>{resource?.date?`Referencia: ${resource.date} · `:""}{item.processingStatus==="indexed"?"Indexado en GBrain":"Original guardado"}</small></div></div>
      {resource?<><div className="meeting-file-list">{resource.files.map(file=><p key={file.role}><FileText size={16}/><span><strong>Archivo de contexto</strong>{file.name} · {Math.ceil(file.size/1024)} KiB</span></p>)}</div><div className="meeting-actions"><Button variant="outline" size="sm" onClick={()=>setSelected(item.id)}>Abrir y analizar contexto</Button></div></>:<p className="daily-hint">{item.summary}</p>}
    </article>;})}</div>
    {!resources.length&&<div className="context-resource-empty"><FileText size={30}/><h3>Convierte el contexto en próximos pasos</h3><p>Agrega el primer documento con los objetivos, requisitos o entregables de este proyecto.</p></div>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="meeting-dialog"><DialogHeader><DialogTitle>Subir archivo de contexto</DialogTitle><DialogDescription>Guarda un documento del proyecto para resumirlo y proponer tareas a partir de su contenido.</DialogDescription></DialogHeader>
      <form ref={formRef} className="core-form" onSubmit={save} onChange={()=>{operation.current=null;}}>
        <label><span>Título</span><Input name="title" placeholder="Ej. Brief y requisitos del proyecto" maxLength={180} required disabled={busy}/></label>
        <label><span>Archivo de contexto</span><Input name="context" type="file" accept={PROJECT_CONTEXT_ACCEPT} required disabled={busy} onChange={event=>{const title=formRef.current?.elements.namedItem("title") as HTMLInputElement|null;if(title&&!title.value&&event.target.files?.[0])title.value=event.target.files[0].name.slice(0,180);}}/></label>
        <label><span>Fecha de referencia del documento (opcional)</span><Input name="date" type="date" disabled={busy}/><small className="daily-hint">Úsala si el documento menciona fechas relativas, como «la próxima semana». Si no la conoces, déjala vacía.</small></label>
        <small className="daily-hint">TXT y Markdown: hasta 256 KiB. PDF con texto y Word .docx: hasta 10 MiB. Lectura de hasta 100 páginas por PDF y 512 KiB de texto. Se conserva el archivo original.</small>
        <p className="daily-hint">El análisis se inicia después de guardar. Las tareas propuestas necesitan tu aprobación.</p>
        {error&&<p className="core-form-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy?"Guardando archivo…":"Guardar contexto"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Dialog open={!!context} onOpenChange={value=>{if(!value)setSelected(null);}}><DialogContent className="meeting-dialog"><DialogHeader><DialogTitle>{current?.title??"Contexto del proyecto"}</DialogTitle><DialogDescription>{context?.date?`Fecha de referencia: ${context.date}`:"Documento de contexto sin fecha de referencia"}</DialogDescription></DialogHeader>
      <div className="meeting-detail-files">{context?.files.map(file=><div key={file.role}><FileText size={22}/><div><strong>Documento original</strong><p>{file.name}</p><small>{Math.ceil(file.size/1024)} KiB</small></div><Button variant="outline" size="sm" asChild><a href={`/api/project-contexts?id=${encodeURIComponent(current!.id)}&role=context`} download><Download size={15}/> Descargar</a></Button></div>)}</div>
      {current&&context&&<MeetingAnalysisPanel key={current.id} meetingId={current.id} fingerprint={context.fingerprint} projectId={projectId} resourceKind="project_context" state={state} acceptState={acceptState}/>}
    </DialogContent></Dialog>
  </>;
}
