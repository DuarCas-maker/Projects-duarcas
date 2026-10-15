import type { Workspace } from "./workspace-types";
import { aiContext } from "./ai-context";
import { recallMemory } from "@/lib/brain-provider";
import type { NotebookAnswer, NotebookRound } from "./notebook";
import type { BrainMemory } from "./brain-types";
import { bogotaDay } from "./daily-engine";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").replace(/^\s*#{1,3}\s*/, "").replace(/^proyecto\s+/, "").replace(/[:\s]+$/, "").trim();
export function notebookProjectIds(state: Workspace, text: string) {
  const lines = text.split(/\r?\n/).map(normalize);
  return state.projects.filter(p => lines.some(line => line === normalize(p.name) || line === normalize(p.shortCode))).map(p => p.id);
}
export async function notebookContext(state: Workspace, userId: string, note: Workspace["inbox"][number], rounds: NotebookRound[], answers: NotebookAnswer[], requestId: string) {
  const answerText = (round: NotebookRound | undefined, values: NotebookAnswer[]) => values.flatMap(answer => {
    const question = round?.result.questions.find(q => q.id === answer.questionId);
    return [answer.text, ...answer.selected.filter(v => v !== "D").map(v => question?.options[v as "A" | "B" | "C"] ?? "")];
  }).join("\n");
  const selected = new Set(notebookProjectIds(state, note.content));
  const answered = [answerText(rounds.at(-1), answers), ...rounds.map((round, index) => answerText(rounds[index - 1], round.answers))].join("\n");
  // Answers can identify a project through a named option, including a full sentence.
  for (const project of state.projects) if (answered.split(/\r?\n/).some(line => normalize(line) === normalize(project.name) || line.includes(project.name))) selected.add(project.id);
  const projectIds = [...selected];
  let memory: BrainMemory = { status: "not_configured", hits: [] };
  if (projectIds.length) {
    try { memory = await recallMemory(userId, projectIds, note.content.slice(0, 1500), requestId, state); }
    catch { memory = { status: "unavailable", hits: [], warning: "No se pudo consultar la memoria. Se usaron los registros locales disponibles." }; }
  }
  const details = projectIds.map(id => JSON.parse(aiContext(state, id, note.id, memory).text));
  const documents=memory.hits.filter(h=>selected.has(h.projectId)).map(h=>({id:h.knowledgeId,projectId:h.projectId,title:h.title,text:h.text,excerpt:memory.coverage?.entries.find(e=>e.id===h.knowledgeId)?.mode!=="full"}));
  const inventory=memory.coverage;
  const coverage = `${projectIds.length} proyectos con contexto; ${documents.length} fuentes consultadas; ${inventory?.total??documents.length} fuentes en catálogo; ${inventory?.pending??0} pendientes; ${inventory?.unavailable??0} no disponibles. Los extractos no son lecturas completas.`;
  return { projectIds, data: { today: bogotaDay(), timezone: "America/Bogota", projects: state.projects.map(({ id, name, shortCode }) => ({ id, name, shortCode })), details, documents, pendingProposals: state.suggestions.filter(s => s.projectId && selected.has(s.projectId) && s.status === "pending").map(s => ({ id: s.id, projectId: s.projectId, title: s.title, impact: s.impact, payload: s.payload })), coverage }, coverage, memory: { status: memory.status, warning: memory.warning } };
}
