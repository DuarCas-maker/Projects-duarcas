import { buildCoreCommand, CoreValidationError, databaseRow, type CoreChange, type Row } from "./core-commands";
import type { Workspace } from "./workspace-types";
import { operationsRecord } from "./project-operations";

export const NOTEBOOK_CLASSIFICATION = "Bloc de notas";
export const NOTEBOOK_MAX_TEXT = 12000;
export const NOTEBOOK_ACTIONS = ["create_task", "update_task", "create_milestone", "update_milestone", "update_project", "record_decision"] as const;
export type NotebookAction = typeof NOTEBOOK_ACTIONS[number];
export type NotebookQuestion = { id: string; text: string; options: { A: string; B: string; C: string } };
export type NotebookAnswer = { questionId: string; selected: string[]; text: string };
export type NotebookProposal = { projectId: string; action: NotebookAction; targetId: string | null; title: string; reason: string; quote: string; changes: { field: string; value: string | null }[] };
export type NotebookResult = { summary: string; questions: NotebookQuestion[]; proposals: NotebookProposal[] };
export type NotebookRound = { id: string; createdAt: string; answers: NotebookAnswer[]; result: NotebookResult; memory?: { status: string; warning?: string }; coverage?: string };
export const notebookFields: Record<NotebookAction, string[]> = {
  create_task: ["title", "description", "priority", "urgency", "estimatedMinutes", "deadline", "tentativeDeliveryDate", "primaryId", "milestoneId", "criteria"],
  update_task: ["title", "description", "status", "priority", "urgency", "estimatedMinutes", "deadline", "tentativeDeliveryDate", "primaryId", "milestoneId", "blockingReason", "criteria"],
  create_milestone: ["name", "description", "targetDate"],
  update_milestone: ["name", "description", "targetDate", "status"],
  update_project: ["description", "currentSummary", "nextStepSummary", "operationalStatus", "priority", "targetEndDate", "blockedReason", "projectPlannedStart"],
  record_decision: ["description"],
};
export const notebookFieldLabels: Record<string, string> = { title: "Título", name: "Nombre", description: "Descripción", status: "Estado", priority: "Prioridad (1–5)", urgency: "Urgencia (1–5)", estimatedMinutes: "Duración en minutos", deadline: "Fecha límite", tentativeDeliveryDate: "Entrega tentativa", primaryId: "Responsable", milestoneId: "Hito", criteria: "Criterios de finalización", targetDate: "Fecha del hito", targetEndDate: "Fecha final del proyecto", blockingReason: "Motivo del bloqueo", blockedReason: "Bloqueo del proyecto", operationalStatus: "Estado del proyecto", currentSummary: "Resumen actual", nextStepSummary: "Próximos pasos", projectPlannedStart: "Inicio planificado" };
export const notebookActionLabels: Record<NotebookAction, string> = { create_task: "Crear tarea", update_task: "Actualizar tarea", create_milestone: "Crear hito", update_milestone: "Actualizar hito", update_project: "Actualizar proyecto", record_decision: "Registrar decisión" };
function fail(message: string, status = 400): never { throw new CoreValidationError(message, status); }
const txt = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function isNotebookNote(note: Workspace["inbox"][number]) { return note.classification === NOTEBOOK_CLASSIFICATION; }
export function notebookEvidence(note: string, rounds: NotebookRound[], answers: NotebookAnswer[]) {
  const selected = (prior: NotebookRound | undefined, values: NotebookAnswer[]) => values.flatMap(a => [a.text, ...a.selected.filter(o => o !== "D").map(o => prior?.result.questions.find(q => q.id === a.questionId)?.options[o as "A" | "B" | "C"] ?? "")]);
  return [note, ...rounds.flatMap((r, i) => selected(rounds[i - 1], r.answers)), ...selected(rounds.at(-1), answers)].join("\n");
}

