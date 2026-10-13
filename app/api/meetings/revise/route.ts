import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { AiError, aiStatus, findAiRun, reserveAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { meetingParts, meetingQueryPrefix } from "@/db/meeting-analysis";
import { meetingRevisions } from "@/db/meeting-revisions";
import { combineMeetingParts, meetingProposalId, FINDING_LABELS, type MeetingFinding } from "@/lib/meeting-analysis";
import { findingHash, revisionPrefix, type MeetingRevision } from "@/lib/meeting-revision";
import { buildRevisionProposal, findingHashSnapshot } from "@/lib/meeting-revision-proposals";
import { requestMeetingRevision } from "@/lib/meeting-revision-provider";
import { readAnalysisResource } from "@/lib/meetings";
import { knowledgeText } from "@/lib/brain-provider";
import { contentHash, safeMemoryText } from "@/lib/brain-content";
import { BrainError, boundedText } from "@/lib/gbrain-client";
import { CoreValidationError } from "@/lib/core-commands";
import { persistCorePlan } from "@/db/core-mutations";
import { SupabaseConflictError } from "@/db/supabase";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function failure(error:unknown) {
  if(error instanceof SyntaxError)return json({error:"Entrada JSON no válida."},400);
  if(error instanceof AiError||error instanceof BrainError||error instanceof CoreValidationError||error instanceof WorkspaceConfigurationError)return json({error:error.message},error.status);
  if(error instanceof SupabaseConflictError)return json({error:error.message},409);
  console.error("meeting_revision_failed",error instanceof Error?error.name:"unknown");return json({error:"No se pudo completar la corrección. El original se conserva y no se creó ninguna tarea."},503);
}
async function context(userId:string,id:unknown) {
  if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new AiError("Recurso de análisis no válido.",400);
  const state=await getWorkspaceState(userId),item=state.knowledge.find(item=>item.id===id&&item.userId===userId),meeting=item&&readAnalysisResource(item),project=item&&state.projects.find(project=>project.id===item.projectId&&project.userId===userId);
  if(!item||!meeting||!project)throw new AiError("Recurso de análisis no encontrado.",404);
  const parts=await meetingParts(userId,project.id,meetingQueryPrefix(item.id,meeting.fingerprint)),analysis=combineMeetingParts(parts);
  return {state,item,meeting,project,parts,analysis};
}
export async function GET(request:Request) {
  try {const userId=await currentWorkspaceId(),c=await context(userId,new URL(request.url).searchParams.get("id")),drafts=await meetingRevisions(userId,c.project.id,c.item.id,c.meeting.fingerprint);
    const valid=[];for(const draft of drafts){const original=c.analysis.findings.find(finding=>finding.id===draft.baseFindingId);if(original&&draft.baseFindingHash===await findingHash(original))valid.push(draft);}
    return json({drafts:valid,ai:await aiStatus(userId,c.project.id)});
  }catch(error){return failure(error);}
}
export async function POST(request:Request) {
  let reserved:{userId:string;id:string}|undefined;
  try {
    const userId=await currentWorkspaceId(request),body=JSON.parse(await boundedText(new Response(request.body),8000)) as Record<string,unknown>;
    if(!body||typeof body!=="object"||Array.isArray(body)||!["revise","propose"].includes(String(body.action)))throw new AiError("Acción de corrección no válida.",400);
    const c=await context(userId,body.id),original=c.analysis.findings.find(finding=>finding.id===body.findingId);
    if(c.analysis.status!=="ready")throw new AiError("Completa el análisis antes de corregir un hallazgo.",409);
    if(!original)throw new AiError("Hallazgo no encontrado.",404);
    const baseFindingHash=await findingHash(original),prefix=revisionPrefix(c.item.id,c.meeting.fingerprint),proposalId=await meetingProposalId(c.item.id,c.meeting.fingerprint,original),proposal=c.state.suggestions.find(item=>item.id===proposalId);
    async function draft(id:unknown) {
      if(!uuid(id))throw new AiError("Identificador de borrador no válido.",400);
      const run=await findAiRun(userId,id);
      if(!run||run.scope!==c.project.id||run.kind!=="meeting_revision"||!run.query.startsWith(prefix)||run.status!=="completed")throw new AiError("Borrador no encontrado en este recurso.",404);
      const saved=JSON.parse(run.result) as MeetingRevision;
      if(saved.version!==1||saved.id!==id||saved.meetingId!==c.item.id||saved.fingerprint!==c.meeting.fingerprint||saved.baseFindingId!==original!.id||saved.baseFindingHash!==baseFindingHash||saved.finding.quote!==original!.quote)throw new AiError("La corrección no coincide con el hallazgo actual.",409);
      return saved;
    }
    if(body.action==="propose") {
      const saved=await draft(body.revisionId);
      if(proposal&&JSON.parse(proposal.payload).revision?.id===saved.id)return json({state:c.state,proposalId,replayed:true});
      const text=await knowledgeText(userId,c.item);if(await contentHash(text)!==saved.contentHash)throw new AiError("Los documentos cambiaron después de generar la corrección.",409);
      return json({...await persistCorePlan(userId,await buildRevisionProposal(c.state,userId,original,saved)),proposalId});
    }
    if(typeof body.instruction!=="string"||!body.instruction.trim()||body.instruction.length>1200)throw new AiError("Escribe una instrucción de hasta 1.200 caracteres.",400);
    if(!uuid(body.requestId))throw new AiError("Identificador de corrección no válido.",400);
    const instruction=safeMemoryText(body.instruction),previous=body.previousRevisionId?await draft(body.previousRevisionId):null;
    const operation=prefix+JSON.stringify({findingId:original.id,baseFindingHash,instruction,previousRevisionId:previous?.id??null}),existing=await findAiRun(userId,body.requestId);
    if(existing) {
      if(existing.scope!==c.project.id||existing.kind!=="meeting_revision"||existing.query!==operation)throw new AiError("Esta operación pertenece a otra corrección.",409);
      if(existing.status==="completed")return json({draft:await draft(body.requestId),replayed:true});
      throw new AiError("La corrección anterior sigue en curso o falló. Espera o inicia otro intento.",409);
    }
    if(proposal&&proposal.status!=="pending")throw new AiError("Esta propuesta ya fue resuelta. No se modificará con un prompt.",409);
    const text=await knowledgeText(userId,c.item),hash=await contentHash(text);
    if(c.parts.some(part=>part.contentHash!==hash))throw new AiError("Los documentos cambiaron respecto al análisis. No se mezclaron versiones.",409);
    await reserveAiRun(userId,body.requestId,c.project.id,"meeting_revision",operation);reserved={userId,id:body.requestId};
    let current=previous?.finding??original;
    if(!previous&&proposal) {
      const payload=JSON.parse(proposal.payload),data=payload.data;
      // Keep manual edits of a pending proposal as the starting point, instead
      // of silently resetting its scope/date when correcting another detail.
      if(data&&typeof data==="object")current={...original,kind:Object.hasOwn(FINDING_LABELS,payload.findingKind)?payload.findingKind:original.kind,title:String(data.title??proposal.title),description:String(data.description??original.description),date:data.deadline??null,priority:Number(data.priority??original.priority),urgency:Number(data.urgency??original.urgency),estimatedMinutes:Number(data.estimatedMinutes??original.estimatedMinutes)} as MeetingFinding;
    }
    const output=await requestMeetingRevision(original,current,instruction,{title:c.item.title,date:c.meeting.date,resourceKind:c.item.itemType === "project_context" ? "project_context" : "meeting",project:c.project.name});
    const result:MeetingRevision={version:1,id:body.requestId,meetingId:c.item.id,fingerprint:c.meeting.fingerprint,contentHash:hash,baseFindingId:original.id,baseFindingHash,instruction,createdAt:new Date().toISOString(),proposalSnapshotHash:proposal?await findingHashSnapshot(proposal):null,finding:output.finding};
    await finishAiRun(userId,body.requestId,result,output.usage?.input_tokens,output.usage?.output_tokens);reserved=undefined;
    return json({draft:result});
  }catch(error){if(reserved)await failAiRun(reserved.userId,reserved.id).catch(()=>undefined);return failure(error);}
}
