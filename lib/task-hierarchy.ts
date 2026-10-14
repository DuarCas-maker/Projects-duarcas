import type { Workspace, Task } from "./workspace-types";
import { taskChildren, isMergedTask } from "./task-structure";
import { CoreValidationError } from "./core-validation";
import type { CoreChange } from "./core-commands";
const databaseRow = (row:Record<string,unknown>) => Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`),value]));

/** Normalize aggregate state inside the same transaction as the child edit. */
export function finalizeTaskHierarchy(state: Workspace, changes: CoreChange[], now: string) {
  const taskChanges = changes.filter(c => c.table === "tasks");
  if (!taskChanges.length) return changes;
  const camel = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),v])) as Task;
  const next = { ...state, tasks: [...state.tasks] };
  for (const change of taskChanges) {
    const row = camel(change.row);
    next.tasks = next.tasks.filter(t => t.id !== row.id);
    if (change.kind !== "delete") next.tasks.push(row);
  }
  for (const c of changes.filter(c=>c.table === "task_dependencies")) {
    next.dependencies=next.dependencies.filter(e=>e.id!==c.row.id);
    if(c.kind!=="delete") next.dependencies.push(Object.fromEntries(Object.entries(c.row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,x:string)=>x.toUpperCase()),v])) as Workspace["dependencies"][number]);
  }
  const fail = (message: string): never => { throw new CoreValidationError(message,409); };
  for (const task of next.tasks.filter(t => !isMergedTask(t) && t.parentTaskId)) {
    const parent = next.tasks.find(t => t.id === task.parentTaskId && t.userId === task.userId && t.projectId === task.projectId && !isMergedTask(t)) ?? fail("Tarea principal no encontrada en este proyecto.");
    if (!parent || parent.id === task.id || parent.parentTaskId) fail("La tarea principal debe pertenecer al mismo proyecto. Solo se admite un nivel de subtareas.");
    if (taskChildren(next, task.id).length) fail("Una tarea con subtareas no puede convertirse en subtarea.");
    if (next.dependencies.some(e => e.taskId === task.id && e.dependsOnTaskId === parent.id || e.taskId === parent.id && e.dependsOnTaskId === task.id)) fail("Una tarea principal y sus subtareas no pueden depender entre sí.");
  }
  if(next.dependencies.some(e=>next.tasks.some(t=>(t.id===e.taskId||t.id===e.dependsOnTaskId)&&isMergedTask(t)))) fail("Una dependencia apunta a una tarea fusionada. Recarga y selecciona la tarea resultante.");
  const touched = new Set(taskChanges.flatMap(c => { const t = camel(c.row), prior = state.tasks.find(p => p.id === t.id); return [t.id,t.parentTaskId,prior?.parentTaskId].filter(Boolean); }));
  for (const parent of next.tasks.filter(t => touched.has(t.id) && !isMergedTask(t))) {
    const children = taskChildren(next,parent.id);
    if (!children.length) continue;
    const active = children.filter(t => t.status !== "cancelled");
    const allDone = active.length > 0 && active.every(t => t.status === "completed");
    if(!allDone && active.length && state.milestones.find(m=>m.id===parent.milestoneId)?.status === "completed") fail("Reabre el hito de la tarea principal antes de añadir o reabrir subtareas.");
    const requested = taskChanges.find(c => c.row.id === parent.id);
    if (requested?.row.status === "completed" && !allDone && state.tasks.find(t => t.id === parent.id)?.status !== "completed") fail("Completa o cancela las subtareas antes de cerrar la tarea principal.");
    const status = allDone ? "completed" : !active.length ? "cancelled" : parent.status === "completed" || parent.status === "cancelled" ? "pending" : parent.status;
    if (["in_progress","review","completed"].includes(status) && next.dependencies.some(e => e.taskId === parent.id && next.tasks.find(t => t.id === e.dependsOnTaskId)?.status !== "completed")) fail("Completa las dependencias de la tarea principal antes de cerrar sus subtareas.");
    const updated = { ...parent,status,completedAt: status === "completed" ? parent.completedAt ?? now : null,isBlocked: status === "blocked",blockingReason: status === "blocked" ? parent.blockingReason : null,updatedAt:now };
    if (requested) requested.row = databaseRow(updated);
    else {
      const previous = state.tasks.find(t => t.id === parent.id)!;
      changes.push({table:"tasks",kind:"update",row:databaseRow(updated),expected:{updated_at:previous.updatedAt}});
    }
  }
  return changes;
}
