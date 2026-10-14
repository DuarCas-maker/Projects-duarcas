import { executionTasks } from "./task-structure";
import type { Project, Task, Workspace } from "./workspace-types";
import { operationsFor, filterTaskPerson } from "./project-operations";
import { bogotaDay, eligibleTasks } from "./daily-engine";
import { calendarDate } from "./task-timing";

export type TaskMetric = "total" | "pending" | "completed";
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}
export function matchesMetric(task: Task, metric: TaskMetric) {
  if (task.status === "cancelled") return false;
  return metric === "total" || (metric === "completed" ? task.status === "completed" : task.status !== "completed");
}
export function taskCounts(tasks: Task[]) {
  tasks = executionTasks(tasks);
  return { total: tasks.filter(t => matchesMetric(t, "total")).length, pending: tasks.filter(t => matchesMetric(t, "pending")).length, completed: tasks.filter(t => matchesMetric(t, "completed")).length };
}
export function projectScope(state: Workspace, includeOther: boolean) {
  return state.projects.filter(p => includeOther || ["Activo", "Por iniciar"].includes(p.operationalStatus));
}
export function dashboardTasks(state: Workspace, projects: Project[], person: string) {
  const ids = new Set(projects.map(p => p.id));
  return executionTasks(state.tasks).filter(t => ids.has(t.projectId) && filterTaskPerson(state, t, person));
}
export function sortAgenda(tasks: Task[]) {
  return [...tasks].sort((a, b) => (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") || b.priority - a.priority || a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id));
}
export function recommendedTasks(state: Workspace, tasks: Task[], today = bogotaDay()) {
  const ids = new Set(tasks.map(t => t.id));
  return eligibleTasks(state, today).filter(t => ids.has(t.id)).slice(0, 3);
}
export function deadlineSignal(task: Task, today = bogotaDay()) {
  if (!task.deadline || !calendarDate(task.deadline)) return { label: "Sin fecha límite", kind: "none", days: null };
  if (["completed", "cancelled"].includes(task.status)) return { label: task.status === "completed" ? "Completada" : "Cancelada", kind: "closed", days: null };
  const days = daysBetween(today, task.deadline);
  return { label: days < 0 ? `${-days} ${days === -1 ? "día" : "días"} de atraso` : days === 0 ? "Vence hoy" : `${days} ${days === 1 ? "día restante" : "días restantes"}`, kind: days < 0 ? "overdue" : days === 0 ? "today" : "future", days };
}
export function projectProgress(state: Workspace, project: Project, today = bogotaDay()) {
  const tasks = executionTasks(state.tasks).filter(t => t.projectId === project.id), counts = taskCounts(tasks);
  const cancelled = tasks.filter(t => t.status === "cancelled").length;
  const schedule = operationsFor(state, project.id).schedule;
  const plannedStart = calendarDate(schedule?.plannedStart) ? schedule.plannedStart : null;
  const actualStart = calendarDate(schedule?.actualStart) ? schedule.actualStart : null;
  const start = actualStart ?? plannedStart;
  const end = calendarDate(project.targetEndDate) ? project.targetEndDate : null;
  const remaining = end ? daysBetween(today, end) : null;
  const duration = start && end ? daysBetween(start, end) : null;
  // Zero-length or late actual starts still become fully consumed on the deadline.
  const timePercent = start && end ? today >= end ? 100 : today <= start ? 0 : duration && duration > 0 ? Math.round(Math.min(100, Math.max(0, daysBetween(start, today) / duration * 100))) : 0 : null;
  return { ...counts, cancelled, all: tasks.length, completedPercent: counts.total ? Math.round(counts.completed / counts.total * 100) : 0,
    completedSegment: tasks.length ? counts.completed / tasks.length * 100 : 0, cancelledSegment: tasks.length ? cancelled / tasks.length * 100 : 0,
    plannedStart, actualStart, start, end, remaining, timePercent, startBasis: actualStart ? "Inicio real" : "Inicio planificado",
    overdue: tasks.filter(t => deadlineSignal(t, today).kind === "overdue").length };
}
