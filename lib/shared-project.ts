import type { Workspace } from "./workspace-types";
import { operationsFor, detailFor, personHasTask, STATE_LABELS, type TaskComment } from "./project-operations";
import { taskSourceIds,isMergedTask } from "./task-structure";
import { taskAttachments } from "./task-attachments";

export function sharedProjection(state: Workspace, projectId: string, personId: string) {
  const data = operationsFor(state, projectId), person = data.people.find(p => p.id === personId && p.active);
  const project = state.projects.find(p => p.id === projectId);
  if (!person || !project) throw new Error("Enlace no disponible.");
  const tasks = state.tasks.filter(t => t.projectId === projectId && !isMergedTask(t) && personHasTask(data, t.id, personId));
  const aliases=new Map(tasks.flatMap(t=>[...taskSourceIds(state,t.id)].map(id=>[id,t.id] as const)));
  const ids = new Set(aliases.keys());
  return {
    project: { name: project.name }, person: { name: person.name }, columns: data.columns, states: STATE_LABELS,
    tasks: tasks.map(task => {
      const detail = detailFor(data, task.id), blockers = state.dependencies.filter(e => e.taskId === task.id).some(e => state.tasks.find(t => t.id === e.dependsOnTaskId)?.status !== "completed");
      return { id: task.id, parentTaskId:task.parentTaskId, parentTitle:state.tasks.find(t=>t.id===task.parentTaskId)?.title??null, title: task.title, description: task.description, status: task.status, updatedAt: task.updatedAt, deadline: task.deadline, tentativeDeliveryDate: task.tentativeDeliveryDate, plannedStart: detail.plannedStart, plannedEnd: detail.plannedEnd, isBlocked: task.isBlocked, dependencyBlocked: blockers, blockingReason: blockers ? "Pendiente de un requisito del proyecto" : task.blockingReason, role: detail.primaryId === personId ? "Responsable principal" : "Colaborador", columnId: detail.columnId };
    }),
    comments: data.comments.filter(c => ids.has(c.taskId)).map(c => ({ id: c.id, taskId: aliases.get(c.taskId)!, body: c.body, createdAt: c.createdAt, author: commentAuthor(data.people, c) })),
    deliveries: data.deliveries.filter(d => ids.has(d.taskId)).map(({ id, taskId, name, size, createdAt }) => ({ id, taskId:aliases.get(taskId)!, name, size, createdAt })),
    resources: tasks.flatMap(t => taskAttachments(state, t.id).flatMap(a => a.attachment.versions.filter(v => v.id === a.attachment.activeVersionId).map(v => ({ id: v.id, taskId: t.id, name: v.name, size: v.size, url: v.url, downloadable: !!v.key })))),
  };
}
export function commentAuthor(people: { id: string; name: string }[], comment: TaskComment) { return comment.personId ? `Enlace de ${people.find(p => p.id === comment.personId)?.name ?? "colaborador"}` : "Propietario"; }
export type SharedProject = ReturnType<typeof sharedProjection>;
