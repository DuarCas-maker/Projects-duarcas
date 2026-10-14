import { mergeEventText } from "./task-structure";
import { activeKnowledge } from "./task-attachments";
import type { Workspace } from "./workspace-types";
import type { AiResult } from "./ai-types";
import { bogotaDay, rankTask } from "./daily-engine";
import type { BrainMemory } from "./brain-types";
import { readMeeting, readProjectContext } from "./meetings";
import { operationsFor, assignmentLabel, financeTotals } from "./project-operations";

export function aiContext(state: Workspace, projectId?: string, inboxId?: string, memory: BrainMemory = {status:"not_configured",hits:[]}) {
  if (projectId && !state.projects.some((item) => item.id === projectId)) throw new Error("Proyecto no encontrado");
  const projects = state.projects.filter((item) => !projectId || item.id === projectId);
  const ids = new Set(projects.map((item) => item.id));
  const records: { id: string; type: string; data: unknown }[] = [];
  const add = (type: string, rows: { id: string }[]) => rows.forEach((row) => records.push({ id: row.id, type, data: row }));
  add("project", projects.map(({ userId: _, ...row }) => row));
  add("gbrain", memory.hits.filter((hit) => ids.has(hit.projectId)).map((hit) => ({ ...hit, title: hit.sourceReference })));
  const scoped = state.tasks.filter((item) => ids.has(item.projectId) && item.sourceType!=="task_merge");
  add("task", scoped.sort((a, b) => rankTask(b, state).score - rankTask(a, state).score).slice(0, 70).map((task) => { const { userId: _, ...row } = task; return { ...row, assignment: assignmentLabel(operationsFor(state, task.projectId), task.id), priorityReason: rankTask(task, state).reason }; }));
  add("pending_task_proposal", state.suggestions.filter(s=>s.projectId && ids.has(s.projectId) && s.status==="pending").slice(0,40).map(s=>({id:s.id,projectId:s.projectId,title:s.title,reason:s.reason})));
  add("milestone", state.milestones.filter((item) => ids.has(item.projectId)).slice(0, 30).map(({ userId: _, ...row }) => row));
  add("legacy_financial", state.financials.filter((item) => ids.has(item.projectId) && !operationsFor(state, item.projectId).agreements.some(a => a.legacy)).map(({ userId: _, ...row }) => row));
  projects.forEach(project => {
    const data = operationsFor(state, project.id);
    add("person", data.people.filter(p => p.active).map(({ id, name, role, isSelf }) => ({ id, projectId: project.id, name, role, isSelf })));
    add("current_finances", financeTotals(state, project.id).map(row => ({ id: `finance_${project.id}_${row.currency}`, projectId: project.id, ...row })));
  });
  add("event", state.events.filter((item) => ids.has(item.projectId)).sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 35).map(({ userId: _, ...row }) => ({...row,description:mergeEventText(row)})));
  add("knowledge", activeKnowledge(state).filter((item) => ids.has(item.projectId)).slice(0, 15).map(item => {
    const {userId:_,storageKey:_key,...row} = item;
    if(item.itemType==="task_resource")return {...row,sourceReference:"Recurso vigente de una tarea"};
    if(item.itemType==="project_context") {const context=readProjectContext(item);return {...row,sourceReference:context ? `Documento de contexto${context.date ? ` · referencia ${context.date}` : " sin fecha de referencia"}` : "Ficha de contexto no disponible"};}
    if (item.itemType !== "meeting") return row;
    const meeting = readMeeting(item);
    // Keep private storage paths/hashes out of AI prompts. Actual transcript
    // evidence is retrieved through the scoped GBrain bridge after indexing.
    return {...row,sourceReference:meeting ? `Reunión del ${meeting.date}${meeting.driveUrl ? ` · Video de referencia: ${meeting.driveUrl}` : ""}` : "Ficha de reunión no disponible"};
  }));
  add("inbox", state.inbox.filter((item) => inboxId ? item.id === inboxId : !projectId || (item.detectedProjectId && ids.has(item.detectedProjectId))).slice(0, 15).map(({ userId: _, ...row }) => row));
  // Retain complete records rather than truncating JSON; bound cost and input.
  const selected: typeof records = []; let size = 0;
  for (const record of records) { const chars = JSON.stringify(record).length; if (size + chars > 32000 && record.type !== "project") continue; selected.push(record); size += chars; }
  const sources = new Set(selected.map((item) => item.id));
  return { sources, projectIds: ids, text: JSON.stringify({ today: bogotaDay(), timezone: "America/Bogota", scope: projectId ?? "portfolio", integrations: { googleCalendar: "not_connected", gbrain: memory.status, codexExecution: "not_connected" }, memoryWarning: memory.warning, records: selected }), labels: Object.fromEntries(selected.map((item) => [item.id, `${item.type}: ${(item.data as { title?: string; name?: string; content?: string }).title ?? (item.data as { name?: string }).name ?? (item.data as { content?: string }).content?.slice(0, 120) ?? item.id}`])) };
}

export function validateAiResult(value: unknown, projectIds: Set<string>, sources: Set<string>, sourceText?: string): AiResult {
  const fail = (): never => { throw new Error("La IA devolvió una respuesta no válida. No se aplicó ningún cambio."); };
  if (!value || typeof value !== "object") return fail();
  const row = value as AiResult;
  const txt = (s: unknown, max: number) => typeof s === "string" && s.length <= max;
  const claims = (items: unknown) => Array.isArray(items) && items.length <= 8 && items.every((item) => txt(item?.text, 1800) && Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && item.sourceIds.every((id: string) => sources.has(id)));
  if (!txt(row.answer, 5000) || !claims(row.facts) || !claims(row.inferences) || !Array.isArray(row.suggestions) || row.suggestions.length > 3) return fail();
  for (const item of row.suggestions) {
    if (!projectIds.has(item.projectId) || !txt(item.title, 180) || !item.title.trim() || !txt(item.description, 2000) || !txt(item.reason, 2000) || !txt(item.impact, 1000) || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || !item.evidenceIds.every((id) => sources.has(id))) return fail();
    if (![item.priority, item.urgency].every((n) => Number.isInteger(n) && n >= 1 && n <= 5) || !Number.isInteger(item.estimatedMinutes) || item.estimatedMinutes < 5 || item.estimatedMinutes > 480 || !Number.isInteger(item.confidence) || item.confidence < 0 || item.confidence > 100) return fail();
    if (item.deadline !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(item.deadline) || new Date(`${item.deadline}T12:00:00Z`).toISOString().slice(0, 10) !== item.deadline)) return fail();
    if(item.matchedTaskIds !== undefined && (!Array.isArray(item.matchedTaskIds)||item.matchedTaskIds.length>5||item.matchedTaskIds.some(id=>typeof id!=="string"||!sources.has(id))))return fail();
    if (item.responsibleNames !== undefined && (!Array.isArray(item.responsibleNames) || item.responsibleNames.length > 5 || item.responsibleNames.some(name => !txt(name, 180) || !name.trim()))) return fail();
    if (sourceText && item.responsibleNames?.length) {
      const records = JSON.parse(sourceText).records as { id: string; data: unknown }[];
      const evidence = records.filter(record => item.evidenceIds.includes(record.id)).map(record => JSON.stringify(record.data)).join("\n");
      if (item.responsibleNames.some(name => !evidence.includes(name))) return fail();
    }
  }
  return row;
}
