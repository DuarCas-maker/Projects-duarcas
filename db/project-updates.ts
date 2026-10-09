import { env } from "cloudflare:workers";
import { AiError, aiConfig } from "./ai-history";
import { bogotaDay } from "@/lib/daily-engine";
import type { ProjectUpdateRecord } from "@/lib/project-update";

export function updatePrefix(meetingId:string) { return `project-update:v1:${meetingId || "none"}:`; }
export async function latestProjectUpdate(userId:string,projectId:string,meetingId:string,query?:string):Promise<ProjectUpdateRecord|null> {
  if (!env.DB) throw new AiError("El historial de IA no está disponible.");
  const prefix=updatePrefix(meetingId);
  const row=await env.DB.prepare(`SELECT id,result,created_at FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'project_update' AND status = 'completed' AND ${query ? "query = ?" : "substr(query,1,?) = ?"} ORDER BY created_at DESC LIMIT 1`).bind(userId,projectId,...(query ? [query] : [prefix.length,prefix])).first<{id:string;result:string;created_at:string}>();
  return row ? {id:row.id,createdAt:row.created_at,...JSON.parse(row.result)} : null;
}
export async function reserveProjectUpdate(userId:string,id:string,projectId:string,query:string) {
  if (!env.DB) throw new AiError("El historial de IA no está disponible.");
  const {configured,enabled,limit,model}=aiConfig();
  if (!configured || !enabled) throw new AiError("Activa la IA y autoriza el contexto antes de generar una actualización.");
  const now=new Date().toISOString(),minuteAgo=new Date(Date.now()-60000).toISOString(),leaseAgo=new Date(Date.now()-120000).toISOString();
  const result=await env.DB.prepare(`INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) SELECT ?,?,?,'project_update',?,'pending',?,?,? WHERE (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND day_key = ?) < ? AND (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND created_at >= ?) < 3 AND NOT EXISTS (SELECT 1 FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'project_update' AND query = ? AND (status = 'completed' OR (status = 'pending' AND created_at >= ?))) ON CONFLICT(id) DO NOTHING`).bind(id,userId,projectId,query,bogotaDay(),now,model,userId,bogotaDay(),limit,userId,minuteAgo,userId,projectId,query,leaseAgo).run();
  if (!result.meta.changes) throw new AiError("La actualización está en curso o se alcanzó el límite compartido de IA. Espera antes de reintentar.",429);
}