export function validateNotebookAnswers(questions: NotebookQuestion[], value: unknown): NotebookAnswer[] {
  if (!Array.isArray(value) || value.length !== questions.length) fail("Responde todas las preguntas de esta ronda.");
  return questions.map(question => {
    const matches = (value as NotebookAnswer[]).filter(answer => answer?.questionId === question.id);
    if (matches.length !== 1) fail("Cada pregunta debe tener una respuesta.");
    const answer = matches[0];
    if (!Array.isArray(answer.selected) || !answer.selected.length || answer.selected.length > 4 || new Set(answer.selected).size !== answer.selected.length || answer.selected.some(option => !["A", "B", "C", "D"].includes(option)) || typeof answer.text !== "string" || answer.text.length > 2000 || answer.selected.includes("D") && !answer.text.trim()) fail("Selecciona A, B o C, o escribe tu respuesta en D.");
    return { questionId: question.id, selected: answer.selected, text: answer.text.trim() };
  });
}
export function notebookTarget(state: Workspace, proposal: Pick<NotebookProposal, "action" | "projectId" | "targetId">): Row | undefined {
  if (proposal.action === "update_project") return state.projects.find(p => p.id === proposal.targetId && p.id === proposal.projectId);
  if (proposal.action === "update_task") return state.tasks.find(t => t.id === proposal.targetId && t.projectId === proposal.projectId);
  if (proposal.action === "update_milestone") return state.milestones.find(m => m.id === proposal.targetId && m.projectId === proposal.projectId);
}
export function notebookData(proposal: NotebookProposal): Row {
  const data: Row = {};
  for (const change of proposal.changes) {
    if (!notebookFields[proposal.action]?.includes(change.field) || Object.hasOwn(data, change.field)) fail("La propuesta contiene un campo no permitido o repetido.");
    if (change.value !== null && typeof change.value !== "string") fail("Valor de propuesta no válido.");
    if (typeof change.value === "string" && change.value.length > 2000) fail("Un campo supera 2000 caracteres.");
    if (["priority", "urgency", "estimatedMinutes"].includes(change.field)) {
      if (change.value === null || !/^\d+$/.test(change.value)) fail("La propuesta necesita un número entero válido.");
      data[change.field] = Number(change.value);
    } else data[change.field] = change.value;
  }
  return data;
}
function taskDescription(state: Workspace, proposal: NotebookProposal, data: Row) {
  if (data.criteria !== undefined) {
    const prior = notebookTarget(state, proposal);
    data.description = `${data.description ?? prior?.description ?? ""}\n\nCriterios de finalización: ${data.criteria ?? ""}`.trim();
    delete data.criteria;
  }
}
function duplicateTask(state: Workspace, proposal: NotebookProposal, data: Row) {
  const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (proposal.action === "create_task" && state.tasks.some(t => t.projectId === proposal.projectId && !["cancelled"].includes(t.status) && normalize(t.title) === normalize(String(data.title ?? proposal.title)))) fail("Ya existe una tarea con este título. Propón actualizarla o cambia el título.", 409);
}
export function buildNotebookAction(state: Workspace, userId: string, proposal: NotebookProposal, commandId: string, noteId: string, now = new Date().toISOString()) {
  if (!NOTEBOOK_ACTIONS.includes(proposal.action) || !state.projects.some(p => p.id === proposal.projectId && p.userId === userId)) fail("Acción o proyecto de la propuesta no válido.");
  const data = notebookData(proposal);
  if (proposal.action === "create_task" && ["title", "description", "priority", "urgency", "estimatedMinutes", "criteria"].some(field => data[field] === undefined || data[field] === null || data[field] === "")) fail("La tarea necesita título, descripción, prioridad, urgencia, duración y criterios de finalización.");
  if (proposal.action.startsWith("update_") && !notebookTarget(state, proposal)) fail("El registro a actualizar no pertenece a este proyecto.", 404);
  if (!proposal.action.startsWith("update_") && proposal.targetId !== null) fail("Una acción nueva no debe tener un registro de destino.");
  taskDescription(state, proposal, data); duplicateTask(state, proposal, data);
  if (proposal.action === "record_decision") {
    if (!txt(data.description, 2000)) fail("La decisión necesita una descripción.");
    return { id: commandId, projectId: proposal.projectId, changes: [{ table: "project_events", kind: "insert" as const, row: databaseRow({ id: commandId, userId, projectId: proposal.projectId, eventType: "decision", title: proposal.title, description: data.description, sourceType: "notebook", sourceId: noteId, eventDate: now, createdAt: now }) }] };
  }
  const plan = buildCoreCommand(state, userId, proposal.action, { ...data, ...(proposal.targetId ? { id: proposal.targetId } : {}), projectId: proposal.projectId }, commandId, now, () => commandId + "-record");
  const event = plan.changes.find(c => c.table === "project_events")!;
  event.row.source_type = "notebook"; event.row.source_id = noteId;
  return plan;
}
export function validateNotebookResult(value: unknown, state: Workspace, userId: string, evidence: string, firstRound: boolean): NotebookResult {
  if (!value || typeof value !== "object") fail("La IA no devolvió un análisis válido.", 502);
  const result = value as NotebookResult;
  if (!txt(result.summary, 4000) || !Array.isArray(result.questions) || result.questions.length > 8 || !Array.isArray(result.proposals) || result.proposals.length > 16 || result.questions.length && result.proposals.length || firstRound && !result.questions.length) fail("La IA debe hacer preguntas antes de preparar las propuestas.", 502);
  const seen = new Set<string>();
  for (const question of result.questions) {
    if (!txt(question.id, 80) || seen.has(question.id) || !txt(question.text, 1500) || !question.options || Object.keys(question.options).sort().join("") !== "ABC" || !Object.values(question.options).every(option => txt(option, 500))) fail("El bloque de preguntas no tiene el formato A/B/C/D esperado.", 502);
    seen.add(question.id);
  }
  seen.clear();
  for (const proposal of result.proposals) {
    if (!txt(proposal.title, 180) || !txt(proposal.reason, 1500) || !txt(proposal.quote, 1000) || !evidence.includes(proposal.quote) || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 15) fail("Una propuesta carece de evidencia verificable o de campos válidos.", 502);
    buildNotebookAction(state, userId, proposal, "validation", "validation");
    const data = notebookData(proposal);
    const key = `${proposal.projectId}:${proposal.action}:${proposal.targetId ?? String(data.title ?? data.name ?? proposal.title).toLocaleLowerCase("es")}`;
    if (seen.has(key)) fail("La IA propuso cambios repetidos. Consolida la propuesta.", 502);
    seen.add(key);
  }
  return result;
}
export function notebookSnapshot(state: Workspace, proposal: NotebookProposal) {
  return { target: notebookTarget(state, proposal) ?? null, operations: operationsRecord(state, proposal.projectId)?.updatedAt ?? null };
}
export function buildNotebookProposals(state: Workspace, userId: string, note: Workspace["inbox"][number], round: NotebookRound) {
  if (note.userId !== userId || !isNotebookNote(note) || note.status === "processed") fail("Esta nota ya fue enviada a Aprobaciones o no está disponible.", 409);
  if (round.result.questions.length || !round.result.proposals.length) fail("Responde las preguntas antes de enviar propuestas.", 409);
  const changes: CoreChange[] = [];
  round.result.proposals.forEach((proposal, index) => {
    buildNotebookAction(state, userId, proposal, `${round.id}-${index}`, note.id);
    const id = `${round.id}-${index}`, now = new Date().toISOString();
    changes.push({ table: "ai_suggestions", kind: "insert", row: databaseRow({ id, userId, projectId: proposal.projectId, suggestionType: `notebook_${proposal.action}`, title: proposal.title, reason: proposal.reason, confidence: 0, evidence: `Bloc · ${note.createdAt}\n${proposal.quote}`, impact: notebookActionLabels[proposal.action], status: "pending", payload: JSON.stringify({ source: "notebook", action: proposal.action, notebookId: note.id, runId: round.id, proposal, snapshot: notebookSnapshot(state, proposal) }), createdAt: now }) });
    changes.push({ table: "project_events", kind: "insert", row: databaseRow({ id: `${id}-event`, userId, projectId: proposal.projectId, eventType: "organization", title: "Propuesta del bloc", description: `${notebookActionLabels[proposal.action]}: ${proposal.title}`, sourceType: "notebook", sourceId: note.id, eventDate: now, createdAt: now }) });
  });
  changes.push({ table: "inbox_items", kind: "update", row: databaseRow({ ...note, status: "processed" }), expected: databaseRow(note) });
  return { id: round.id, changes };
}
export function buildNotebookReview(state: Workspace, userId: string, action: string, payload: Row, commandId: string, now: string) {
  const previous = state.suggestions.find(s => s.id === payload.id && s.userId === userId);
  if (!previous || previous.status !== "pending") fail("La propuesta ya fue resuelta o no existe.", 409);
  const stored = JSON.parse(previous.payload) as { source: string; notebookId: string; proposal: NotebookProposal; snapshot: ReturnType<typeof notebookSnapshot> };
  const note = state.inbox.find(n => n.id === stored.notebookId && n.userId === userId && isNotebookNote(n));
  if (!note || stored.source !== "notebook" || stored.proposal.projectId !== previous.projectId) fail("No se encuentra la nota original de la propuesta.", 409);
  let proposal = stored.proposal;
  let changes: CoreChange[] = [];
  if (action === "edit_suggestion") {
    if (payload.projectId !== undefined && payload.projectId !== previous.projectId) fail("Se conserva el proyecto de origen.", 409);
    if (!Array.isArray(payload.changes) || !txt(payload.title, 180)) fail("Completa el título y los campos de la propuesta.");
    proposal = { ...proposal, title: String(payload.title).trim(), changes: payload.changes as NotebookProposal["changes"] };
    buildNotebookAction(state, userId, proposal, commandId, note.id, now);
    changes.push({ table: "ai_suggestions", kind: "update", row: databaseRow({ ...previous, title: proposal.title, payload: JSON.stringify({ ...stored, proposal, snapshot: notebookSnapshot(state, proposal) }) }), expected: databaseRow(previous) });
  } else {
    if (!["approved", "rejected"].includes(String(payload.status))) fail("Selecciona aprobar o rechazar.");
    if (payload.status === "approved") {
      if (JSON.stringify(notebookSnapshot(state, proposal)) !== JSON.stringify(stored.snapshot)) fail("El registro cambió desde el análisis. Revisa y guarda la propuesta antes de aprobar.", 409);
      changes = buildNotebookAction(state, userId, proposal, commandId, note.id, now).changes;
      if (proposal.action === "create_task") {
        const row = changes.find(c => c.table === "tasks")!.row;
        row.source_type = "suggestion"; row.source_id = previous.id; row.ai_generated = true;
      }
    }
    changes.push({ table: "ai_suggestions", kind: "update", row: databaseRow({ ...previous, status: payload.status }), expected: databaseRow(previous) });
  }
  if (!changes.some(c => c.table === "project_events" && c.row.id === commandId)) changes.push({ table: "project_events", kind: "insert", row: databaseRow({ id: commandId, userId, projectId: previous.projectId, eventType: "organization", title: action === "edit_suggestion" ? "Propuesta del bloc editada" : "Propuesta del bloc rechazada", description: proposal.title, sourceType: "notebook", sourceId: note.id, eventDate: now, createdAt: now }) });
  return { id: previous.id, projectId: proposal.projectId, changes };
}
