import { currentWorkspaceId } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { persistCorePlan } from "@/db/core-mutations";
import { AiError, aiStatus, findAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { notebookRounds, reserveNotebookRound, expireNotebookRounds, voiceStatus, setVoiceBudget } from "@/db/notebook";
import { NOTEBOOK_CLASSIFICATION, NOTEBOOK_MAX_TEXT, isNotebookNote, validateNotebookAnswers, validateNotebookResult, buildNotebookProposals, notebookFields, notebookEvidence } from "@/lib/notebook";
import { databaseRow } from "@/lib/core-commands";
import { notebookFailure, notebookJson as json } from "@/lib/notebook-http";
import { requestNotebookAi } from "@/lib/notebook-provider";
import { notebookContext } from "@/lib/notebook-context";

export const dynamic = "force-dynamic";
const uuid = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), state = await getWorkspaceState(userId), noteId = new URL(request.url).searchParams.get("noteId");
    if (noteId && !state.inbox.some(n => n.id === noteId && n.userId === userId && isNotebookNote(n))) throw new AiError("Nota no encontrada.", 404);
    return json({ notes: state.inbox.filter(isNotebookNote).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), rounds: noteId ? await notebookRounds(userId, noteId) : [], voice: await voiceStatus(userId), ai: { ...(await aiStatus(userId, "notebook")), history: undefined } });
  } catch (error) { return notebookFailure(error); }
}
export async function POST(request: Request) {
  let reserved: { userId: string; id: string } | undefined;
  try {
    const userId = await currentWorkspaceId(request);
    if (Number(request.headers.get("content-length")) > 40000) throw new AiError("Entrada demasiado larga.", 413);
    const raw = await request.text(); if (raw.length > 40000) throw new AiError("Entrada demasiado larga.", 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AiError("Entrada no válida.", 400);
    if (body.action === "voice_budget") {
      if (typeof body.limitUsd !== "number") throw new AiError("Introduce un presupuesto numérico.", 400);
      return json({ voice: await setVoiceBudget(userId, body.limitUsd) });
    }
    const state = await getWorkspaceState(userId);
    if (body.action === "capture") {
      if (!uuid(body.requestId) || typeof body.content !== "string" || !body.content.trim() || body.content.trim().length > NOTEBOOK_MAX_TEXT) throw new AiError(`Escribe una nota de hasta ${NOTEBOOK_MAX_TEXT} caracteres.`, 400);
      const content = body.content.trim(), inputType = body.inputType === "voice" ? "voice" : "text";
      const prior = state.inbox.find(n => n.id === body.requestId);
      if (prior) {
        if (prior.userId !== userId || !isNotebookNote(prior) || prior.content !== content || prior.inputType !== inputType) throw new AiError("Este envío pertenece a otra nota.", 409);
        return json({ state, note: prior, replayed: true });
      }
      const note = { id: body.requestId, userId, content, inputType, detectedProjectId: null, classification: NOTEBOOK_CLASSIFICATION, status: "unprocessed", createdAt: new Date().toISOString() };
      const result = await persistCorePlan(userId, { id: note.id, changes: [{ table: "inbox_items", kind: "insert", row: databaseRow(note) }] });
      return json({ state: result.state, note }, 201);
    }
    const note = state.inbox.find(n => n.id === body.noteId && n.userId === userId && isNotebookNote(n));
    if (!note) throw new AiError("Nota no encontrada.", 404);
    const rounds = await notebookRounds(userId, note.id), last = rounds.at(-1);
    if (body.action === "propose") {
      if (!last || body.roundId !== last.id) throw new AiError("Recarga el análisis más reciente antes de enviar propuestas.", 409);
      if (note.status === "processed") return json({ state, replayed: true });
      return json(await persistCorePlan(userId, buildNotebookProposals(state, userId, note, last)));
    }
    if (body.action !== "analyze" || !uuid(body.requestId)) throw new AiError("Operación o identificador no válido.", 400);
    await expireNotebookRounds(userId, note.id);
    const query = JSON.stringify({ noteId: note.id, previousId: body.previousId ?? null, answers: body.answers ?? [] });
    const existing = await findAiRun(userId, body.requestId);
    if (existing) {
      if (existing.kind !== "notebook" || existing.scope !== `notebook:${note.id}` || existing.query !== query) throw new AiError("Este identificador pertenece a otra solicitud.", 409);
      if (existing.status === "completed") return json({ round: rounds.find(r => r.id === existing.id), rounds, replayed: true });
      throw new AiError(existing.status === "pending" ? "La ronda sigue en curso. Recarga el historial para recuperar el resultado." : "El análisis falló. Inicia un nuevo intento desde la nota guardada.", 409);
    }
    if (note.status === "processed" || last && !last.result.questions.length) throw new AiError("Esta nota ya tiene propuestas. Escribe una nota nueva para añadir información.", 409);
    if ((body.previousId ?? null) !== (last?.id ?? null)) throw new AiError("Cambió la ronda de preguntas. Recarga el historial.", 409);
    if (rounds.length >= 20) throw new AiError("La nota alcanzó 20 rondas. Continúa en una nota nueva.", 409);
    const answers = last ? validateNotebookAnswers(last.result.questions, body.answers) : [];
    if (!last && Array.isArray(body.answers) && body.answers.length) throw new AiError("No hay preguntas previas para estas respuestas.", 400);
    await reserveNotebookRound(userId, body.requestId, note.id, query, last?.id ?? null); reserved = { userId, id: body.requestId };
    const context = await notebookContext(state, userId, note, rounds, answers, body.requestId);
    const output = await requestNotebookAi(JSON.stringify({ ...context.data, fields: notebookFields }), note.content, rounds, answers);
    const evidence = notebookEvidence(note.content, rounds, answers);
    const result = validateNotebookResult(output.result, state, userId, evidence, !rounds.length);
    if (result.proposals.some(p => !context.projectIds.includes(p.projectId))) throw new AiError("La IA propuso un proyecto que no está identificado en tus encabezados o respuestas. Revisa el nombre del proyecto antes de continuar.", 502);
    const saved = { answers, result, memory: context.memory, coverage: context.coverage };
    await finishAiRun(userId, body.requestId, saved, output.usage?.input_tokens, output.usage?.output_tokens); reserved = undefined;
    const updated = await notebookRounds(userId, note.id);
    const round = updated.find(r => r.id === body.requestId);
    if (!round) throw new AiError("La ronda expiró. Recarga el historial para continuar.", 409);
    return json({ round, rounds: updated });
  } catch (error) { if (reserved) await failAiRun(reserved.userId, reserved.id).catch(() => undefined); return notebookFailure(error); }
}
