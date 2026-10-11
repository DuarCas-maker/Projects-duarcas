import { contentHash } from "./brain-content";
import { validateMeetingPart, type MeetingFinding } from "./meeting-analysis";

export type MeetingRevision = {
  version:1; id:string; meetingId:string; fingerprint:string; contentHash:string;
  baseFindingId:string; baseFindingHash:string; instruction:string; createdAt:string;
  proposalSnapshotHash:string|null; finding:MeetingFinding;
};
export const revisionPrefix=(meetingId:string,fingerprint:string)=>`meeting-revision:v1:${meetingId}:${fingerprint}:`;
export const findingHash=(finding:MeetingFinding)=>contentHash(JSON.stringify(finding));

// AI can revise the proposed action, but never rewrite a source quote or its
// confidence. User instructions are provenance, not evidence from the meeting.
export function validateMeetingRevision(value:unknown,original:MeetingFinding):MeetingFinding {
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("Corrección no válida.");
  const row=value as Record<string,unknown>;
  const fields=["kind","title","description","date","priority","urgency","estimatedMinutes"];
  if(Object.keys(row).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(row,key))) throw new Error("Formato de corrección no válido.");
  const corrected={...row,quote:original.quote,confidence:original.confidence};
  const validated=validateMeetingPart({summary:"Corrección solicitada por el usuario",findings:[corrected]},original.quote,original.part).findings[0];
  return {...validated,id:original.id};
}
