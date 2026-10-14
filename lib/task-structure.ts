import type { Task, Workspace } from "./workspace-types";

export const isMergedTask = (task: Task) => task.sourceType === "task_merge";
export function mergeEventText(event:{eventType:string;description:string}) {
  if(event.eventType!=="task_merge")return event.description;
  try {const data=JSON.parse(event.description);return `Fusión aprobada: ${String(data.reason??"")}. Resultado: ${String(data.draft?.title??"")}. Originales: ${(data.originals??[]).map((t:{title:string})=>t.title).join("; ")}`.slice(0,2000);}catch{return "Fusión de tareas registrada.";}
}
export function taskChildren(state: Workspace, id: string) {
  return state.tasks.filter(task => task.parentTaskId === id && !isMergedTask(task));
}
export function executionTasks(tasks: Task[]) {
  const parents = new Set(tasks.filter(t => !isMergedTask(t)).map(t => t.parentTaskId).filter(Boolean));
  return tasks.filter(t => !isMergedTask(t) && !parents.has(t.id));
}
export function taskSourceIds(state: Workspace, id: string): Set<string> {
  const root=state.tasks.find(t=>t.id===id);
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const task of state.tasks) if (root && task.projectId===root.projectId && task.userId===root.userId && isMergedTask(task) && task.sourceId && ids.has(task.sourceId) && !ids.has(task.id)) { ids.add(task.id); changed = true; }
  }
  return ids;
}
export function taskMergeOriginals(state:Workspace,id:string) {
  const root=state.tasks.find(t=>t.id===id),ids=taskSourceIds(state,id);
  if(!root)return [];
  return state.events.filter(e=>e.eventType==="task_merge"&&e.projectId===root.projectId&&e.userId===root.userId).flatMap(event=>{
    try {const history=JSON.parse(event.description) as {resultId:string;originals:Task[]};return Array.isArray(history.originals)?history.originals.filter(t=>t.userId===root.userId&&t.projectId===root.projectId&&(history.resultId===id||ids.has(t.id))).map(original=>({eventId:event.id,original})):[];}catch{return [];}
  });
}
export function taskTree(state: Workspace, projectId: string, matches: (task: Task) => boolean) {
  const tasks = state.tasks.filter(t => t.projectId === projectId && !isMergedTask(t));
  return tasks.filter(t => !t.parentTaskId).flatMap(parent => {
    const children = tasks.filter(t => t.parentTaskId === parent.id);
    const visibleChildren = children.filter(matches);
    return matches(parent) || visibleChildren.length ? [{ parent, children: matches(parent) ? children : visibleChildren, totalChildren: children.length, completed: children.filter(t => t.status === "completed").length }] : [];
  });
}
