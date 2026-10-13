import { env } from "cloudflare:workers";
import { AiError, aiConfig } from "./ai-history";
import { bogotaDay } from "@/lib/daily-engine";
import type { NotebookRound } from "@/lib/notebook";

const db = () => { if (!env.DB) throw new AiError("El historial del bloc no está disponible."); return env.DB; };
export async function expireNotebookRounds(userId: string, noteId: string) {
  // Provider requests time out after one minute; permit recovery after a crashed worker.
  await db().prepare("UPDATE ai_runs SET status = 'failed' WHERE user_id = ? AND scope = ? AND kind = 'notebook' AND status = 'pending' AND created_at < ?").bind(userId, `notebook:${noteId}`, new Date(Date.now() - 5 * 60000).toISOString()).run();
}
export async function notebookRounds(userId: string, noteId: string): Promise<NotebookRound[]> {
  const rows = await db().prepare("SELECT id, result, created_at FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'notebook' AND status = 'completed' ORDER BY created_at, id").bind(userId, `notebook:${noteId}`).all<{ id: string; result: string; created_at: string }>();
  return rows.results.map(row => ({ ...JSON.parse(row.result), id: row.id, createdAt: row.created_at }));
}
export async function reserveNotebookRound(userId: string, id: string, noteId: string, query: string, previousId: string | null) {
  const config = aiConfig();
  if (!config.configured || !config.enabled) throw new AiError("La IA no está configurada o el contexto no está habilitado.");
  const now = new Date().toISOString(), minuteAgo = new Date(Date.now() - 60000).toISOString(), scope = `notebook:${noteId}`;
  const result = await db().prepare(`INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) SELECT ?,?,?,'notebook',?,'pending',?,?,? WHERE (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND day_key = ? AND kind NOT IN ('notebook_voice','notebook_voice_config')) < ? AND (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND created_at >= ? AND kind NOT IN ('notebook_voice','notebook_voice_config')) < 3 AND NOT EXISTS (SELECT 1 FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'notebook' AND status = 'pending') AND (SELECT id FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'notebook' AND status = 'completed' ORDER BY created_at DESC,id DESC LIMIT 1) IS ? ON CONFLICT(id) DO NOTHING`).bind(id, userId, scope, query, bogotaDay(), now, config.model, userId, bogotaDay(), config.limit, userId, minuteAgo, userId, scope, userId, scope, previousId).run();
  if (!result.meta.changes) throw new AiError("Hay otra ronda en curso, cambió el historial o alcanzaste el límite de IA. Recarga el historial y espera antes de volver a consultar.", 409);
}
export async function voiceStatus(userId: string) {
  const config = await db().prepare("SELECT result FROM ai_runs WHERE user_id = ? AND kind = 'notebook_voice_config' AND status = 'completed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(userId).first<{ result: string }>();
  const requested = config ? Number(JSON.parse(config.result).limitUsd) : Number(env.PROJECT_OS_NOTEBOOK_VOICE_MONTHLY_USD ?? 1);
  const limitUsd = Number.isFinite(requested) ? Math.max(0, Math.min(50, requested)) : 1;
  const month = bogotaDay().slice(0, 7);
  const usage = await db().prepare("SELECT COALESCE(SUM(json_extract(query,'$.micros')),0) AS micros FROM ai_runs WHERE user_id = ? AND kind = 'notebook_voice' AND substr(day_key,1,7) = ?").bind(userId, month).first<{ micros: number }>();
  return { ...aiConfig(), limitUsd, usedUsd: (usage?.micros ?? 0) / 1000000, month, estimated: true, maxSeconds: 300 };
}
export async function setVoiceBudget(userId: string, limitUsd: number) {
  if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 50 || Math.abs(Math.round(limitUsd * 100) - limitUsd * 100) > 1e-7) throw new AiError("El presupuesto debe estar entre USD 0 y 50, con hasta dos decimales.", 400);
  const now = new Date().toISOString();
  await db().prepare("INSERT INTO ai_runs (id,user_id,scope,kind,query,result,status,day_key,created_at,model) VALUES (?,?,'notebook','notebook_voice_config','',?,'completed',?,?,'settings')").bind(crypto.randomUUID(), userId, JSON.stringify({ limitUsd }), bogotaDay(), now).run();
  return voiceStatus(userId);
}
export async function reserveVoice(userId: string, id: string, hash: string, seconds: number) {
  const config = await voiceStatus(userId);
  if (!config.configured || !config.enabled) throw new AiError("La conexión de IA no está habilitada.");
  const micros = Math.ceil(seconds * 50), now = new Date().toISOString(); // Published estimate: USD 0.003 / minute.
  const query = JSON.stringify({ hash, seconds, micros });
  const result = await db().prepare(`INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) SELECT ?,?,'notebook','notebook_voice',?,'pending',?,?,'gpt-4o-mini-transcribe' WHERE COALESCE((SELECT SUM(json_extract(query,'$.micros')) FROM ai_runs WHERE user_id = ? AND kind = 'notebook_voice' AND substr(day_key,1,7) = ?),0) + ? <= COALESCE((SELECT CAST(json_extract(result,'$.limitUsd') * 1000000 AS INTEGER) FROM ai_runs WHERE user_id = ? AND kind = 'notebook_voice_config' AND status = 'completed' ORDER BY created_at DESC,id DESC LIMIT 1), ?) AND (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND kind = 'notebook_voice' AND created_at >= ?) < 3 ON CONFLICT(id) DO NOTHING`).bind(id, userId, query, bogotaDay(), now, userId, config.month, micros, userId, Math.round(config.limitUsd * 1000000), userId, new Date(Date.now() - 60000).toISOString()).run();
  if (!result.meta.changes) throw new AiError("El dictado supera el presupuesto mensual estimado o el límite de frecuencia. Puedes escribir o ajustar el presupuesto.", 429);
}
