import type { Workspace } from "./workspace-types";
import { taskMeeting, projectMeetings } from "./task-timing";
import { bogotaDay } from "./daily-engine";
import { operationsFor, operationsRecord, detailFor, type TaskDetail } from "./project-operations";

export const CORE_ACTIONS = new Set(["create_project", "update_project", "create_milestone", "update_milestone", "create_task", "update_task", "update_task_status", "update_financials", "record_payment"]);
export const PROJECT_STATUSES = ["Por iniciar", "Activo", "Negociación", "Pausado", "Soporte", "Finalizado", "Cancelado", "Archivado"];
export const PROJECT_TYPES = ["Por alcance", "Recurrente", "Producto", "Propio", "Soporte", "Operación", "Negociación", "Contenido"];
export const COMMERCIAL_STATUSES = ["Sin definir", "Propuesta enviada", "Pendiente de pago", "Pago parcial", "Pagado", "Recurrente", "Propio", "Interno"];
export const TASK_STATUSES = ["inbox", "pending", "ready", "in_progress", "blocked", "review", "completed", "cancelled"];
export const MILESTONE_STATUSES = ["pending", "in_progress", "blocked", "completed", "cancelled"];
export type Row = Record<string, unknown>;
export type CoreChange = { table: string; kind: "insert" | "update" | "delete"; row: Row; expected?: Row };
export class CoreValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "CoreValidationError"; }
}
const fail = (message: string, status = 400): never => { throw new CoreValidationError(message, status); };
function text(value: unknown, max = 2000) { if (typeof value !== "string") return ""; const result = value.trim(); if (result.length > max) fail(`El texto supera ${max} caracteres.`); return result; }
function required(value: unknown, label: string, max = 180) { return text(value, max) || fail(`${label} es obligatorio.`); }
function choice(value: unknown, options: string[], fallback: string) { const result = value === undefined ? fallback : text(value, 40); return options.includes(result) ? result : fail("La opción seleccionada no es válida."); }
function integer(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) { const result = value === undefined ? fallback : Number(value); return Number.isSafeInteger(result) && result >= min && result <= max ? result : fail(`Introduce un número entero entre ${min} y ${max}.`); }
function date(value: unknown) { const result = text(value, 10); if (!result) return null; const parsed = new Date(`${result}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail("La fecha no es válida."); return result; }
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
export const databaseRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [snake(key), value]));
function describeChanges(previous: Row, row: Row, fields: Record<string, string>) {
  const changed = Object.entries(fields).filter(([key]) => previous[key] !== row[key]);
  return changed.map(([key, label]) => `${label}: ${previous[key] || "sin definir"} → ${row[key] || "sin definir"}`).join(". ") || "Sin cambios en los campos editables.";
}
function ensureFresh(previous: Row | undefined, payload: Row) {
  if (previous && payload.updatedAt !== undefined && payload.updatedAt !== previous.updatedAt) fail("Este registro cambió mientras lo editabas. Cierra el formulario, recarga y vuelve a intentarlo.", 409);
}

export function buildCoreCommand(state: Workspace, userId: string, action: string, payload: Row, commandId: string, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  const changes: CoreChange[] = [];
  let id = ""; let projectId = ""; let eventType = ""; let title = ""; let description = "";
  const save = (table: string, row: Row, previous?: Row) => {
    if (table === "project_operations" && new TextEncoder().encode(String(row.data)).length > 2 * 1024 * 1024) fail("El proyecto alcanzó el límite de datos de colaboración.");
    const expected = previous ? (table === "project_operations" ? { data: previous.data, updatedAt: previous.updatedAt } : "updatedAt" in previous ? { updatedAt: previous.updatedAt } : previous) : undefined;
    changes.push({ table, kind: previous ? "update" : "insert", row: databaseRow(row), ...(expected ? { expected: databaseRow(expected) } : {}) });
  };
  const project = (value: unknown) => state.projects.find((item) => item.id === value) ?? fail("Proyecto no encontrado.", 404);
  const task = (value: unknown) => state.tasks.find((item) => item.id === value) ?? fail("Tarea no encontrada.", 404);

  if (action === "create_project" || action === "update_project") {
    const previous = action === "update_project" ? project(payload.id) : undefined;
    ensureFresh(previous, payload);
    id = previous?.id ?? uuid(); projectId = id;
    const value = { ...previous, ...payload };
    const name = required(value.name, "El nombre");
    const shortCode = text(value.shortCode, 8) || name.slice(0, 4).toUpperCase();
    const row = { id, userId, name, shortCode, description: text(value.description), projectType: choice(value.projectType, PROJECT_TYPES, "Por alcance"), operationalStatus: choice(value.operationalStatus, PROJECT_STATUSES, "Por iniciar"), commercialStatus: choice(value.commercialStatus, COMMERCIAL_STATUSES, "Sin definir"), priority: integer(value.priority, 3, 1, 5), strategicPriority: integer(value.strategicPriority, 3, 1, 5), targetEndDate: date(value.targetEndDate), currentSummary: text(value.currentSummary), nextStepSummary: text(value.nextStepSummary), blockedReason: text(value.blockedReason) || null, accent: choice(value.accent, ["lime", "blue", "violet", "orange", "cyan", "pink", "yellow", "red", "gray", "green"], "blue"), createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (row.operationalStatus === "Finalizado" && state.tasks.some((item) => item.projectId === id && !["completed", "cancelled"].includes(item.status))) fail("Completa o cancela las tareas antes de finalizar el proyecto.", 409);
    save("projects", row, previous);
    const operationData = operationsFor(state, id), priorOperations = operationsRecord(state, id);
    const priorSchedule = operationData.schedule ?? { plannedStart: null, actualStart: null };
    const schedule = {
      plannedStart: payload.projectPlannedStart === undefined ? priorSchedule.plannedStart : date(payload.projectPlannedStart),
      actualStart: payload.projectActualStart === undefined ? priorSchedule.actualStart : date(payload.projectActualStart),
    };
    if (schedule.plannedStart && row.targetEndDate && schedule.plannedStart > row.targetEndDate) fail("La finalización debe ser igual o posterior al inicio planificado.");
    if (schedule.actualStart && schedule.actualStart > bogotaDay(new Date(now))) fail("El inicio real no puede estar en el futuro.");
    let scheduleDescription = "";
    if (schedule.plannedStart !== priorSchedule.plannedStart || schedule.actualStart !== priorSchedule.actualStart) {
      if (payload.operationsUpdatedAt !== undefined && payload.operationsUpdatedAt !== (priorOperations?.updatedAt ?? null)) fail("Las fechas del proyecto cambiaron. Recarga antes de guardar.", 409);
      operationData.schedule = schedule; operationData.revision += 1;
      save("project_operations", { id: priorOperations?.id ?? id, userId, projectId: id, data: JSON.stringify(operationData), updatedAt: now }, priorOperations);
      scheduleDescription = describeChanges(priorSchedule, schedule, { plannedStart: "Inicio planificado", actualStart: "Inicio real" });
    }
    eventType = "project"; title = previous ? "Proyecto actualizado" : "Proyecto creado";
    description = previous ? describeChanges(previous, row, { name: "Nombre", shortCode: "Código", description: "Objetivo", projectType: "Tipo", operationalStatus: "Estado", commercialStatus: "Estado comercial", priority: "Prioridad", strategicPriority: "Prioridad estratégica", targetEndDate: "Fecha", currentSummary: "Estado actual", nextStepSummary: "Siguiente acción", blockedReason: "Bloqueador" }) : `${name}. ${row.description}`;
    if (scheduleDescription) description += `. ${scheduleDescription}`;
  } else if (action === "create_milestone" || action === "update_milestone") {
    const previous = action === "update_milestone" ? state.milestones.find((item) => item.id === payload.id) ?? fail("Hito no encontrado.", 404) : undefined;
    projectId = project(previous?.projectId ?? payload.projectId).id; id = previous?.id ?? uuid();
    const value = { ...previous, ...payload };
    const status = choice(value.status, MILESTONE_STATUSES, "pending");
    if (status === "completed" && state.tasks.some((item) => item.milestoneId === id && !["completed", "cancelled"].includes(item.status))) fail("Completa o cancela las tareas pendientes antes de cerrar el hito.", 409);
    const row = { id, userId, projectId, name: required(value.name, "El nombre del hito"), description: text(value.description), status, targetDate: date(value.targetDate), completedAt: status === "completed" ? previous?.completedAt ?? now : null, position: integer(value.position, state.milestones.filter((item) => item.projectId === projectId).length + 1, 0, 10000) };
    save("milestones", row, previous); eventType = "milestone"; title = previous ? "Hito actualizado" : "Hito creado"; description = previous ? describeChanges(previous, row, { name: "Hito", description: "Resultado", status: "Estado", targetDate: "Fecha", position: "Orden" }) : `${row.name} · ${status}`;
  } else if (["create_task", "update_task", "update_task_status"].includes(action)) {
    const previous = action !== "create_task" ? task(payload.id) : undefined;
    ensureFresh(previous, payload);
    projectId = project(previous?.projectId ?? payload.projectId).id; id = previous?.id ?? uuid();
    const value = { ...previous, ...payload };
    const milestoneId = text(value.milestoneId, 100) || null;
    const originalMeetingId = previous ? previous.originMeetingId || taskMeeting(state, previous)?.item.id || null : null;
    const requestedMeetingId = payload.originMeetingId === undefined ? originalMeetingId : text(payload.originMeetingId, 100) || null;
    if (originalMeetingId && requestedMeetingId !== originalMeetingId) fail("Se conserva la reunión original en la que surgió la tarea.", 409);
    if (requestedMeetingId && !projectMeetings(state, userId, projectId).some(entry => entry.item.id === requestedMeetingId)) fail("Selecciona una reunión de este proyecto.", 404);
    if (milestoneId && !state.milestones.some((item) => item.id === milestoneId && item.projectId === projectId)) fail("El hito no pertenece a este proyecto.");
    const status = choice(value.status, TASK_STATUSES, "pending");
    const currentEdges = state.dependencies.filter((edge) => edge.taskId === id);
    const dependencyIds = payload.dependsOnTaskIds === undefined ? currentEdges.map((edge) => edge.dependsOnTaskId) : Array.isArray(payload.dependsOnTaskIds) ? [...new Set(payload.dependsOnTaskIds.map((value) => text(value, 100)))] : fail("Las dependencias no son válidas.");
    if (dependencyIds.length > 40) fail("Una tarea puede tener hasta 40 dependencias.");
    for (const dependencyId of dependencyIds) { const parent = task(dependencyId); if (parent.id === id || parent.projectId !== projectId) fail("Una dependencia debe ser otra tarea del mismo proyecto."); }
    const graph = state.dependencies.filter((edge) => edge.taskId !== id).concat(dependencyIds.map((parent) => ({ id: uuid(), userId, taskId: id, dependsOnTaskId: parent, dependencyType: "finish_to_start" })));
    const reaches = (node: string, visited = new Set<string>()): boolean => { if (node === id) return true; if (visited.has(node)) return false; visited.add(node); return graph.filter((edge) => edge.taskId === node).some((edge) => reaches(edge.dependsOnTaskId, visited)); };
    if (dependencyIds.some((parent) => reaches(parent))) fail("La dependencia produciría un ciclo.");
    if (["in_progress", "review", "completed"].includes(status) && dependencyIds.some((parent) => task(parent).status !== "completed")) fail("Completa las tareas de las que depende antes de avanzar.", 409);
    if (milestoneId && !["completed", "cancelled"].includes(status) && state.milestones.find((item) => item.id === milestoneId)?.status === "completed") fail("Reabre el hito antes de añadir trabajo pendiente.", 409);
    const blockingReason = status === "blocked" ? text(value.blockingReason) || "Bloqueo manual" : null;
    const row = { id, userId, projectId, milestoneId, parentTaskId: previous?.parentTaskId ?? null, title: required(value.title, "El título"), description: text(value.description), status, priority: integer(value.priority, 3, 1, 5), urgency: integer(value.urgency, 3, 1, 5), estimatedMinutes: integer(value.estimatedMinutes, 30, 1, 10080), deadline: date(value.deadline), tentativeDeliveryDate: date(value.tentativeDeliveryDate), originMeetingId: requestedMeetingId, scheduledStart: previous?.scheduledStart ?? null, scheduledEnd: previous?.scheduledEnd ?? null, isBlocked: status === "blocked", blockingReason, sourceType: previous?.sourceType ?? "manual", sourceId: previous?.sourceId ?? null, aiGenerated: previous?.aiGenerated ?? false, approved: previous?.approved ?? true, completedAt: status === "completed" ? previous?.completedAt ?? now : null, createdAt: previous?.createdAt ?? now, updatedAt: now };
    save("tasks", row, previous);
    const operationData = operationsFor(state, projectId), priorDetail = detailFor(operationData, id);
    if (["primaryId", "collaboratorIds", "plannedStart", "plannedEnd", "columnId"].some(key => payload[key] !== undefined) || priorDetail.columnId && operationData.columns.find(c => c.id === priorDetail.columnId)?.status !== status) {
      const priorOperations = operationsRecord(state, projectId);
      if (payload.operationsUpdatedAt !== undefined && payload.operationsUpdatedAt !== (priorOperations?.updatedAt ?? null)) fail("Las asignaciones cambiaron. Recarga antes de guardar.", 409);
      const validPerson = (value: unknown) => operationData.people.find(p => p.id === value && p.active)?.id ?? fail("Selecciona una persona activa del proyecto.");
      const primaryId = payload.primaryId === undefined ? priorDetail.primaryId : payload.primaryId ? validPerson(payload.primaryId) : null;
      const collaboratorIds = payload.collaboratorIds === undefined ? priorDetail.collaboratorIds : Array.isArray(payload.collaboratorIds) ? [...new Set(payload.collaboratorIds.map(validPerson))] : fail("Los colaboradores no son válidos.");
      if (collaboratorIds.length > 20 || primaryId && collaboratorIds.includes(primaryId)) fail("El responsable principal debe ser distinto de los colaboradores (máximo 20).");
      const plannedStart = payload.plannedStart === undefined ? priorDetail.plannedStart : date(payload.plannedStart);
      const plannedEnd = payload.plannedEnd === undefined ? priorDetail.plannedEnd : date(payload.plannedEnd);
      if (!!plannedStart !== !!plannedEnd || plannedStart && plannedEnd && plannedEnd < plannedStart) fail("Define inicio y fin planificados; el fin no puede ser anterior al inicio.");
      const requestedColumn = payload.columnId === undefined ? priorDetail.columnId : text(payload.columnId, 100) || null;
      const selectedColumn = operationData.columns.find(c => c.id === requestedColumn);
      if (payload.columnId && (!selectedColumn || selectedColumn.status !== status)) fail("La columna no corresponde al estado de la tarea.");
      const detail: TaskDetail = { primaryId, collaboratorIds, plannedStart, plannedEnd, columnId: selectedColumn?.status === status ? selectedColumn.id : null };
      operationData.taskDetails[id] = detail;
      operationData.revision++;
      save("project_operations", { id: priorOperations?.id ?? projectId, userId, projectId, data: JSON.stringify(operationData), updatedAt: now }, priorOperations);
    }
    if (payload.dependsOnTaskIds !== undefined) {
      for (const edge of currentEdges) changes.push({ table: "task_dependencies", kind: "delete", row: { id: edge.id, user_id: userId }, expected: databaseRow(edge) });
      for (const parent of dependencyIds) save("task_dependencies", { id: uuid(), userId, taskId: id, dependsOnTaskId: parent, dependencyType: "finish_to_start" });
    }
    eventType = "task"; title = previous ? "Tarea actualizada" : "Tarea creada";
    description = previous ? `${row.title}. ${describeChanges(previous, row, { title: "Título", description: "Descripción", status: "Estado", priority: "Prioridad", urgency: "Urgencia", estimatedMinutes: "Minutos", deadline: "Fecha límite", tentativeDeliveryDate: "Entrega tentativa", originMeetingId: "Reunión de origen", milestoneId: "Hito", blockingReason: "Bloqueo" })}` : `${row.title} · ${status}${row.tentativeDeliveryDate ? ` · Entrega tentativa: ${row.tentativeDeliveryDate}` : ""}`;
    if (payload.dependsOnTaskIds !== undefined) description += `. Dependencias: ${dependencyIds.map((parent) => task(parent).title).join(", ") || "ninguna"}`;
    if (changes.some(c => c.table === "project_operations")) { const d = operationData.taskDetails[id]; description += `. Responsable: ${operationData.people.find(p => p.id === d.primaryId)?.name ?? "sin asignar"}. Colaboradores: ${d.collaboratorIds.map(personId => operationData.people.find(p => p.id === personId)?.name).join(", ") || "ninguno"}. Planificado: ${d.plannedStart ?? "sin fecha"} → ${d.plannedEnd ?? "sin fecha"}.`; }
  } else if (action === "update_financials" || action === "record_payment") {
    projectId = project(payload.projectId).id;
    const previous = state.financials.find((item) => item.projectId === projectId);
    if (operationsFor(state, projectId).agreements.some(a => a.legacy)) fail("El saldo anterior ya pertenece a un acuerdo. Usa las cuotas y revisiones del acuerdo.", 409);
    if (action === "record_payment" && !previous) fail("Define primero el valor y la moneda del proyecto.");
    const totalValue = action === "record_payment" ? previous!.totalValue : integer(payload.totalValue, previous?.totalValue ?? 0, 0);
    const currency = text(action === "record_payment" ? previous!.currency : payload.currency ?? previous?.currency ?? "COP", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail("La moneda debe tener un código de tres letras.");
    try { new Intl.NumberFormat("es-CO", { style: "currency", currency }); } catch { fail("Moneda no válida."); }
    if (previous && previous.amountPaid > 0 && currency !== previous.currency) fail("No cambies la moneda de pagos ya registrados.");
    const amount = action === "record_payment" ? integer(payload.amount, 0, 1) : 0;
    const amountPaid = action === "record_payment" ? previous!.amountPaid + amount : previous?.amountPaid ?? 0;
    if (!Number.isSafeInteger(amountPaid) || amountPaid > totalValue) fail("El pago acumulado no puede superar el valor del proyecto.");
    id = previous?.id ?? uuid();
    const row = { id, userId, projectId, totalValue, currency, amountPaid, amountPending: totalValue - amountPaid, paymentStatus: totalValue === 0 ? "not_applicable" : amountPaid === totalValue ? "paid" : amountPaid > 0 ? "partial" : "pending", paymentStructure: text(action === "record_payment" ? previous?.paymentStructure : payload.paymentStructure ?? previous?.paymentStructure), notes: text(action === "record_payment" ? previous?.notes : payload.notes ?? previous?.notes) };
    save("project_financials", row, previous); eventType = action === "record_payment" ? "payment" : "financial"; title = action === "record_payment" ? "Pago registrado" : "Condiciones de pago actualizadas";
    description = action === "record_payment" ? `${amount} ${currency} · Fecha: ${date(payload.paymentDate) ?? now.slice(0, 10)} · ${text(payload.reference, 500)} · Acumulado: ${amountPaid} · Pendiente: ${row.amountPending}` : `Valor: ${totalValue} ${currency}. Recibido: ${amountPaid}. Pendiente: ${row.amountPending}. ${row.paymentStructure}`;
  } else fail("Acción no soportada.");
  const event = { id: commandId, userId, projectId, eventType, title, description, sourceType: "manual", sourceId: id, eventDate: now, createdAt: now };
  save("project_events", event);
  return { id, projectId, changes };
}
