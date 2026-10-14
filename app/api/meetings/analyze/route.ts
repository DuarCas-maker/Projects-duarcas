import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { AiError, aiStatus, findAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { meetingParts, meetingQueryPrefix, reserveMeetingPart } from "@/db/meeting-analysis";
import { knowledgeText } from "@/lib/brain-provider";
import { readAnalysisResource } from "@/lib/meetings";
import { memoryChunks, contentHash } from "@/lib/brain-content";
import { BrainError } from "@/lib/gbrain-client";
import { requestMeetingAnalysis } from "@/lib/meeting-ai-provider";
import { combineMeetingParts, validateMeetingPart, meetingProposalId, MeetingEvidenceError, type MeetingPart } from "@/lib/meeting-analysis";
import { taskComparisonContext } from "@/lib/task-matches";
import { buildMeetingProposal } from "@/lib/meeting-proposals";
import { persistCorePlan } from "@/db/core-mutations";
import { CoreValidationError } from "@/lib/core-commands";
import { SupabaseConflictError } from "@/db/supabase";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const failure=(error:unknown)=>{
  if(error instanceof SyntaxError) return json({error:"Entrada JSON no válida."},400);
  if(error instanceof AiError||error instanceof BrainError||error instanceof CoreValidationError) return json({error:error.message},error.status);
  if(error instanceof SupabaseConflictError) return json({error:error.message},409);
  if(error instanceof WorkspaceConfigurationError) return json({error:error.message},error.status);
  console.error("meeting_analysis_failed",error instanceof Error?error.name:"unknown");
  return json({error:"No se pudo completar el análisis. El avance guardado se conserva; no se aplicó ningún cambio."},503);
};
async function context(id:unknown) {
  if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new AiError("Recurso de análisis no válido.",400);
  const userId=await currentWorkspaceId(),state=await getWorkspaceState(userId),item=state.knowledge.find(item=>item.id===id&&item.userId===userId),meeting=item&&readAnalysisResource(item);
  const project=item&&state.projects.find(project=>project.id===item.projectId);
  if(!item||!meeting||!project) throw new AiError("Recurso de análisis no encontrado.",404);
  const prefix=meetingQueryPrefix(item.id,meeting.fingerprint),parts=await meetingParts(userId,item.projectId,prefix);
  return {userId,state,item,meeting,project,prefix,parts};
}
export async function GET(request:Request) {
  try {const c=await context(new URL(request.url).searchParams.get("id"));return json({analysis:combineMeetingParts(c.parts),ai:await aiStatus(c.userId,c.item.projectId)});}catch(error){return failure(error);}
}
export async function POST(request:Request) {
  let reserved:{userId:string;id:string}|undefined;
  try {
    await currentWorkspaceId(request);
    const input=await request.text();if(input.length>3000) throw new AiError("Entrada demasiado grande.",413);
    const body=JSON.parse(input) as Record<string,unknown>;if(!body||typeof body!=="object"||Array.isArray(body)) throw new AiError("Entrada no válida.",400);
    const c=await context(body.id),analysis=combineMeetingParts(c.parts);
    if(body.action==="propose") {
      if(analysis.status!=="ready") throw new AiError("Completa el análisis antes de enviar propuestas.",409);
      const finding=analysis.findings.find(finding=>finding.id===body.findingId);if(!finding) throw new AiError("Hallazgo no encontrado.",404);
      const commandId=await meetingProposalId(c.item.id,c.meeting.fingerprint,finding);
      if(c.state.suggestions.some(suggestion=>suggestion.id===commandId)) return json({state:c.state,proposalId:commandId,replayed:true});
      const plan=buildMeetingProposal(c.state,c.userId,c.item.id,finding,commandId);
      return json({...await persistCorePlan(c.userId,plan),proposalId:commandId});
    }
    if(body.action!=="analyze") throw new AiError("Acción no válida.",400);
    if(analysis.status==="ready") return json({analysis,replayed:true});
    if(typeof body.requestId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) throw new AiError("Identificador no válido.",400);
    // Read and credential-check ALL originals before any external request. No Drive fetch.
    const text=await knowledgeText(c.userId,c.item),hash=await contentHash(text),chunks=memoryChunks(c.item.title,c.project.name,text);
    if(c.parts.some(part=>part.contentHash!==hash||part.totalParts!==chunks.length)) throw new AiError("Los documentos cambiaron respecto al análisis guardado. No se mezclaron versiones.",409);
    const index=analysis.completedParts;
    if(!chunks[index]) throw new AiError("El avance guardado no coincide con los documentos.",409);
    const query=`${c.prefix}${index}`,existing=await findAiRun(c.userId,body.requestId);
    if(existing) {
      if(existing.scope!==c.item.projectId||existing.kind!=="meeting_fragment"||!existing.query.startsWith(c.prefix)) throw new AiError("Esta operación pertenece a otro análisis.",409);
      if(existing.status==="completed") return json({analysis,replayed:true});
      throw new AiError("La consulta anterior está en curso o falló. Continúa con una operación nueva; el avance se conserva.",409);
    }
    await reserveMeetingPart(c.userId,body.requestId,c.item.projectId,query);reserved={userId:c.userId,id:body.requestId};
    const output=await requestMeetingAnalysis(chunks[index].text,{title:c.item.title,date:c.meeting.date,resourceKind:c.item.itemType === "project_context" ? "project_context" : "meeting",project:c.project.name,part:index+1,totalParts:chunks.length,existingTasks:taskComparisonContext(c.state,c.item.projectId),previousTasks:c.parts.flatMap(p=>p.findings.filter(f=>f.kind==="task").map(f=>({title:f.title,description:f.description,date:f.date,responsibleNames:f.responsibleNames}))),pendingProposals:c.state.suggestions.filter(s=>s.projectId===c.item.projectId&&s.status==="pending").map(s=>({id:s.id,title:s.title,reason:s.reason}))});
    let validated:ReturnType<typeof validateMeetingPart>;try{validated=validateMeetingPart(output.result,chunks[index].text,index);}catch(error){console.error("meeting_analysis_invalid",error instanceof MeetingEvidenceError?error.code:"shape");throw new AiError((error as Error).message,502);}
    const result:MeetingPart={version:1,meetingId:c.item.id,fingerprint:c.meeting.fingerprint,contentHash:hash,part:index,totalParts:chunks.length,...validated};
    await finishAiRun(c.userId,body.requestId,result,output.usage?.input_tokens,output.usage?.output_tokens);reserved=undefined;
    return json({analysis:combineMeetingParts([...c.parts,result])});
  } catch(error) {if(reserved) await failAiRun(reserved.userId,reserved.id).catch(()=>undefined);return failure(error);}
}
