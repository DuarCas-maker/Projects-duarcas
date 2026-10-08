import { env } from "cloudflare:workers";
import { bogotaDay } from "@/lib/daily-engine";
import { BrainError } from "@/lib/gbrain-client";
import type { BrainLink } from "@/lib/brain-types";

export type MemoryRow = { id: string; user_id: string; project_id: string; knowledge_id: string; title: string; brain_id: string; source_id: string; source_type: string; external_reference: string; content_hash: string; request_id: string; status: string; error: string; indexed_at: string | null; created_at: string };
export function brainDb() { if (!env.DB) throw new BrainError("El registro de memoria no está disponible."); return env.DB; }
export function brainLimit() { const n = Number(env.PROJECT_OS_BRAIN_DAILY_LIMIT ?? 30); return Number.isInteger(n) ? Math.max(1, Math.min(100, n)) : 30; }
export async function memoryRows(userId: string, projectId?: string) {
  return (await brainDb().prepare(`SELECT * FROM project_brain_sources WHERE user_id = ?${projectId ? " AND project_id = ?" : ""} ORDER BY created_at DESC LIMIT 1000`).bind(...(projectId ? [userId, projectId] : [userId])).all<MemoryRow>()).results;
}
export async function memoryLink(userId: string, projectId: string, knowledgeId: string) { return brainDb().prepare("SELECT * FROM project_brain_sources WHERE user_id = ? AND project_id = ? AND knowledge_id = ?").bind(userId, projectId, knowledgeId).first<MemoryRow>(); }
export async function addMemoryLink(row: MemoryRow) {
  await brainDb().prepare("INSERT INTO project_brain_sources (id,user_id,project_id,knowledge_id,title,brain_id,source_id,source_type,external_reference,content_hash,request_id,status,error,indexed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(row.id,row.user_id,row.project_id,row.knowledge_id,row.title,row.brain_id,row.source_id,row.source_type,row.external_reference,row.content_hash,row.request_id,row.status,row.error,row.indexed_at,row.created_at).run();
  return (await memoryLink(row.user_id, row.project_id, row.knowledge_id))!;
}
export async function setMemoryState(row: MemoryRow, status: string, error = "", compare = false) {
  const result = await brainDb().prepare(`UPDATE project_brain_sources SET status = ?, error = ?, indexed_at = ? WHERE id = ? AND user_id = ?${compare ? " AND status = ? AND error = ?" : ""}`).bind(status, error, status === "ready" ? new Date().toISOString() : row.indexed_at, row.id, row.user_id,...(compare ? [row.status,row.error] : [])).run();
  return !!result.meta.changes;
}
export async function memoryStatus(userId: string, projectId: string) {
  const used = await brainDb().prepare("SELECT COUNT(*) AS used FROM brain_requests WHERE user_id = ? AND day_key = ?").bind(userId, bogotaDay()).first<{used: number}>();
  const links: BrainLink[] = (await memoryRows(userId, projectId)).map((row) => ({ knowledgeId: row.knowledge_id, title: row.title, status: row.status, error: row.error, indexedAt: row.indexed_at }));
  return { used: used?.used ?? 0, limit: brainLimit(), links };
}
// One atomic reservation bounds public access costs. Leases survive Worker
// crashes; retries keep the same provider request_id and payload fingerprint.
export async function reserveBrainRequest(userId: string, id: string, projectId: string, kind: string, hash: string) {
  const now = new Date().toISOString(), lease = new Date(Date.now() + 90000).toISOString();
  const existing = await brainDb().prepare("SELECT * FROM brain_requests WHERE id = ? AND user_id = ?").bind(id,userId).first<{project_id:string;kind:string;payload_hash:string;status:string;result:string;lease_until:string;attempts:number}>();
  if (existing) {
    if (existing.project_id !== projectId || existing.kind !== kind || existing.payload_hash !== hash) throw new BrainError("Esta operación pertenece a otro contenido o proyecto.", 409);
    if (existing.status === "completed") return { replayed: true, result: JSON.parse(existing.result) as unknown };
    if (existing.attempts >= 3) throw new BrainError("Esta operación agotó sus reintentos. El original se conserva.", 409);
    if (existing.status === "pending" && existing.lease_until > now) throw new BrainError("La operación sigue en curso. Espera antes de reintentar.", 409);
    const renewed = await brainDb().prepare("UPDATE brain_requests SET status = 'pending', lease_until = ?, attempts = attempts + 1 WHERE id = ? AND user_id = ? AND (status = 'retryable' OR lease_until <= ?) AND attempts < 3").bind(lease,id,userId,now).run();
    if (!renewed.meta.changes) throw new BrainError("La operación sigue en curso.", 409);
    return { replayed: false };
  }
  const inserted = await brainDb().prepare("INSERT INTO brain_requests (id,user_id,project_id,kind,payload_hash,status,day_key,created_at,lease_until) SELECT ?,?,?,?,?,'pending',?,?,? WHERE (SELECT COUNT(*) FROM brain_requests WHERE user_id = ? AND day_key = ?) < ? AND (SELECT COUNT(*) FROM brain_requests WHERE user_id = ? AND created_at >= ?) < 3 ON CONFLICT(id) DO NOTHING").bind(id,userId,projectId,kind,hash,bogotaDay(),now,lease,userId,bogotaDay(),brainLimit(),userId,new Date(Date.now()-60000).toISOString()).run();
  if (!inserted.meta.changes) throw new BrainError("Límite compartido de memoria: 3 operaciones por minuto o el máximo diario. Espera antes de continuar.", 429);
  return { replayed: false };
}
export async function completeBrainRequest(userId: string, id: string, result: unknown) { await brainDb().prepare("UPDATE brain_requests SET status = 'completed', result = ? WHERE user_id = ? AND id = ? AND status = 'pending'").bind(JSON.stringify(result),userId,id).run(); }
export async function retryBrainRequest(userId: string, id: string) { await brainDb().prepare("UPDATE brain_requests SET status = 'retryable' WHERE user_id = ? AND id = ? AND status = 'pending'").bind(userId,id).run(); }
