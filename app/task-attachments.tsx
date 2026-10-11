"use client";
import { useRef,useState } from "react";
import { Paperclip,Upload,Link2,Download,History,RefreshCw,Send,ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { taskAttachments,TASK_FILE_ACCEPT,readTaskVersion,type Knowledge,type TaskAttachment } from "@/lib/task-attachments";
import type { Workspace,Task } from "@/lib/workspace-types";

type Change=(action:string,attachmentId?:string,file?:File,url?:string,name?:string)=>Promise<boolean>;
function AttachmentCard({item,attachment,state,busy,change}:{item:Knowledge;attachment:TaskAttachment;state:Workspace;busy:boolean;change:Change}) {
  const fileInput=useRef<HTMLInputElement>(null),[editingLink,setEditingLink]=useState(false),[url,setUrl]=useState(attachment.versions.at(-1)!.url??"");
  const latest=attachment.versions.at(-1)!,ready=["ready","indexed"].includes(state.knowledge.find(k=>k.id===latest.id)?.processingStatus??"")&&!latest.error;
  const download=(id:string,snapshot=false)=>`/api/task-attachments?taskId=${encodeURIComponent(attachment.taskId)}&versionId=${encodeURIComponent(id)}${snapshot?"&snapshot=1":""}`;
  return <article className="task-file-card">
    <div className="task-file-heading"><span>{attachment.kind==="link"?<Link2 size={18}/>:<Paperclip size={18}/>}</span><div><strong>{latest.name}</strong><small>Versión {attachment.versions.length} · {attachment.published?ready?"En Contexto · búsquedas e IA":"En Contexto · lectura pendiente":"Solo en esta tarea"}{latest.size?` · ${Math.max(1,Math.round(latest.size/1024))} KB`:""}</small></div></div>
    {latest.url&&<a className="task-file-url" href={latest.url} target="_blank" rel="noopener noreferrer">{latest.url}<ExternalLink size={13}/></a>}
    {latest.error&&<p role="status" className="core-form-error">{latest.error}</p>}
    <div className="task-file-actions">
      {latest.key&&<Button asChild size="sm" variant="outline"><a href={download(latest.id)}><Download size={14}/>Descargar</a></Button>}
      <input ref={fileInput} type="file" accept={TASK_FILE_ACCEPT} className="sr-only" aria-label={`Nueva versión de ${latest.name}`} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void change("update",item.id,file);}}/>
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>attachment.kind==="file"?fileInput.current?.click():setEditingLink(v=>!v)}><RefreshCw size={14}/>{attachment.kind==="file"?"Actualizar archivo":"Actualizar enlace"}</Button>
      {!attachment.published?<Button size="sm" disabled={busy} onClick={()=>void change("publish",item.id)}><Send size={14}/>Enviar a contexto</Button>:!ready?<Button size="sm" disabled={busy} onClick={()=>void change("retry",item.id)}><RefreshCw size={14}/>Reintentar lectura</Button>:null}
    </div>
    {editingLink&&<form className="task-link-update" onSubmit={event=>{event.preventDefault();void change("update",item.id,undefined,url,latest.name).then(saved=>{if(saved)setEditingLink(false);});}}><label>Enlace de la nueva versión<Input type="url" required value={url} onChange={event=>setUrl(event.target.value)} /></label><Button size="sm" disabled={busy}>Guardar nueva versión</Button></form>}
    <details className="task-file-history"><summary><History size={14}/>Historial · {attachment.versions.length} {attachment.versions.length===1?"versión":"versiones"}</summary><ol>{attachment.versions.map((version,index)=>({version,index})).reverse().map(({version,index})=>{const snapshot=readTaskVersion(state.knowledge.find(k=>k.id===version.id)! )?.textKey;return <li key={version.id}><div><strong>Versión {index+1}{index===attachment.versions.length-1?" · actual":""}</strong><span>{version.name}</span><small>{new Date(version.createdAt).toLocaleString("es-CO",{timeZone:"America/Bogota"})}</small></div>{version.key?<a href={download(version.id)}>Descargar</a>:<div>{version.url&&<a href={version.url} target="_blank" rel="noopener noreferrer">Abrir enlace</a>}{snapshot&&<a href={download(version.id,true)}>Descargar lectura guardada</a>}</div>}</li>;})}</ol></details>
  </article>;
}
function useAttachmentChanges(taskId:string,acceptState:(state:Workspace)=>void) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const locked=useRef(false);
  const pending=useRef<{action:string;attachmentId?:string;file?:File;url?:string;name?:string;id:string}|null>(null);
  const change:Change=async(action,attachmentId,file,url,name)=>{
    if(locked.current)return false;locked.current=true;setBusy(true);setError("");setMessage("");
    try {
      const previous=pending.current;
      const same=previous&&previous.action===action&&previous.attachmentId===attachmentId&&previous.file===file&&previous.url===url&&previous.name===name;
      const id=same?previous.id:crypto.randomUUID();pending.current={action,attachmentId,file,url,name,id};
      const form=new FormData();form.set("taskId",taskId);form.set("action",action);form.set("requestId",id);
      if(attachmentId)form.set("attachmentId",attachmentId);if(file)form.set("file",file);if(url)form.set("url",url);if(name)form.set("name",name);
      const response=await fetch("/api/task-attachments",{method:"POST",body:form});const data=await response.json() as {state?:Workspace;error?:string;warning?:string;status?:string};
      if(!response.ok||!data.state)throw new Error(data.error||"No se pudo guardar el archivo.");pending.current=null;acceptState(data.state);
      if(data.warning)setError(data.warning);else setMessage(data.status==="ready"?"Contexto actualizado. El contenido ya está disponible para búsquedas e IA.":"Recurso guardado en la tarea. Puedes enviarlo a Contexto cuando lo decidas.");
      return true;
    } catch(failure){setError(failure instanceof Error?failure.message:"No se pudo guardar el recurso.");return false;}
    finally{locked.current=false;setBusy(false);}
  };
  return {busy,error,message,change};
}
export function TaskFilesButton({task,state,acceptState}:{task:Task;state:Workspace;acceptState:(state:Workspace)=>void}) {
  const [open,setOpen]=useState(false),[files,setFiles]=useState<File[]>([]),[url,setUrl]=useState(""),[name,setName]=useState("");
  const input=useRef<HTMLInputElement>(null),operation=useAttachmentChanges(task.id,acceptState),attachments=taskAttachments(state,task.id);
  return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}><Paperclip size={15}/>Archivos{attachments.length?` (${attachments.length})`:""}</Button><Dialog open={open} onOpenChange={value=>{if(!operation.busy)setOpen(value);}}><DialogContent className="task-files-dialog"><DialogHeader><DialogTitle>Archivos de la tarea</DialogTitle><DialogDescription>{task.title}</DialogDescription></DialogHeader><p className="daily-hint">Sube archivos o agrega enlaces. El primer envío a Contexto es manual; las nuevas versiones se actualizan allí automáticamente. Las imágenes se leen con IA al enviarlas y consumen una consulta.</p>
    <form className="task-attachment-upload" onSubmit={event=>{event.preventDefault();void(async()=>{for(const file of files){if(!await operation.change("upload",undefined,file))return;setFiles(remaining=>remaining.filter(selected=>selected!==file));}if(input.current)input.current.value="";})();}}><label>Archivos · hasta 25 MB cada uno<input ref={input} type="file" multiple accept={TASK_FILE_ACCEPT} disabled={operation.busy} onChange={event=>setFiles(Array.from(event.target.files??[]))}/></label><small>PDF, Word .docx, Excel .xlsx, PowerPoint .pptx, texto, PNG, JPG, WebP y GIF. Los formatos Office antiguos se conservan; conviértelos al formato actual para leer su contenido.</small><Button disabled={operation.busy||!files.length} size="sm"><Upload size={14}/>Subir {files.length>1?`${files.length} archivos`:"archivo"}</Button></form>
    <form className="task-attachment-upload" onSubmit={event=>{event.preventDefault();void operation.change("upload",undefined,undefined,url,name).then(saved=>{if(saved){setUrl("");setName("");}});}}><label>Enlace<Input type="url" required placeholder="https://…" value={url} disabled={operation.busy} onChange={event=>setUrl(event.target.value)}/></label><label>Nombre del recurso (opcional)<Input value={name} maxLength={180} disabled={operation.busy} onChange={event=>setName(event.target.value)}/></label><Button disabled={operation.busy||!url.trim()} size="sm" variant="outline"><Link2 size={14}/>Agregar enlace</Button></form>
    {operation.busy&&<p role="status">Guardando y preparando el recurso…</p>}{operation.error&&<p role="alert" className="core-form-error">{operation.error}</p>}{operation.message&&<p role="status" className="task-files-success">{operation.message}</p>}
    <div className="task-attachment-list">{attachments.map(a=><AttachmentCard key={a.item.id} {...a} state={state} busy={operation.busy} change={operation.change}/>)}{!attachments.length&&<p className="daily-hint">Esta tarea todavía no tiene archivos ni enlaces.</p>}</div>
  </DialogContent></Dialog></>;
}
function TaskResourceGroup({task,state,acceptState}:{task:Task;state:Workspace;acceptState:(state:Workspace)=>void}) {
  const operation=useAttachmentChanges(task.id,acceptState),attachments=taskAttachments(state,task.id).filter(a=>a.attachment.published);
  if(!attachments.length)return null;
  return <section className="task-resource-group"><h3>{task.title}</h3><div className="task-attachment-list">{attachments.map(a=><AttachmentCard key={a.item.id} {...a} state={state} busy={operation.busy} change={operation.change}/>)}</div>{operation.busy&&<p role="status">Actualizando el recurso…</p>}{operation.error&&<p role="alert" className="core-form-error">{operation.error}</p>}{operation.message&&<p role="status" className="task-files-success">{operation.message}</p>}</section>;
}
export function TaskResources({state,projectId,acceptState}:{state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const tasks=state.tasks.filter(t=>t.projectId===projectId),count=tasks.reduce((n,t)=>n+taskAttachments(state,t.id).filter(a=>a.attachment.published).length,0);
  return <section className="panel task-resources"><div className="section-heading"><div><p>RECURSOS</p><h2>Archivos y enlaces por tarea</h2></div><span>{count} {count===1?"recurso":"recursos"}</span></div>{tasks.map(task=><TaskResourceGroup key={task.id} task={task} state={state} acceptState={acceptState}/>)}{!count&&<p className="daily-hint">Desde Tareas → Archivos, agrega un recurso y pulsa «Enviar a contexto». Aparecerá aquí agrupado por su tarea.</p>}</section>;
}
