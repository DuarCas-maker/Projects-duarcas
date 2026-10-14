import type { Workspace, Task } from "./workspace-types";
import { buildCoreCommand, CoreValidationError, databaseRow, type CoreChange } from "./core-commands";
import { finalizeTaskHierarchy } from "./task-hierarchy";
import { operationsFor, operationsRecord, detailFor } from "./project-operations";
import { isMergedTask, taskChildren } from "./task-structure";

export type MergeGroup = { taskIds:string[]; title:string; description:string; criteria:string; primaryId:string|null; deadline:string|null; estimatedMinutes:number; status:string };
export type MergeDraft = { mode:"single"|"parent"|"none"; title:string; description:string; primaryId:string|null; deadline:string|null; reason:string; conflicts:string[]; groups:MergeGroup[] };
const fail = (message:string):never => { throw new CoreValidationError(message,409); };
export function mergeTasks(state:Workspace,userId:string,projectId:string,ids:unknown):Task[] {
  if (!state.projects.some(p=>p.id===projectId && p.userId===userId) || !Array.isArray(ids) || ids.length<2 || ids.length>20 || new Set(ids).size!==ids.length) fail("Selecciona entre 2 y 20 tareas del mismo proyecto.");
  return (ids as unknown[]).map(id=> {
    const task=state.tasks.find(t=>t.id===id && t.projectId===projectId && t.userId===userId && !isMergedTask(t));
    if (!task || task.status === "cancelled") return fail("Una tarea seleccionada ya no está disponible.");
    if (taskChildren(state,task.id).length) fail("Despliega la tarea principal y selecciona sus subtareas para fusionarlas.");
    return task;
  });
}
export function mergeSnapshot(state:Workspace,projectId:string) {
  return JSON.stringify({ tasks:state.tasks.filter(t=>t.projectId===projectId).sort((a,b)=>a.id.localeCompare(b.id)), operations:operationsRecord(state,projectId)??null, dependencies:state.dependencies.filter(e=>state.tasks.some(t=>t.id===e.taskId&&t.projectId===projectId)).sort((a,b)=>a.id.localeCompare(b.id)), calendar:state.calendar.filter(b=>b.projectId===projectId).sort((a,b)=>a.id.localeCompare(b.id)) });
}
export function validateMergeDraft(value:unknown,tasks:Task[],state:Workspace):MergeDraft {
  const d=value as MergeDraft;
  const str=(s:unknown,max:number,required=false)=>typeof s==="string" && s.length<=max && (!required||!!s.trim());
  if (!d || !["single","parent","none"].includes(d.mode) || !str(d.title,180,true) || !str(d.description,2000) || !str(d.reason,2000,true) || !Array.isArray(d.conflicts) || d.conflicts.length>20 || d.conflicts.some(c=>!str(c,1000)) || !Array.isArray(d.groups) || d.groups.length>tasks.length) fail("La propuesta de fusión no tiene un formato válido.");
  const people=operationsFor(state,tasks[0].projectId).people.filter(p=>p.active).map(p=>p.id);
  const date=(v:unknown)=>v===null||typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(`${v}T12:00:00Z`).toISOString().slice(0,10)===v;
  const person=(v:unknown)=>v===null||typeof v==="string"&&people.includes(v);
  if (!date(d.deadline)||!person(d.primaryId)) fail("Revisa la fecha y el responsable general.");
  if (d.mode==="none") { if(d.groups.length) fail("Una propuesta sin relación no debe modificar tareas."); return d; }
  if (!d.groups.length || d.mode==="single" && d.groups.length!==1 || d.mode==="parent" && d.groups.length<2) fail("Una fusión simple necesita un grupo; una tarea principal necesita al menos dos subtareas.");
  const assigned:string[]=[];
  for(const group of d.groups) {
    if (!Array.isArray(group.taskIds)||!group.taskIds.length||group.taskIds.some(id=>!tasks.some(t=>t.id===id))||!str(group.title,180,true)||!str(group.description,1400)||!str(group.criteria,500,true)||!person(group.primaryId)||!date(group.deadline)||!Number.isInteger(group.estimatedMinutes)||group.estimatedMinutes<1||group.estimatedMinutes>10080||!["pending","ready","in_progress","blocked","review","completed"].includes(group.status)) fail("Completa los campos y los criterios de cada tarea resultante.");
    assigned.push(...group.taskIds);
  }
  if (assigned.length!==tasks.length || new Set(assigned).size!==tasks.length) fail("Cada tarea seleccionada debe aparecer exactamente una vez en el resultado.");
  if(d.mode==="parent" && tasks.some(t=>t.parentTaskId)) fail("Para crear una nueva tarea principal, separa primero las subtareas de su principal actual. Solo se admite un nivel.");
  if(d.mode==="single" && new Set(tasks.map(t=>t.parentTaskId)).size>1) fail("Las tareas a fusionar deben ser independientes o subtareas de la misma principal.");
  return d;
}
export function buildTaskMerge(state:Workspace,userId:string,projectId:string,ids:unknown,draft:unknown,snapshot:string,commandId:string,now=new Date().toISOString()) {
  if (mergeSnapshot(state,projectId)!==snapshot) fail("Las tareas, asignaciones o fechas cambiaron. Genera una propuesta nueva antes de fusionar.");
  const tasks=mergeTasks(state,userId,projectId,ids),d=validateMergeDraft(draft,tasks,state);
  if(d.mode==="none") fail("No hay una fusión propuesta. Conserva las tareas separadas.");
  let next:Workspace={...state,tasks:[...state.tasks],operations:[...(state.operations??[])],dependencies:[...state.dependencies],events:[...state.events]};
  const changes:CoreChange[]=[];
  const absorb=(plan:{changes:CoreChange[]})=> {
    for(const c of plan.changes.filter(c=>c.table!=="project_events")) {
      changes.push(c);
      const key=c.table==="tasks"?"tasks":c.table==="project_operations"?"operations":c.table==="task_dependencies"?"dependencies":null;
      if(key) { const row=Object.fromEntries(Object.entries(c.row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,x:string)=>x.toUpperCase()),v])); (next[key] as unknown[])=(next[key] as {id:string}[]).filter(r=>r.id!==row.id); if(c.kind!=="delete") (next[key] as unknown[]).push(row); }
    }
  };
  const parentId=d.mode==="parent"?`${commandId}-parent`:tasks[0].parentTaskId;
  if(d.mode==="parent") absorb(buildCoreCommand(next,userId,"create_task",{projectId,title:d.title,description:d.description,primaryId:d.primaryId,deadline:d.deadline},`${commandId}-parent-event`,now,()=>parentId!));
  const targets=new Map(d.groups.flatMap(g=>g.taskIds.map(id=>[id,g.taskIds[0]] as const)));
  const oldEdges=[...next.dependencies];
  const seen=new Set<string>();
  next.dependencies=oldEdges.flatMap(e=> {
    const taskId=targets.get(e.taskId)??e.taskId,dependsOnTaskId=targets.get(e.dependsOnTaskId)??e.dependsOnTaskId,key=`${taskId}:${dependsOnTaskId}`;
    if(taskId===dependsOnTaskId||seen.has(key)) return []; seen.add(key); return [{...e,taskId,dependsOnTaskId}];
  });
  const reaches=(id:string,start:string,visited=new Set<string>()):boolean=>{ if(visited.has(id))return false;visited.add(id);return next.dependencies.filter(e=>e.taskId===id).some(e=>e.dependsOnTaskId===start||reaches(e.dependsOnTaskId,start,visited)); };
  if(next.dependencies.some(e=>reaches(e.taskId,e.taskId))) fail("La fusión crearía un ciclo entre dependencias. Revisa la agrupación.");
  for(const e of oldEdges) { const newer=next.dependencies.find(n=>n.id===e.id); if(!newer||newer.taskId!==e.taskId||newer.dependsOnTaskId!==e.dependsOnTaskId) { changes.push({table:"task_dependencies",kind:"delete",row:{id:e.id,user_id:userId},expected:databaseRow(e)});if(newer)changes.push({table:"task_dependencies",kind:"insert",row:databaseRow({...newer,id:`${commandId}-dep-${changes.length}`})}); } }
  for(const group of d.groups) {
    const target=next.tasks.find(t=>t.id===group.taskIds[0])!;
    const data=operationsFor(next,projectId);
    const collaboratorIds=[...new Set(group.taskIds.flatMap(id=>{const det=detailFor(data,id);return [det.primaryId,...det.collaboratorIds].filter((p):p is string=>!!p&&p!==group.primaryId);} ))];
    absorb(buildCoreCommand(next,userId,"update_task",{id:target.id,title:group.title,description:`${group.description}\n\nCriterios de finalización: ${group.criteria}`,primaryId:group.primaryId,collaboratorIds,parentTaskId:parentId,deadline:group.deadline,estimatedMinutes:group.estimatedMinutes,status:group.status},`${commandId}-group-${target.id}`,now));
    for(const id of group.taskIds.slice(1)) {
      const original=next.tasks.find(t=>t.id===id)!;
      const row={...original,parentTaskId:null,status:"cancelled",isBlocked:false,blockingReason:null,completedAt:null,sourceType:"task_merge",sourceId:target.id,updatedAt:now};
      changes.push({table:"tasks",kind:"update",row:databaseRow(row),expected:{updated_at:original.updatedAt}});next.tasks=next.tasks.map(t=>t.id===id?row:t);
    }
  }
  for(const block of state.calendar.filter(b=>b.projectId===projectId&&b.taskId&&targets.has(b.taskId)&&targets.get(b.taskId)!==b.taskId)) changes.push({table:"calendar_blocks",kind:"update",row:databaseRow({...block,taskId:targets.get(block.taskId!)!}),expected:databaseRow(block)});
  // Originals retain their attachments, comments, deliveries and evidence. UI follows source IDs.
  const compact:CoreChange[]=[];
  for(const c of changes) {
    const prior=compact.findIndex(p=>p.table===c.table&&p.row.id===c.row.id&&p.kind!=="delete");
    if(prior>=0 && c.kind!=="delete") compact[prior]={...c,kind:compact[prior].kind,expected:compact[prior].expected}; else compact.push(c);
  }
  finalizeTaskHierarchy(state,compact,now);
  const resultId=d.mode==="parent"?parentId!:d.groups[0].taskIds[0];
  compact.push({table:"project_events",kind:"insert",row:databaseRow({id:commandId,userId,projectId,eventType:"task_merge",title:"Tareas fusionadas",description:JSON.stringify({version:1,reason:d.reason,conflicts:d.conflicts,resultId,draft:d,originals:tasks,operations:operationsRecord(state,projectId)??null}),sourceType:"manual",sourceId:resultId,eventDate:now,createdAt:now})});
  return {id:resultId,projectId,changes:compact};
}
