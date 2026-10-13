import { buildDailyCommand } from "./daily-commands";
import { CoreValidationError, databaseRow } from "./core-commands";
import { FINDING_LABELS, existingMeetingTask, type MeetingFinding } from "./meeting-analysis";
import { readAnalysisResource } from "./meetings";
import type { Workspace } from "./workspace-types";

export function buildMeetingProposal(state:Workspace,userId:string,meetingId:string,finding:MeetingFinding,commandId:string,now=new Date().toISOString()) {
  const item=state.knowledge.find(item=>item.id===meetingId&&item.userId===userId),meeting=item&&readAnalysisResource(item),context=item?.itemType==="project_context";
  if(!item||!meeting) throw new CoreValidationError("Reunión no encontrada.",404);
  if(finding.kind==="task" && existingMeetingTask(state,item.projectId,finding.title)) throw new CoreValidationError("Ya existe una tarea similar. Revisa la tarea actual antes de crear otra.",409);
  const evidence=`${context ? "Contexto del proyecto" : "Reunión"}: ${item.title}${meeting.date ? ` · ${meeting.date}` : ""} · fragmento ${finding.part+1}\nCita verificada: «${finding.quote}»`;
  const data={title:finding.title,description:finding.description,priority:finding.priority,urgency:finding.urgency,estimatedMinutes:finding.estimatedMinutes,deadline:finding.date,responsibleNames:finding.responsibleNames??[]};
  const marker={source:"openai",...(context ? {contextId:meetingId,contextFingerprint:meeting.fingerprint} : {meetingId,meetingFingerprint:meeting.fingerprint}),findingId:finding.id,findingKind:finding.kind};
  if(finding.kind==="task") {
    const plan=buildDailyCommand(state,userId,"create_task_suggestion",{...data,projectId:item.projectId,reason:context ? "Tarea propuesta a partir del contexto del proyecto; revisa el alcance, la fecha y la estimación antes de aprobar." : "Tarea detectada en la reunión; revisa el alcance, la fecha y la estimación antes de aprobar.",evidence},commandId,now);
    const proposal=plan.changes.find(change=>change.table==="ai_suggestions")!.row;
    proposal.payload=JSON.stringify({...JSON.parse(proposal.payload as string),...marker});proposal.confidence=finding.confidence;
    proposal.impact=context ? "Crear una tarea pendiente conservando el documento de contexto como evidencia" : "Crear una tarea pendiente conservando su evidencia de reunión";
    return plan;
  }
  const proposal={id:commandId,userId,projectId:item.projectId,suggestionType:`${context ? "context" : "meeting"}_${finding.kind}`,title:finding.title,reason:"Hallazgo detectado por IA; necesita tu confirmación.",confidence:finding.confidence,evidence,impact:"Registrar en el historial. No modifica fechas, pagos, bloqueos ni el estado del proyecto.",status:"pending",payload:JSON.stringify({action:context ? "record_context_finding" : "record_meeting_finding",data,...marker}),createdAt:now};
  const event={id:commandId,userId,projectId:item.projectId,eventType:"organization",title:`${FINDING_LABELS[finding.kind]} enviada a revisión`,description:finding.title,sourceType:context ? "project_context" : "meeting",sourceId:meetingId,eventDate:now,createdAt:now};
  return {id:commandId,projectId:item.projectId,changes:[{table:"ai_suggestions",kind:"insert" as const,row:databaseRow(proposal)},{table:"project_events",kind:"insert" as const,row:databaseRow(event)}]};
}
