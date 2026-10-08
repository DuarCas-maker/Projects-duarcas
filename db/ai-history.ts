import { env } from "cloudflare:workers";
import { bogotaDay } from "@/lib/daily-engine";
import type { AiResult, AiRecord } from "@/lib/ai-types";

export class AiError extends Error { constructor(message: string, public status = 503) { super(message); this.name = "AiError"; } }
function db() { if (!env.DB) throw new AiError("El almacenamiento de IA no está disponible."); return env.DB; }
export function aiConfig() {
  const requested = Number(env.PROJECT_OS_AI_DAILY_LIMIT ?? 40);
  return { configured: !!env.OPENAI_API_KEY, enabled: env.PROJECT_OS_AI_CONTEXT_ENABLED === "true", model: env.OPENAI_MODEL || "gpt-4.1-mini", limit: Number.isInteger(requested) ? Math.max(1, Math.min(100, requested)) : 40 };
}
export async function aiStatus(userId: string, scope: string) {
  const used = await db().prepare("SELECT COUNT(*) AS used FROM ai_runs WHERE user_id = ? AND day_key = ?").bind(userId, bogotaDay()).first<{ used: number }>();
  const history = await db().prepare("SELECT id, query, result, created_at, kind FROM ai_runs WHERE user_id = ? AND scope = ? AND status = 'completed' AND kind = 'chat' ORDER BY created_at DESC LIMIT 12").bind(userId, scope).all<{ id: string; query: string; result: string; created_at: string; kind: string }>();
  return { ...aiConfig(), used: used?.used ?? 0, history: history.results.reverse().map((row) => { const saved = JSON.parse(row.result); return { id: row.id, query: row.query, result: saved.response as AiResult, sources:saved.sources, memory:saved.memory, createdAt: row.created_at, kind: row.kind }; }) as AiRecord[] };
}
export async function findAiRun(userId: string, id: string) {
  return db().prepare("SELECT * FROM ai_runs WHERE user_id = ? AND id = ?").bind(userId, id).first<{ id: string; scope: string; kind: string; query: string; status: string; result: string; created_at: string }>();
}
export async function reserveAiRun(userId: string, id: string, scope: string, kind: string, query: string) {
  const { configured, enabled, model, limit } = aiConfig();
  if (!configured) throw new AiError("La IA no está configurada en este servidor.");
  if (!enabled) throw new AiError("La conexión está preparada. Falta autorizar el envío del contexto de los proyectos a OpenAI.");
  const now = new Date().toISOString(), minuteAgo = new Date(Date.now() - 60000).toISOString();
  // Reservation and both shared limits are checked in a single atomic statement.
  const inserted = await db().prepare(`INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) SELECT ?,?,?,?,?,'pending',?,?,? WHERE (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND day_key = ?) < ? AND (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND created_at >= ?) < 3 ON CONFLICT(id) DO NOTHING`).bind(id, userId, scope, kind, query, bogotaDay(), now, model, userId, bogotaDay(), limit, userId, minuteAgo).run();
  if (!inserted.meta.changes) throw new AiError("Límite compartido de IA: 3 consultas por minuto o el máximo diario. Espera antes de volver a consultar.", 429);
}
export async function finishAiRun(userId: string, id: string, result: unknown, inputTokens = 0, outputTokens = 0) {
  await db().prepare("UPDATE ai_runs SET result = ?, status = 'completed', input_tokens = ?, output_tokens = ? WHERE user_id = ? AND id = ? AND status = 'pending'").bind(JSON.stringify(result), inputTokens, outputTokens, userId, id).run();
}
export async function failAiRun(userId: string, id: string) {
  await db().prepare("UPDATE ai_runs SET status = 'failed' WHERE user_id = ? AND id = ? AND status = 'pending'").bind(userId, id).run();
}
