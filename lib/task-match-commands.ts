import type { Workspace } from "./workspace-types";
import { buildCoreCommand,CoreValidationError,databaseRow,type Row,type CoreChange } from "./core-commands";
import { proposalTaskData } from "./task-matches";
import { isMergedTask } from "./task-structure";
import { operationsRecord } from "./project-operations";

export function buildTaskMatchResolution(state:Workspace,userId:string,payload:Row,commandId:string,now=new Date().toISOString()) {
  const fail=(m:string):never=>{throw new CoreValidationError(m,409);};
  const suggestion=state.suggestions.find(s=>s.id===payload.id&&s.userId===userId&&s.status==="pending");
  if(!suggestion || payload.suggestionSnapshot!==suggestion.payload) return fail("La propuesta cambió. Recarga y revisa sus coincidencias.");
  if(payload.operationsUpdatedAt!==(operationsRecord(state,suggestion.projectId!)?.updatedAt??null))fail("Las asignaciones cambiaron. Recarga antes de aprobar.");
  const data=proposalTaskData(suggestion);if(!data)return fail("La propuesta no contiene una tarea válida.");
  const mode=payload.mode;
  const target=state.tasks.find(t=>t.id===payload.targetId&&t.projectId===suggestion.projectId&&t.userId===userId&&!isMergedTask(t)&&t.status!=="cancelled");
  if(!["update","subtask","separate","pending"].includes(String(mode)))fail("Elige actualizar, crear subtarea o mantener separada.");
  let changes:CoreChange[]=[],id=suggestion.id;
  if(mode==="pending") {
    const other=state.suggestions.find(s=>s.id===payload.targetId&&s.id!==suggestion.id&&s.projectId===suggestion.projectId&&s.status==="pending");
    if(!other || other.payload!==payload.targetSnapshot || !proposalTaskData(other))return fail("La otra propuesta cambió. Recarga antes de consolidar.");
    const text=String(payload.description??"").trim();if(!text||text.length>2000)fail("Revisa la descripción consolidada (máximo 2000 caracteres).");
    const stored=JSON.parse(other.payload);
    if(stored.source==="notebook") stored.proposal.changes=[...stored.proposal.changes.filter((c:{field:string})=>c.field!=="description"),{field:"description",value:text}];
    else stored.data={...stored.data,description:text};
    changes.push({table:"ai_suggestions",kind:"update",row:databaseRow({...other,evidence:`${other.evidence}\n${suggestion.evidence}`,payload:JSON.stringify(stored)}),expected:databaseRow(other)});
    changes.push({table:"ai_suggestions",kind:"update",row:databaseRow({...suggestion,status:"rejected"}),expected:databaseRow(suggestion)});
  }else {
    if(mode!=="separate" && (!target||target.updatedAt!==payload.targetUpdatedAt))return fail("La tarea existente cambió. Recarga y revisa el resultado.");
    if(mode==="subtask"&&target?.parentTaskId)fail("Selecciona una tarea principal. Solo se admite un nivel de subtareas.");
    const title=String(payload.title??data.title).trim(),description=String(payload.description??data.description??"").trim();
    const source:Row={...data,title,description};
    const stored=JSON.parse(suggestion.payload);
    const notebookParent=source.parentProposalTitle;
    if(notebookParent && mode==="separate") fail("Esta propuesta es una subtarea de una principal nueva. Aprueba la principal primero y revisa el vínculo desde Editar.");
    if(source.targetId && mode==="separate") fail("Esta propuesta actualiza una tarea existente. Revisa y guarda sus campos desde Editar antes de aprobar.");
    if(mode!=="update" && typeof stored.meetingId==="string") source.originMeetingId=stored.meetingId;delete source.matchedTaskIds;delete source.targetId;delete source.criteria;delete source.parentProposalTitle;
    // Updates preserve existing states, ownership and dates unless the user edits those separately.
    const update=mode==="update";
    const plan=buildCoreCommand(state,userId,update?"update_task":"create_task",update?{id:target!.id,title,description,updatedAt:target!.updatedAt}:{...source,projectId:suggestion.projectId,parentTaskId:mode==="subtask"?target!.id:source.parentTaskId??null},commandId,now,()=>`${commandId}-task`);
    changes=plan.changes;id=plan.id;
    const event=changes.find(c=>c.table==="project_events")!;
    event.row.description=`${title}. ${mode==="update"?"Actualización de tarea existente":mode==="subtask"?"Nueva subtarea":"Tarea separada tras revisar coincidencias"}. ${description}\nEvidencia: ${suggestion.evidence}`;
    if(!update) {const task=changes.find(c=>c.table==="tasks"&&c.row.id===plan.id)!;task.row.source_type="suggestion";task.row.source_id=suggestion.id;task.row.ai_generated=true;}
    changes.push({table:"ai_suggestions",kind:"update",row:databaseRow({...suggestion,status:"approved"}),expected:databaseRow(suggestion)});
  }
  if(!changes.some(c=>c.table==="project_events"))changes.push({table:"project_events",kind:"insert",row:databaseRow({id:commandId,userId,projectId:suggestion.projectId,eventType:"organization",title:"Propuestas consolidadas",description:`${suggestion.title}. Evidencia: ${suggestion.evidence}`,sourceType:"suggestion",sourceId:suggestion.id,eventDate:now,createdAt:now})});
  return {id,changes};
}
