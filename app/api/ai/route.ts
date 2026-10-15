import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { AiError, aiStatus, findAiRun, reserveAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { aiContext, validateAiResult } from "@/lib/ai-context";
import { requestProjectAi } from "@/lib/openai-provider";
import { buildDailyCommand } from "@/lib/daily-commands";
import { CoreValidationError, type CoreChange } from "@/lib/core-commands";
import { persistCorePlan } from "@/db/core-mutations";
import { SupabaseConflictError } from "@/db/supabase";
import type { AiResult } from "@/lib/ai-types";
import { recallMemory } from "@/lib/brain-provider";
import { safeMemoryText } from "@/lib/brain-content";
import type { BrainMemory } from "@/lib/brain-types";
import { contextRevision } from "@/lib/context-revision";
import { isProjectNews } from "@/lib/project-sources";
import { projectSourceInventory } from "@/db/project-sources";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
function fail(error: unknown) { if (error instanceof AiError || error instanceof CoreValidationError) return json({ error: error.message }, error.status); if (error instanceof SupabaseConflictError) return json({ error: error.message }, 409); if (error instanceof SyntaxError) return json({ error: "Entrada JSON no válida." }, 400); if (error instanceof WorkspaceConfigurationError) return json({ error: error.message }, error.status); console.error("ai_request_failed", error instanceof Error ? error.name : "unknown"); return json({ error: "La IA o su almacenamiento no están disponibles. No se aplicó ningún cambio." }, 503); }
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), projectId = new URL(request.url).searchParams.get("projectId") || undefined;
    const state=await getWorkspaceState(userId);
    if (projectId && !state.projects.some((item) => item.id === projectId)) throw new AiError("Proyecto no encontrado.", 404);
    const status=await aiStatus(userId,projectId??"portfolio"),revision=await contextRevision(state,projectId?[projectId]:state.projects.map(p=>p.id));
    const inventory=await projectSourceInventory(userId,state,projectId?[projectId]:state.projects.map(p=>p.id));
    return json({...status,contextRevision:revision,history:status.history.map(row=>({...row,stale:!row.contextRevision||row.contextRevision!==revision||row.sourceCoverage?.revision!==inventory.revision}))});
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  let reserved: { userId: string; id: string } | undefined;
  try {
    const userId = await currentWorkspaceId(request);
    if (Number(request.headers.get("content-length")) > 10000) throw new AiError("Consulta demasiado larga.", 413);
    const input = await request.text(); if (input.length > 10000) throw new AiError("Consulta demasiado larga.", 413);
    const body = JSON.parse(input) as Record<string, unknown>;
    if (!body || Array.isArray(body) || typeof body !== "object") throw new AiError("Entrada no válida.", 400);
    const state = await getWorkspaceState(userId);
    if (body.kind === "save_suggestions") {
      if (typeof body.runId !== "string" || !idPattern.test(body.runId)) throw new AiError("Consulta no válida.", 400);
      const run = await findAiRun(userId, body.runId);
      if (!run || run.status !== "completed" || !["chat","analyze_inbox"].includes(run.kind)) throw new AiError("Respuesta no encontrada.", 404);
      if (state.events.some((event) => event.id === run.id)) return json({ state, saved: true, replayed: true });
      const stored = JSON.parse(run.result) as { response: AiResult; sources: Record<string, string>; inboxId?: string };
      if (!stored.response.suggestions.length) throw new AiError("Esta respuesta no contiene tareas propuestas.", 400);
      const changes: CoreChange[] = []; let firstId = "";
      stored.response.suggestions.forEach((proposal, index) => {
        const commandId = index === 0 ? run.id : crypto.randomUUID();
        const plan = buildDailyCommand(state, userId, "create_task_suggestion", { ...proposal, inboxId: index === 0 ? stored.inboxId : undefined, evidence: proposal.evidenceIds.map((id) => `${id}: ${stored.sources[id] ?? "Evidencia de la consulta"}`).join("; ").slice(0, 1900) }, commandId);
        const row = plan.changes.find((change) => change.table === "ai_suggestions")!.row;
        const payload = JSON.parse(row.payload as string); row.payload = JSON.stringify({ ...payload, source: "openai", matchedTaskIds: proposal.matchedTaskIds??[], runId: run.id }); row.confidence = proposal.confidence; row.impact = proposal.impact;
        plan.changes.filter((change) => change.table === "project_events").forEach((change) => { change.row.source_type = "openai"; });
        changes.push(...plan.changes); firstId ||= plan.id;
      });
      return json({ ...await persistCorePlan(userId, { id: firstId, changes }), saved: true });
    }
    const kind = body.kind ?? "chat";
    if (!["chat", "analyze_inbox"].includes(String(kind))) throw new AiError("Tipo de consulta no válido.", 400);
    const requestId = body.requestId;
    if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new AiError("Identificador de consulta no válido.", 400);
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
    if (projectId && !state.projects.some((project) => project.id === projectId)) throw new AiError("Proyecto no encontrado.", 404);
    const inboxId = kind === "analyze_inbox" && typeof body.inboxId === "string" ? body.inboxId : undefined;
    const inbox = inboxId ? state.inbox.find((item) => item.id === inboxId) : undefined;
    if (kind === "analyze_inbox" && (!inbox || inbox.status === "processed")) throw new AiError("Selecciona una nota sin procesar.", 409);
    const query = kind === "analyze_inbox" ? `Analiza la nota ${inboxId}, identifica hechos e inferencias y propone tareas pequeñas para los proyectos que puedas identificar con evidencia. No ejecutes acciones: ${inbox!.content}` : typeof body.query === "string" ? body.query.trim() : "";
    if (!query || query.length > (kind === "chat" ? 1500 : 2600)) throw new AiError("Escribe una consulta de hasta 1500 caracteres.", 400);
    const since=typeof body.since==="string"&&body.since?body.since:undefined;
    if(body.since!==undefined&&typeof body.since!=="string" || since && (!/^\d{4}-\d{2}-\d{2}$/.test(since)||!Number.isFinite(Date.parse(since))||new Date(since).toISOString().slice(0,10)!==since))throw new AiError("Selecciona una fecha válida para las novedades.",400);
    const scope = projectId ?? "portfolio", existing = await findAiRun(userId, requestId);
    if (existing) {
      if (existing.scope !== scope || existing.query !== query || existing.kind !== kind) throw new AiError("Esta operación pertenece a otra consulta.", 409);
      if (existing.status === "completed") {const saved=JSON.parse(existing.result);if((saved.since??undefined)!==since)throw new AiError("Esta operación pertenece a otro intervalo de novedades.",409);return json({ id: existing.id, query, ...saved, replayed: true });}
      throw new AiError(existing.status === "pending" ? "La consulta sigue en curso. Revisa el historial antes de consultar otra vez." : "La consulta anterior falló. Envía una consulta nueva para volver a intentarlo.", 409);
    }
    const history = kind === "chat" ? (await aiStatus(userId, scope)).history : [];
    const projectIds=projectId?[projectId]:state.projects.map(p=>p.id),revision=await contextRevision(state,projectIds);
    await reserveAiRun(userId, requestId, scope, String(kind), query); reserved = { userId, id: requestId };
    let memory: BrainMemory;
    try { memory = await recallMemory(userId,projectIds,safeMemoryText(query),requestId,state,history.at(-1)?.sourceCoverage); }
    catch { memory = {status:"unavailable",hits:[],warning:"No se pudo consultar GBrain. Esta respuesta utiliza únicamente los registros de Project OS."}; }
    const context = aiContext(state, projectId, inboxId, memory);
    const baseline=since?new Date(`${since}T00:00:00-05:00`).toISOString():history.at(-1)?.createdAt??null;
    const news=isProjectNews(query)?{since:baseline,firstConsultation:!baseline,events:state.events.filter(e=>projectIds.includes(e.projectId)&&context.sources.has(e.id)&&(!baseline||e.createdAt>=baseline)).map(e=>({id:e.id,title:e.title,date:e.createdAt})),tasks:state.tasks.filter(t=>projectIds.includes(t.projectId)&&context.sources.has(t.id)&&(!baseline||t.updatedAt>=baseline)).map(t=>({id:t.id,title:t.title,status:t.status,updatedAt:t.updatedAt})),sourceChanges:memory.coverage?.changes??[],note:"Las fechas de referencia de documentos no son fechas de subida. Las eliminaciones solo se identifican al comparar inventarios. Un commit no confirma una tarea completada. Los cambios de fuentes comparan el inventario anterior; no se puede reconstruir su fecha histórica exacta. El historial completo puede contener más eventos que esta selección."}:undefined;
    const dataContext=JSON.stringify({...JSON.parse(context.text),news});
    const output = await requestProjectAi(dataContext, query, history.filter(row=>row.contextRevision===revision&&row.sourceCoverage?.revision===memory.coverage?.revision));
    const response = validateAiResult(output.response, context.projectIds, context.sources, context.text);
    const result = { response, sources: context.labels, inboxId, since,sourceCoverage:context.coverage,contextRevision:revision,memory: {status:memory.status,count:memory.hits.filter(h=>context.sources.has(h.id)).length,warning:memory.warning,provider:memory.provider} };
    await finishAiRun(userId, requestId, result, output.usage?.input_tokens, output.usage?.output_tokens);
    return json({ id: requestId, query, ...result });
  } catch (error) { if (reserved) await failAiRun(reserved.userId, reserved.id).catch(() => undefined); return fail(error); }
}
