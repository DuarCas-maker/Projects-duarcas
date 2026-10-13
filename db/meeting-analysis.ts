import { env } from "cloudflare:workers";
import { AiError, aiConfig } from "./ai-history";
import { bogotaDay } from "@/lib/daily-engine";
import type { MeetingPart } from "@/lib/meeting-analysis";

export function meetingQueryPrefix(meetingId:string,fingerprint:string) {return `meeting:v1:${meetingId}:${fingerprint}:`;}
export async function meetingParts(userId:string,projectId:string,prefix:string) {
  if(!env.DB) throw new AiError("El almacenamiento de análisis no está disponible.");
  const rows=await env.DB.prepare("SELECT result FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'meeting_fragment' AND status = 'completed' AND substr(query,1,?) = ? ORDER BY created_at").bind(userId,projectId,prefix.length,prefix).all<{result:string}>();
  const parts:MeetingPart[]=[];
  for(const row of rows.results) {const part=JSON.parse(row.result) as MeetingPart;if(part.version!==1 || prefix!==meetingQueryPrefix(part.meetingId,part.fingerprint)||part.part<0||part.part>=16||part.totalParts<1||part.totalParts>16) throw new AiError("El análisis guardado no es válido.");parts.push(part);}
  return parts;
}
export async function reserveMeetingPart(userId:string,id:string,projectId:string,query:string) {
  if(!env.DB) throw new AiError("El almacenamiento de análisis no está disponible.");
  const config=aiConfig();
  if(!config.configured||!config.enabled) throw new AiError("Activa la IA y autoriza el envío de los documentos antes de analizarlos.");
  const now=new Date().toISOString(),minuteAgo=new Date(Date.now()-60000).toISOString(),leaseAgo=new Date(Date.now()-120000).toISOString();
  const result=await env.DB.prepare(`INSERT INTO ai_runs (id,user_id,scope,kind,query,status,day_key,created_at,model) SELECT ?,?,?,'meeting_fragment',?,'pending',?,?,? WHERE (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND day_key = ? AND kind NOT IN ('notebook_voice','notebook_voice_config')) < ? AND (SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND created_at >= ? AND kind NOT IN ('notebook_voice','notebook_voice_config')) < 3 AND NOT EXISTS (SELECT 1 FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'meeting_fragment' AND query = ? AND (status = 'completed' OR (status = 'pending' AND created_at >= ?))) ON CONFLICT(id) DO NOTHING`).bind(id,userId,projectId,query,bogotaDay(),now,config.model,userId,bogotaDay(),config.limit,userId,minuteAgo,userId,projectId,query,leaseAgo).run();
  if(!result.meta.changes) throw new AiError("Este fragmento está en curso o se alcanzó el límite compartido de IA. Espera y continúa; el avance anterior se conserva.",429);
}
