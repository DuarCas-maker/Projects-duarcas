import type { Workspace, Task } from "./workspace-types";
import { filterTaskPerson, financeTotals } from "./project-operations";

const closed = ["Finalizado", "Cancelado", "Archivado", "Pausado"];
export function bogotaDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(day: string, amount: number) { return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10); }
export function dayOf(iso: string) { return bogotaDay(new Date(iso)); }
export function rankTask(task: Task, state: Workspace, day = bogotaDay()) {
  const project = state.projects.find((item) => item.id === task.projectId);
  const days = task.deadline ? Math.round((Date.parse(task.deadline) - Date.parse(day)) / 86400000) : null;
  const downstream = state.dependencies.filter((edge) => edge.dependsOnTaskId === task.id && !["completed", "cancelled"].includes(state.tasks.find((item) => item.id === edge.taskId)?.status ?? "")).length;
  const finance = state.financials.find((item) => item.projectId === task.projectId);
  const totals = financeTotals(state, task.projectId);
  const paid = totals.some(t => t.income > 0) && totals.every(t => t.income === t.received) || !totals.length && (finance?.paymentStatus === "paid" || project?.commercialStatus === "Pagado");
  const recurring = project?.commercialStatus === "Recurrente" || project?.projectType === "Recurrente";
  const reasons = [`prioridad manual ${task.priority}/5`, `urgencia ${task.urgency}/5`];
  if (days !== null && days < 0) reasons.push(`vencida desde ${task.deadline}`);
  else if (days === 0) reasons.push("vence hoy");
  else if (days !== null && days <= 3) reasons.push(`vence en ${days} días`);
  if (downstream) reasons.push(`desbloquea ${downstream} tareas`);
  if (paid) reasons.push("proyecto pagado");
  if (recurring) reasons.push("operación recurrente");
  if (task.isBlocked) reasons.push(task.blockingReason || "bloqueada");
  const score = task.priority * 18 + task.urgency * 14 + (project?.strategicPriority ?? 3) * 6 + (days === null ? 0 : days < 0 ? 45 : days === 0 ? 40 : days <= 3 ? 25 : 8) + Math.min(downstream * 10, 30) + (paid ? 18 : 0) + (recurring ? 18 : 0);
  return { score, reason: reasons.join(" · ") };
}
export function eligibleTasks(state: Workspace, day = bogotaDay()) {
  return state.tasks.filter((task) => task.approved && !task.isBlocked && !["completed", "cancelled", "inbox"].includes(task.status) && !closed.includes(state.projects.find((project) => project.id === task.projectId)?.operationalStatus ?? "Archivado"))
    .sort((a, b) => rankTask(b, state, day).score - rankTask(a, state, day).score || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.id.localeCompare(b.id));
}
export type PlanBlock = { projectId: string; taskId: string; title: string; startsAt: string; endsAt: string; reason: string };
export function planDay(state: Workspace, options: { day: string; start: string; end: string; breakMinutes: number; personId?: string }, now = new Date()) {
  const start = Date.parse(`${options.day}T${options.start}:00-05:00`);
  const end = Date.parse(`${options.day}T${options.end}:00-05:00`);
  const busy = state.calendar.filter((block) => block.status === "approved" && Date.parse(block.endsAt) > start && Date.parse(block.startsAt) < end).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const alreadyBooked = new Set(state.calendar.filter((block) => block.taskId && block.status !== "cancelled" && Date.parse(block.endsAt) > now.getTime() && (block.status === "approved" || dayOf(block.startsAt) !== options.day)).map((block) => block.taskId));
  const tasks = eligibleTasks(state, options.day).filter((task) => filterTaskPerson(state, task, options.personId ?? "mine") && !alreadyBooked.has(task.id));
  let cursor = Math.max(start, Math.ceil(now.getTime() / 900000) * 900000);
  const blocks: PlanBlock[] = []; const unscheduled: string[] = [];
  for (const task of tasks) {
    const duration = task.estimatedMinutes * 60000;
    let candidate = cursor;
    for (const occupied of busy) {
      const busyStart = Date.parse(occupied.startsAt), busyEnd = Date.parse(occupied.endsAt);
      if (candidate + duration <= busyStart) break;
      if (candidate < busyEnd && candidate + duration > busyStart) candidate = busyEnd + options.breakMinutes * 60000;
    }
    if (blocks.length >= 12 || candidate + duration > end) { unscheduled.push(task.id); continue; }
    blocks.push({ projectId: task.projectId, taskId: task.id, title: task.title, startsAt: new Date(candidate).toISOString(), endsAt: new Date(candidate + duration).toISOString(), reason: rankTask(task, state, options.day).reason });
    cursor = candidate + duration + options.breakMinutes * 60000;
  }
  return { blocks, unscheduled, busyCount: busy.length };
}
