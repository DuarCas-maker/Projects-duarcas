"use client";
import { useRef,useState,useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from "@/components/ui/dialog";
import type { Workspace,Task } from "@/lib/workspace-types";
import type { MergeDraft,MergeGroup } from "@/lib/task-merge";
import { operationsFor,detailFor,STATE_LABELS } from "@/lib/project-operations";

export function TaskMergeDialog({state,projectId,tasks,acceptState,close}:{state:Workspace;projectId:string;tasks:Task[];acceptState:(state:Workspace)=>void;close:()=>void}) {
  const [draft,setDraft]=useState<MergeDraft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const requestId=useRef(crypto.randomUUID()),[confirmed,setConfirmed]=useState(false);
  const people=operationsFor(state,projectId).people.filter(p=>p.active);
  const request=async(action:string)=> {
    if(busy)return;setBusy(true);setError("");
    try {
      if(action==="generate" && draft) requestId.current=crypto.randomUUID();
      const response=await fetch("/api/tasks/merge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,projectId,ids:tasks.map(t=>t.id),requestId:requestId.current,...(action==="apply"?{draft}:{})})});
      const result=await response.json() as {error?:string;state:Workspace;draft:MergeDraft};if(!response.ok)throw Error(result.error||"No se pudo preparar la fusión.");
      if(action==="apply"){acceptState(result.state);close();}else {setDraft(result.draft);setConfirmed(false);}
    }catch(e){setError((e as Error).message);if(action==="generate")requestId.current=crypto.randomUUID();}finally{setBusy(false);}
  };
  const started=useRef(false);
  useEffect(()=>{if(!started.current){started.current=true;void request("generate");}},[]);
  const update=(patch:Partial<MergeDraft>)=>{setDraft(d=>d?{...d,...patch}:d);setConfirmed(false);};
  const group=(index:number,patch:Partial<MergeGroup>)=>{if(draft)update({groups:draft.groups.map((g,i)=>i===index?{...g,...patch}:g)});};
  const assignment=(value:string|null,set:(id:string|null)=>void,label:string)=><label>{label}<select value={value??""} onChange={e=>set(e.target.value||null)}><option value="">Sin asignar</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent className="core-dialog task-merge-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>Fusionar {tasks.length} tareas</DialogTitle><DialogDescription>Revisa una propuesta editable. La fusión se aplica únicamente al aprobarla y conserva los originales y sus fuentes en el historial.</DialogDescription></DialogHeader><div className="core-form"><details open={!draft}><summary>Tareas seleccionadas</summary>{tasks.map(t=><article key={t.id}><strong>{t.title}</strong><p>{t.description}</p><small>{STATE_LABELS[t.status]}{t.deadline?` · ${t.deadline}`:""}</small></article>)}</details>
    {draft && <><p>{draft.reason}</p>{draft.conflicts.length>0&&<div className="task-merge-conflicts"><strong>Diferencias que debes revisar</strong><ul>{draft.conflicts.map((c,i)=><li key={i}>{c}</li>)}</ul></div>}
      {draft.mode==="none"?<p>No se recomienda fusionar esta selección. Conserva las tareas separadas.</p>:<>
        <label>Resultado<select value={draft.mode} onChange={e=>{const mode=e.target.value as "single"|"parent";update({mode,groups:mode==="single"?[{...draft.groups[0],taskIds:tasks.map(t=>t.id),title:draft.title,description:draft.description.slice(0,1400)}]:tasks.map(t=>({taskIds:[t.id],title:t.title,description:t.description.slice(0,1400),criteria:"Verificar que la acción y el entregable descritos estén terminados.",primaryId:detailFor(operationsFor(state,projectId),t.id).primaryId,deadline:t.deadline,estimatedMinutes:t.estimatedMinutes,status:t.status==="completed"?"completed":"pending"}))});}}><option value="single">Una tarea consolidada</option><option value="parent" disabled={tasks.some(t=>t.parentTaskId)}>Una tarea principal con subtareas</option></select></label>
        {draft.mode==="parent"&&<><label>Título de la tarea principal<Input maxLength={180} value={draft.title} onChange={e=>update({title:e.target.value})}/></label><label>Descripción general<Textarea maxLength={2000} value={draft.description} onChange={e=>update({description:e.target.value})}/></label>{assignment(draft.primaryId,id=>update({primaryId:id}),"Responsable general")}<label>Fecha límite de la principal<Input type="date" value={draft.deadline??""} onChange={e=>update({deadline:e.target.value||null})}/></label></>}
        {draft.groups.map((g,index)=><fieldset className="task-merge-group" key={index}><legend>{draft.mode==="parent"?`Subtarea ${index+1}`:"Tarea resultante"}</legend><label>Título<Input maxLength={180} value={g.title} onChange={e=>group(index,{title:e.target.value})}/></label><label>Descripción<Textarea maxLength={1400} value={g.description} onChange={e=>group(index,{description:e.target.value})}/></label><label>Criterios de finalización<Textarea maxLength={500} value={g.criteria} onChange={e=>group(index,{criteria:e.target.value})}/></label>{assignment(g.primaryId,id=>group(index,{primaryId:id}),"Responsable")}<div className="core-form-row"><label>Fecha límite<Input type="date" value={g.deadline??""} onChange={e=>group(index,{deadline:e.target.value||null})}/></label><label>Duración estimada (minutos)<Input type="number" min={1} max={10080} value={g.estimatedMinutes} onChange={e=>group(index,{estimatedMinutes:Number(e.target.value)})}/></label></div><label>Estado<select value={g.status} onChange={e=>group(index,{status:e.target.value})}>{["pending","ready","in_progress","blocked","review","completed"].map(s=><option key={s} value={s}>{STATE_LABELS[s]}</option>)}</select></label><p className="core-hint">Consolida: {g.taskIds.map(id=>tasks.find(t=>t.id===id)?.title).join(" · ")}</p>
          {draft.mode==="parent"&&<><label>Añadir tarea a esta subtarea<select value="" onChange={e=>{const id=e.target.value;if(!id)return;update({groups:draft.groups.map((other,i)=>({...other,taskIds:i===index?[...other.taskIds,id]:other.taskIds.filter(t=>t!==id)})).filter(other=>other.taskIds.length)});}}><option value="">Seleccionar original…</option>{tasks.filter(t=>!g.taskIds.includes(t.id)).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><Button variant="ghost" size="sm" disabled={g.taskIds.length<2} onClick={()=>update({groups:[...draft.groups,...g.taskIds.slice(1).map(id=>{const t=tasks.find(t=>t.id===id)!;return {...g,taskIds:[id],title:t.title,description:t.description.slice(0,1400),deadline:t.deadline};})].map((other,i)=>i===index?{...other,taskIds:[g.taskIds[0]]}:other)})}>Separar originales en subtareas</Button></>}
        </fieldset>)}
        <label className="task-merge-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>He revisado la agrupación, los responsables, las fechas y los estados. Apruebo esta propuesta.</label>
      </>}
    </>}
    {error&&<p role="alert" className="core-error">{error}</p>}
    </div><DialogFooter><Button variant="outline" disabled={busy} onClick={close}>Cancelar</Button><Button variant="outline" disabled={busy} onClick={()=>void request("generate")}>{busy?"Procesando…":draft?"Analizar de nuevo":"Analizar y proponer fusión"}</Button>{draft&&draft.mode!=="none"&&<Button disabled={busy||!confirmed} onClick={()=>void request("apply")}>Aprobar y fusionar</Button>}</DialogFooter></DialogContent></Dialog>;
}
