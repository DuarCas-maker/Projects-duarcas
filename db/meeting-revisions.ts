import { env } from "cloudflare:workers";
import { AiError } from "./ai-history";
import { revisionPrefix, type MeetingRevision } from "@/lib/meeting-revision";

export async function meetingRevisions(userId:string,projectId:string,meetingId:string,fingerprint:string) {
  if(!env.DB) throw new AiError("El almacenamiento de IA no está disponible.");
  const prefix=revisionPrefix(meetingId,fingerprint);
  const rows=await env.DB.prepare("SELECT result FROM ai_runs WHERE user_id = ? AND scope = ? AND kind = 'meeting_revision' AND status = 'completed' AND substr(query,1,?) = ? ORDER BY created_at DESC, id DESC LIMIT 256").bind(userId,projectId,prefix.length,prefix).all<{result:string}>();
  const latest=new Map<string,MeetingRevision>();
  for(const row of rows.results) {const saved=JSON.parse(row.result) as MeetingRevision;if(saved.version===1&&saved.meetingId===meetingId&&saved.fingerprint===fingerprint&&!latest.has(saved.baseFindingId))latest.set(saved.baseFindingId,saved);}
  return [...latest.values()];
}
