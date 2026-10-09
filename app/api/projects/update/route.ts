import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { AiError, aiStatus, findAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { latestProjectUpdate, reserveProjectUpdate, updatePrefix } from "@/db/project-updates";
import { meetingParts, meetingQueryPrefix } from "@/db/meeting-analysis";
import { combineMeetingParts } from "@/lib/meeting-analysis";
import { memoryRows } from "@/db/brain";
import { readMeeting } from "@/lib/meetings";
import { contentHash } from "@/lib/brain-content";
import { recallMemory } from "@/lib/brain-provider";
import { BrainError } from "@/lib/gbrain-client";
import type { BrainMemory } from "@/lib/brain-types";
import { projectUpdateSignature, projectUpdateSnapshot, projectUpdateContext, validateProjectUpdate, buildProjectUpdatePlan, type ProjectUpdateRecord } from "@/lib/project-update";
import { requestProjectUpdate } from "@/lib/project-update-provider";
import { CoreValidationError } from "@/lib/core-commands";
import { persistCorePlan } from "@/db/core-mutations";
import { SupabaseConflictError } from "@/db/supabase";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
function failure(error:unknown) {
  if (error instanceof AiError || error instanceof CoreValidationError || error instanceof BrainError) return json({error:error.message},error.status);
  if (error instanceof SupabaseConflictError) return json({error:error.message},409);
  if (error instanceof SyntaxError) return json({error:"Entrada JSON no válida."},400);
  if (error instanceof WorkspaceConfigurationError) return json({error:error.message},error.status);
  console.error("project_update_failed",error instanceof Error ? error.name : "unknown");
  return json({error:"No se pudo cargar o guardar la actualización. El proyecto no se modificó."},503);
}
async function current(projectId:unknown,meetingId:unknown) {
  if (typeof projectId!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId) || typeof meetingId!=="string" || (meetingId && !/^[a-zA-Z0-9_-]{1,100}$/.test(meetingId))) throw new AiError("Selecciona un proyecto y una reunión válidos.",400);
  const userId=await currentWorkspaceId(),state=await getWorkspaceState(userId);
  const project=state.projects.find(p=>p.id===projectId && p.userId===userId);
  if (!project) throw new AiError("Proyecto no encontrado.",404);
  const item=meetingId ? state.knowledge.find(k=>k.id===meetingId && k.projectId===projectId && k.userId===userId) : undefined;
  const meeting=item && readMeeting(item);
  if (meetingId && !meeting) throw new AiError("La reunión no pertenece a este proyecto.",404);
  const parts=meeting ? await meetingParts(userId,projectId,meetingQueryPrefix(meetingId,meeting.fingerprint)) : [];
  const analysis=combineMeetingParts(parts),snapshot=projectUpdateSnapshot(state,projectId,meetingId,analysis);
  const links=(await memoryRows(userId,projectId)).map(r=>({id:r.knowledge_id,status:r.status,hash:r.content_hash,indexedAt:r.indexed_at}));
  const revision=await contentHash(JSON.stringify({contextVersion:2,state:projectUpdateSignature(state,projectId,meetingId),parts,links}));
  return {userId,state,project,meetingId,analysis,snapshot,revision,query:updatePrefix(meetingId)+revision};
}
export async function GET(request:Request) {
  try {
    const params=new URL(request.url).searchParams,c=await current(params.get("projectId"),params.get("meetingId")??"");
    const latest=await latestProjectUpdate(c.userId,c.project.id,c.meetingId);
    const ai=await aiStatus(c.userId,c.project.id);
    return json({snapshot:c.snapshot,revision:c.revision,latest,stale:!!latest && latest.revision!==c.revision,ai:{configured:ai.configured,enabled:ai.enabled,used:ai.used,limit:ai.limit}});
  } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  let reserved:{userId:string;id:string}|undefined;
  try {
    await currentWorkspaceId(request);
    const input=await request.text();if(input.length>8000) throw new AiError("Entrada demasiado grande.",413);
    const body=JSON.parse(input) as Record<string,unknown>;if(!body||typeof body!=="object"||Array.isArray(body)) throw new AiError("Entrada no válida.",400);
    const c=await current(body.projectId,body.meetingId??"");
    if (body.action==="apply") {
      if (typeof body.runId!=="string") throw new AiError("Actualización no válida.",400);
      const run=await findAiRun(c.userId,body.runId);
      if (!run || run.kind!=="project_update" || run.scope!==c.project.id || run.status!=="completed" || !run.query.startsWith(updatePrefix(c.meetingId))) throw new AiError("Actualización no encontrada para este proyecto y reunión.",404);
      if (c.state.events.some(e=>e.id===`project-update-${run.id}` && e.projectId===c.project.id)) return json({state:c.state,applied:true,replayed:true});
      const stored=JSON.parse(run.result) as Omit<ProjectUpdateRecord,"id"|"createdAt">;
      if (stored.revision!==c.revision) throw new AiError("El proyecto, la reunión o la memoria cambiaron. Genera una lectura nueva antes de aplicarla.",409);
      const plan=buildProjectUpdatePlan(c.state,c.userId,c.project.id,run.id,body.summary,body.nextStep);
      return json({...await persistCorePlan(c.userId,plan),applied:true});
    }
    if (body.action!=="generate") throw new AiError("Acción no válida.",400);
    if (typeof body.requestId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) throw new AiError("Identificador no válido.",400);
    const existing=await findAiRun(c.userId,body.requestId);
    if (existing) {
      if (existing.scope!==c.project.id || existing.kind!=="project_update" || existing.query!==c.query) throw new AiError("Esta operación pertenece a otro estado del proyecto.",409);
      if (existing.status==="completed") return json({latest:{id:existing.id,createdAt:existing.created_at,...JSON.parse(existing.result)},replayed:true});
      throw new AiError("La actualización anterior está en curso o falló. Revisa el estado antes de preparar otra consulta.",409);
    }
    const cached=await latestProjectUpdate(c.userId,c.project.id,c.meetingId,c.query);
    if (cached) return json({latest:cached,replayed:true});
    await reserveProjectUpdate(c.userId,body.requestId,c.project.id,c.query);reserved={userId:c.userId,id:body.requestId};
    let memory:BrainMemory;
    try {memory=await recallMemory(c.userId,[c.project.id],`Estado, acuerdos, bloqueadores y próxima acción de ${c.project.name}${c.snapshot.meeting ? ` después de ${c.snapshot.meeting.title}` : ""}`.slice(0,1000),body.requestId);}
    catch {memory={status:"unavailable",hits:[],warning:"No se pudo consultar GBrain. La lectura usa solo registros y análisis guardados de Project OS."};}
    const context=projectUpdateContext(c.state,c.snapshot,c.analysis,memory),output=await requestProjectUpdate(context),result=validateProjectUpdate(output.result,context);
    const saved={revision:c.revision,result,sources:context.labels,coverage:{included:context.sources.size,omitted:context.omittedRecords},memory:{status:memory.status,count:memory.hits.length,warning:memory.warning}};
    await finishAiRun(c.userId,body.requestId,saved,output.usage?.input_tokens,output.usage?.output_tokens);reserved=undefined;
    return json({latest:{id:body.requestId,createdAt:new Date().toISOString(),...saved}});
  } catch(error) {if(reserved) await failAiRun(reserved.userId,reserved.id).catch(()=>undefined);return failure(error);}
}
