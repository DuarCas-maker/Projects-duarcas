import { contentHash } from "./brain-content";
import type { Workspace } from "./workspace-types";

export const FINDING_LABELS = {decision:"Decisión",commitment:"Compromiso",deadline:"Fecha",blocker:"Bloqueador",question:"Pregunta abierta",task:"Tarea"} as const;
export type FindingKind = keyof typeof FINDING_LABELS;
export const MAX_MEETING_FINDINGS = 8;
export const MAX_MEETING_TASKS = 3;
export type MeetingFinding = {id:string;kind:FindingKind;title:string;description:string;quote:string;date:string|null;confidence:number;priority:number;urgency:number;estimatedMinutes:number;part:number};
export type MeetingPart = {version:1;meetingId:string;fingerprint:string;contentHash:string;part:number;totalParts:number;summary:string;findings:MeetingFinding[]};
export type MeetingAnalysis = {status:"not_started"|"partial"|"ready";completedParts:number;totalParts:number;findings:MeetingFinding[];summaries:string[]};
export class MeetingEvidenceError extends Error {constructor(public code:string){super(["quote","evidence_id"].includes(code)?"No se pudo verificar la cita de un hallazgo. Reintenta el fragmento; no se aplicó ningún cambio.":code==="date"?"La IA devolvió una fecha no válida. Reintenta el fragmento; no se aplicó ningún cambio.":code==="task_count"?"La IA devolvió más de tres tareas en un fragmento. Reintenta el fragmento; el avance guardado se conserva.":"La respuesta de IA no cumple el formato del análisis. Reintenta el fragmento; no se aplicó ningún cambio.");}}
export const normalizedTitle = (title:string) => title.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export function similarTask(title:string, other:string) {
  const a=normalizedTitle(title),b=normalizedTitle(other);
  if(a===b) return true;
  const left=new Set(a.split(" ").filter(word=>word.length>2)),right=new Set(b.split(" ").filter(word=>word.length>2));
  const common=[...left].filter(word=>right.has(word)).length;
  return left.size>=3 && right.size>=3 && common/Math.max(left.size,right.size)>=0.8;
}
export function existingMeetingTask(state:Workspace,projectId:string,title:string) {return state.tasks.find(task=>task.projectId===projectId && task.status!=="cancelled" && similarTask(task.title,title));}
export function validateMeetingPart(value:unknown,text:string,part:number) {
  const fail=(code:string):never=>{throw new MeetingEvidenceError(code);};
  const row=value as {summary:string;findings:MeetingFinding[]};
  const str=(v:unknown,max:number)=>typeof v==="string"&&v.trim().length>0&&v.length<=max;
  if(!row||!str(row.summary,700)||!Array.isArray(row.findings)||row.findings.length>MAX_MEETING_FINDINGS) return fail("shape");
  let tasks=0;
  const findings=row.findings.map((finding,index)=>{
    if(!finding || !Object.hasOwn(FINDING_LABELS,finding.kind) || !str(finding.title,180)||!str(finding.description,700)) return fail("finding_shape");
    if(!str(finding.quote,400)||finding.quote.trim().length<8||!text.includes(finding.quote)) return fail("quote");
    if(!Number.isInteger(finding.confidence)||finding.confidence<0||finding.confidence>100) return fail("confidence");
    if(finding.date!==null && (typeof finding.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(finding.date)||!Number.isFinite(Date.parse(finding.date))||new Date(`${finding.date}T12:00:00Z`).toISOString().slice(0,10)!==finding.date)) return fail("date");
    if(![finding.priority,finding.urgency].every(n=>Number.isInteger(n)&&n>=1&&n<=5)||!Number.isInteger(finding.estimatedMinutes)||finding.estimatedMinutes<5||finding.estimatedMinutes>480) return fail("ranking");
    if(finding.kind==="task" && ++tasks>MAX_MEETING_TASKS) return fail("task_count");
    return {...finding,id:`${part}:${index}`,part};
  });
  return {summary:row.summary,findings};
}
export function combineMeetingParts(parts:MeetingPart[]):MeetingAnalysis {
  if(parts.some(part=>!Number.isInteger(part.part)||!Number.isInteger(part.totalParts)||part.part<0||part.part>=part.totalParts||part.totalParts>16||part.totalParts<1||part.totalParts!==parts[0].totalParts||part.contentHash!==parts[0].contentHash||part.meetingId!==parts[0].meetingId||part.fingerprint!==parts[0].fingerprint)) throw new Error("El análisis guardado contiene fragmentos incompatibles.");
  const indexed=new Map(parts.map(part=>[part.part,part]));
  const totalParts=parts[0]?.totalParts??0;
  let completedParts=0;while(indexed.has(completedParts)) completedParts++;
  const ready=totalParts>0&&completedParts===totalParts;
  const findings:MeetingFinding[]=[];
  if(ready) for(let index=0;index<totalParts;index++) for(const finding of indexed.get(index)!.findings) if(!findings.some(other=>other.kind===finding.kind&&similarTask(other.title,finding.title))) findings.push(finding);
  return {status:ready?"ready":completedParts?"partial":"not_started",completedParts,totalParts,findings,summaries:ready?Array.from({length:totalParts},(_,index)=>indexed.get(index)!.summary):[]};
}
export async function meetingProposalId(meetingId:string,fingerprint:string,finding:MeetingFinding) {return `meeting-proposal-${(await contentHash(`${meetingId}:${fingerprint}:${finding.kind}:${normalizedTitle(finding.title)}`)).slice(0,32)}`;}
