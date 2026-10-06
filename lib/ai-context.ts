import type { Workspace } from "./workspace-types";
import type { AiResult } from "./ai-types";
import { bogotaDay, rankTask } from "./daily-engine";

export function aiContext(state: Workspace, projectId?: string, inboxId?: string) {
  if (projectId && !state.projects.some((item) => item.id === projectId)) throw new Error("Proyecto no encontrado");
  const projects = state.projects.filter((item) => !projectId || item.id === projectId);
  const ids = new Set(projects.map((item) => item.id));
  const records: { id: string; type: string; data: unknown }[] = [];
  const add = (type: string, rows: { id: string }[]) => rows.forEach((row) => records.push({ id: row.id, type, data: row }));
  add("project", projects.map(({ userId: _, ...row }) => row));
  const scoped = state.tasks.filter((item) => ids.has(item.projectId));
  add("task", scoped.sort((a, b) => rankTask(b, state).score - rankTask(a, state).score).slice(0, 70).map((task) => { const { userId: _, ...row } = task; return { ...row, priorityReason: rankTask(task, state).reason }; }));
  add("milestone", state.milestones.filter((item) => ids.has(item.projectId)).slice(0, 30).map(({ userId: _, ...row }) => row));
  add("financial", state.financials.filter((item) => ids.has(item.projectId)).map(({ userId: _, ...row }) => row));
  add("event", state.events.filter((item) => ids.has(item.projectId)).sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 35).map(({ userId: _, ...row }) => row));
  add("knowledge", state.knowledge.filter((item) => ids.has(item.projectId)).slice(0, 15).map(({ userId: _, storageKey: _key, ...row }) => row));
  add("inbox", state.inbox.filter((item) => inboxId ? item.id === inboxId : !projectId || (item.detectedProjectId && ids.has(item.detectedProjectId))).slice(0, 15).map(({ userId: _, ...row }) => row));
  // Retain complete records rather than truncating JSON; bound cost and input.
  const selected: typeof records = []; let size = 0;
  for (const record of records) { const chars = JSON.stringify(record).length; if (size + chars > 32000 && record.type !== "project") continue; selected.push(record); size += chars; }
  const sources = new Set(selected.map((item) => item.id));
  return { sources, projectIds: ids, text: JSON.stringify({ today: bogotaDay(), timezone: "America/Bogota", scope: projectId ?? "portfolio", integrations: { googleCalendar: "not_connected", gbrain: "not_connected", codexExecution: "not_connected" }, records: selected }), labels: Object.fromEntries(selected.map((item) => [item.id, `${item.type}: ${(item.data as { title?: string; name?: string; content?: string }).title ?? (item.data as { name?: string }).name ?? (item.data as { content?: string }).content?.slice(0, 120) ?? item.id}`])) };
}

export function validateAiResult(value: unknown, projectIds: Set<string>, sources: Set<string>): AiResult {
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
  }
  return row;
}
