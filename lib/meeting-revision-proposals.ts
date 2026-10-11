import { CoreValidationError, databaseRow, type CoreChange } from "./core-commands";
import { contentHash } from "./brain-content";
import { buildMeetingProposal } from "./meeting-proposals";
import { type MeetingFinding, meetingProposalId } from "./meeting-analysis";
import { findingHash, type MeetingRevision } from "./meeting-revision";
import type { Workspace } from "./workspace-types";

export async function buildRevisionProposal(state:Workspace,userId:string,original:MeetingFinding,revision:MeetingRevision) {
  if(revision.baseFindingId!==original.id||revision.baseFindingHash!==await findingHash(original)||revision.finding.quote!==original.quote) throw new CoreValidationError("La corrección no corresponde al hallazgo original.",409);
  const id=await meetingProposalId(revision.meetingId,revision.fingerprint,original),previous=state.suggestions.find(item=>item.id===id);
  if(previous) {
    if(previous.status!=="pending") throw new CoreValidationError("Esta propuesta ya fue aprobada o rechazada; no se puede reemplazar.",409);
    if(await findingHashSnapshot(previous)!==revision.proposalSnapshotHash) throw new CoreValidationError("La propuesta cambió después de generar la corrección. Recarga y genera un borrador nuevo.",409);
  } else if(revision.proposalSnapshotHash!==null) throw new CoreValidationError("La propuesta original ya no está disponible. Recarga antes de continuar.",409);
  const plan:{id:string;projectId:string;changes:CoreChange[]}=buildMeetingProposal(state,userId,revision.meetingId,revision.finding,id);
  const change=plan.changes.find(change=>change.table==="ai_suggestions")!;
  const payload=JSON.parse(change.row.payload as string);
  change.row.payload=JSON.stringify({...payload,originalFinding:original,revision:{id:revision.id,instruction:revision.instruction,createdAt:revision.createdAt}});
  change.row.reason="Propuesta corregida con IA según tu instrucción; los cambios añadidos no son acuerdos confirmados por la reunión. Revisa antes de aprobar.";
  change.row.evidence=`${change.row.evidence}\nCorrección solicitada por el usuario: ${revision.instruction}`;
  if(previous) {change.kind="update";change.expected=databaseRow(previous);change.row.created_at=previous.createdAt;}
  // Stable proposal identity prevents another task when the title/type changes.
  // The event ID is revision-specific so retrying never duplicates history.
  const event=plan.changes.find(change=>change.table==="project_events")!;
  event.row.id=`meeting-revision-${revision.id}`;event.row.title=previous?"Propuesta corregida y reenviada a revisión":"Corrección enviada a revisión";
  event.row.source_type="meeting";event.row.source_id=revision.meetingId;
  return plan;
}
export const findingHashSnapshot=(snapshot:Workspace["suggestions"][number])=>contentHash(JSON.stringify(snapshot));
