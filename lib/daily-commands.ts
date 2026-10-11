import { buildCoreCommand, CoreValidationError, databaseRow, type CoreChange, type Row } from "./core-commands";
import { bogotaDay, dayOf, planDay } from "./daily-engine";
import type { Workspace } from "./workspace-types";
import { existingMeetingTask, FINDING_LABELS, type FindingKind } from "./meeting-analysis";
import { readMeeting } from "./meetings";

export const DAILY_ACTIONS = new Set(["create_inbox", "create_task_suggestion", "edit_suggestion", "suggestion_status", "generate_plan", "create_calendar", "update_calendar", "approve_calendar", "cancel_calendar"]);
const fail = (message: string, status = 400): never => { throw new CoreValidationError(message, status); };
function text(value: unknown, max = 2000) { if (typeof value !== "string") return ""; const result = value.trim(); if (result.length > max) fail(`El texto supera ${max} caracteres.`); return result; }
function required(value: unknown, label: string, max = 180) { return text(value, max) || fail(`${label} es obligatorio.`); }
function date(value: unknown) { const result = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T12:00:00Z`)) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) fail("La fecha no es válida."); return result; }
function time(value: unknown) { const result = text(value, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : fail("El horario no es válido."); }
function taskData(value: Row) { return { title: required(value.title, "El título"), description: text(value.description), priority: value.priority ?? 3, urgency: value.urgency ?? 3, estimatedMinutes: value.estimatedMinutes ?? 30, deadline: value.deadline || null, tentativeDeliveryDate: value.tentativeDeliveryDate ? date(value.tentativeDeliveryDate) : null, responsibleNames: Array.isArray(value.responsibleNames) ? value.responsibleNames.filter(n => typeof n === "string" && n.length <= 180).slice(0,5) : [], ...(value.primaryId !== undefined ? { primaryId: value.primaryId } : {}), ...(value.collaboratorIds !== undefined ? { collaboratorIds: value.collaboratorIds } : {}) }; }

export function buildDailyCommand(state: Workspace, userId: string, action: string, payload: Row, commandId: string, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  let changes: CoreChange[] = []; let id = ""; let projectId = "";
  const project = (value: unknown) => state.projects.find((item) => item.id === value) ?? fail("Selecciona un proyecto válido.", 404);
  const save = (table: string, row: Row, previous?: Row) => changes.push({ table, kind: previous ? "update" : "insert", row: databaseRow(row), ...(previous ? { expected: databaseRow(previous) } : {}) });
  const event = (owner: string, title: string, description: string, sourceId: string, eventId = commandId) => save("project_events", { id: eventId, userId, projectId: owner, eventType: "organization", title, description, sourceType: "manual", sourceId, eventDate: now, createdAt: now });
  const calendar = (value: Row, previous?: Workspace["calendar"][number]) => {
    const owner = project(previous?.projectId ?? value.projectId);
    const taskId = text(value.taskId ?? previous?.taskId, 100) || null;
    if (taskId && !state.tasks.some((task) => task.id === taskId && task.projectId === owner.id && task.approved && !task.isBlocked && !["completed", "cancelled"].includes(task.status))) fail("La tarea no está disponible para planificar.", 409);
    const startsAt = `${date(value.day)}T${time(value.start)}:00-05:00`, endsAt = `${date(value.day)}T${time(value.end)}:00-05:00`;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) fail("La hora final debe ser posterior a la inicial.");
    return { id: previous?.id ?? uuid(), userId, projectId: owner.id, taskId, title: required(value.title, "El título del bloque"), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), status: "proposed", createdAt: previous?.createdAt ?? now };
  };
  if (action === "create_inbox") {
    const content = required(payload.content, "La nota", 2000);
    const lower = content.toLocaleLowerCase("es");
    const matches = state.projects.filter((item) => lower.includes(item.name.toLocaleLowerCase("es")) || (item.shortCode.length >= 3 && new RegExp(`(?:^|\\W)${item.shortCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\W)`, "i").test(content)));
    const detectedProjectId = matches.length === 1 ? matches[0].id : null;
    id = commandId; projectId = detectedProjectId ?? "";
    save("inbox_items", { id, userId, content, inputType: payload.inputType === "voice" ? "voice" : "text", detectedProjectId, classification: detectedProjectId ? "Coincidencia por nombre · confirmar" : "Sin clasificar", status: "unprocessed", createdAt: now });
  } else if (action === "create_task_suggestion") {
    projectId = project(payload.projectId).id; id = commandId;
    const inbox = payload.inboxId ? state.inbox.find((item) => item.id === payload.inboxId) ?? fail("Nota no encontrada.", 404) : undefined;
    if (inbox?.status === "processed") fail("Esta nota ya tiene una propuesta. Revisa las aprobaciones.", 409);
    const data = taskData(payload);
    // Validate before saving a proposal; no task is created until approval.
    buildCoreCommand(state, userId, "create_task", { ...data, projectId }, uuid(), now, uuid);
    const evidence = text(inbox ? `Nota ${inbox.createdAt}: ${inbox.content}` : payload.evidence) || "Propuesta introducida manualmente";
    save("ai_suggestions", { id, userId, projectId, suggestionType: "new_task", title: data.title, reason: text(payload.reason) || "Acción propuesta por el usuario; requiere aprobación antes de crearla.", confidence: 100, evidence, impact: "Añadir una tarea pendiente al proyecto", status: "pending", payload: JSON.stringify({ action: "create_task", data, source: "manual", inboxId: inbox?.id ?? null }), createdAt: now });
    if (inbox) save("inbox_items", { ...inbox, detectedProjectId: projectId, classification: "Propuesta de tarea · pendiente de aprobación", status: "processed" }, inbox);
    event(projectId, "Propuesta de tarea registrada", data.title, id);
  } else if (["edit_suggestion", "suggestion_status"].includes(action)) {
    const previous = state.suggestions.find((item) => item.id === payload.id) ?? fail("Propuesta no encontrada.", 404);
    if (previous.status !== "pending") fail("Esta propuesta ya fue resuelta. Recarga para ver el resultado.", 409);
    projectId = project(payload.projectId ?? previous.projectId).id; id = previous.id;
    let stored: Row; try { stored = JSON.parse(previous.payload); } catch { stored = {}; }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
    const fromMeeting=typeof stored.meetingId==="string";
    if(fromMeeting && (projectId!==previous.projectId || !state.knowledge.some(item=>item.id===stored.meetingId&&item.projectId===projectId&&readMeeting(item)?.fingerprint===stored.meetingFingerprint))) fail("La propuesta debe conservar su reunión y proyecto de origen.",409);
    const recordFinding=fromMeeting && stored.action==="record_meeting_finding" && typeof stored.findingKind==="string" && Object.hasOwn(FINDING_LABELS,stored.findingKind) && stored.findingKind!=="task";
    if (action === "edit_suggestion") {
      const data = taskData({ ...((stored.data as Row) ?? {}), ...payload });
      if(data.deadline) date(data.deadline);
      if(!recordFinding) buildCoreCommand(state, userId, "create_task", { ...data, projectId }, uuid(), now, uuid);
      save("ai_suggestions", { ...previous, projectId, title: data.title, suggestionType: recordFinding?previous.suggestionType:"new_task", payload: JSON.stringify({ ...stored,action: recordFinding?"record_meeting_finding":"create_task", data, source: stored.source ?? "manual", inboxId: stored.inboxId ?? null }) }, previous);
      event(projectId, "Propuesta editada", `Pendiente de aprobación: ${data.title}`, id);
    } else {
      const status = text(payload.status);
      if (!["approved", "rejected"].includes(status)) fail("Elige aprobar o rechazar. Editar no debe resolver la propuesta.");
      if (status === "approved") {
        if(recordFinding) {
          const data=taskData({title:previous.title,...((stored.data as Row)??{})});
          if(data.deadline) date(data.deadline);
          event(projectId,`${FINDING_LABELS[stored.findingKind as FindingKind]} confirmada`,`${data.title}. ${data.description}${data.deadline?` Fecha mencionada: ${data.deadline}.`:""}\n${previous.evidence}`,stored.meetingId as string);
          const timeline=changes.find(change=>change.table==="project_events")!;timeline.row.event_type=`meeting_${stored.findingKind}`;timeline.row.source_type="meeting";
        } else {
        if (previous.suggestionType !== "new_task") fail("Esta propuesta antigua necesita completarse. Usa Editar para definir la acción o recházala.", 409);
        const data = taskData({ title: previous.title, ...((stored.data as Row) ?? {}) });
        if(fromMeeting && existingMeetingTask(state,projectId,data.title)) fail("Ya existe una tarea similar. Revisa la existente o rechaza esta propuesta.",409);
        const command = buildCoreCommand(state, userId, "create_task", { ...data, projectId, ...(fromMeeting ? { originMeetingId: stored.meetingId } : {}) }, commandId, now, uuid);
        changes = command.changes;
        const task = changes.find((change) => change.table === "tasks")!;
        task.row.source_type = "suggestion"; task.row.source_id = previous.id; task.row.ai_generated = stored.source === "openai";
        changes.find((change) => change.table === "project_events")!.row.description = `${data.title}. Propuesta aprobada. Evidencia: ${previous.evidence}`;
        }
      } else event(projectId, "Propuesta rechazada", previous.title, id);
      save("ai_suggestions", { ...previous, status }, previous);
    }
  } else if (action === "generate_plan") {
    const day = date(payload.day), start = time(payload.start), end = time(payload.end), breakMinutes = Number(payload.breakMinutes ?? 15);
    if (day < bogotaDay(new Date(now))) fail("Selecciona hoy o una fecha futura.");
    if (end <= start || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 60) fail("Revisa el rango horario y las pausas (0–60 minutos).");
    const result = planDay(state, { day, start, end, breakMinutes }, new Date(now));
    if (!result.blocks.length) fail("No hay tareas disponibles que quepan en ese horario. Amplía el rango o revisa sus bloqueos.", 409);
    const previous = state.calendar.filter((block) => block.status === "proposed" && dayOf(block.startsAt) === day);
    if (previous.length > 60) fail("Resuelve las propuestas anteriores antes de generar otra planificación.", 409);
    for (const block of previous) save("calendar_blocks", { ...block, status: "cancelled" }, block);
    for (const block of result.blocks) { const row = { ...block, id: uuid(), userId, status: "proposed", createdAt: now }; const { reason: _reason, ...record } = row; save("calendar_blocks", record); id ||= row.id; }
    const owners = [...new Set(result.blocks.map((block) => block.projectId))]; projectId = owners[0];
    owners.forEach((owner, index) => event(owner, "Plan del día propuesto", `${day}: ${result.blocks.filter((block) => block.projectId === owner).map((block) => `${block.title} (${block.reason})`).join("; ")}. Los bloques aprobados se conservan. ${result.unscheduled.length} tareas sin horario en esta propuesta.`, id, index === 0 ? commandId : uuid()));
  } else if (action === "create_calendar" || action === "update_calendar") {
    const previous = action === "update_calendar" ? state.calendar.find((item) => item.id === payload.id) ?? fail("Bloque no encontrado.", 404) : undefined;
    if (previous && previous.status !== "proposed") fail("Solo se editan propuestas. Cancela el bloque aprobado y crea una nueva propuesta para cambiar su horario.", 409);
    const row = calendar(payload, previous); id = row.id; projectId = row.projectId;
    save("calendar_blocks", row, previous); event(projectId, previous ? "Propuesta de horario editada" : "Bloque propuesto", `${row.title}: ${row.startsAt} → ${row.endsAt}. Pendiente de aprobación.`, id);
  } else if (action === "approve_calendar" || action === "cancel_calendar") {
    const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.map((value) => text(value, 100)))] : [text(payload.id, 100)];
    if (!ids.length || ids.length > 40 || ids.some((value) => !value)) fail("Selecciona entre 1 y 40 bloques.");
    const blocks = ids.map((id) => state.calendar.find((item) => item.id === id) ?? fail("Bloque no encontrado.", 404));
    if (action === "approve_calendar") {
      if (blocks.some((block) => block.status !== "proposed")) fail("Solo se aprueban bloques pendientes.", 409);
      const approved = state.calendar.filter((block) => block.status === "approved");
      blocks.forEach((block, index) => {
        if (block.taskId && !state.tasks.some((task) => task.id === block.taskId && task.approved && !task.isBlocked && !["completed", "cancelled"].includes(task.status))) fail("Una tarea del plan ya no está disponible. Revisa la propuesta.", 409);
        if ([...approved, ...blocks.slice(0, index)].some((other) => Date.parse(block.startsAt) < Date.parse(other.endsAt) && Date.parse(block.endsAt) > Date.parse(other.startsAt))) fail("Hay bloques que se solapan. Edita sus horarios antes de aprobar.", 409);
      });
    } else if (blocks.some((block) => block.status === "cancelled")) fail("Este bloque ya fue cancelado.", 409);
    for (const block of blocks) save("calendar_blocks", { ...block, status: action === "approve_calendar" ? "approved" : "cancelled" }, block);
    id = blocks[0].id; projectId = blocks[0].projectId;
    [...new Set(blocks.map((block) => block.projectId))].forEach((owner, index) => event(owner, action === "approve_calendar" ? "Bloques aprobados" : "Bloques cancelados", blocks.filter((block) => block.projectId === owner).map((block) => `${block.title}: ${block.startsAt} → ${block.endsAt}`).join("; ") + ". Calendario interno; sin escritura en Google Calendar.", id, index === 0 ? commandId : uuid()));
  } else fail("Acción diaria no soportada.");
  return { id, projectId, changes };
}
