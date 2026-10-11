import { MAX_MEETING_FINDINGS, MAX_MEETING_TASKS, MeetingEvidenceError } from "./meeting-analysis";

export type MeetingPassage={id:string;text:string};
// Every character remains in order, including Markdown, CRLF and Unicode.
// The model selects a passage ID; it never supplies the quotation to store.
export function meetingPassages(text:string):MeetingPassage[] {
  const passages:MeetingPassage[]=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+400,text.length);
    if(end<text.length){
      const candidate=text.slice(start,end);
      const boundary=Math.max(candidate.lastIndexOf("\n"),candidate.lastIndexOf(". "),candidate.lastIndexOf(" "));
      if(boundary>=200)end=start+boundary+1;
      if(text.length-end<8)end=text.length-8;
      if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    }
    passages.push({id:`e${String(passages.length+1).padStart(4,"0")}`,text:text.slice(start,end)});
    start=end;
  }
  return passages;
}
export function citablePassages(passages:MeetingPassage[]){return passages.filter(passage=>passage.text.trim().length>=8);}
export function resolveMeetingEvidence(value:unknown,passages:MeetingPassage[]) {
  const row=value as {summary:unknown;findings:Record<string,unknown>[]};
  if(!row||typeof row!=="object"||Array.isArray(row)||!Array.isArray(row.findings)||row.findings.length>MAX_MEETING_FINDINGS)throw new MeetingEvidenceError("shape");
  const byId=new Map(citablePassages(passages).map(passage=>[passage.id,passage.text.trim()]));
  return {summary:row.summary,findings:row.findings.map(finding=>{
    if(!finding||typeof finding!=="object"||Array.isArray(finding)||typeof finding.evidenceId!=="string"||!byId.has(finding.evidenceId))throw new MeetingEvidenceError("evidence_id");
    const {evidenceId:_id,quote:_untrustedQuote,...fields}=finding;
    return {...fields,quote:byId.get(finding.evidenceId)!};
  })};
}
// The provider bounds tasks separately. Persist the same flat findings used by
// existing saved parts, proposal IDs and approvals, without dropping any items.
export function resolveMeetingAnalysisResponse(value:unknown,passages:MeetingPassage[]) {
  const row=value as {summary:unknown;findings:Record<string,unknown>[];tasks:Record<string,unknown>[]};
  if(!row||typeof row!=="object"||Array.isArray(row)||!Array.isArray(row.findings)||!Array.isArray(row.tasks)||row.findings.length>MAX_MEETING_FINDINGS-MAX_MEETING_TASKS)throw new MeetingEvidenceError("shape");
  if(row.tasks.length>MAX_MEETING_TASKS)throw new MeetingEvidenceError("task_count");
  if(row.findings.some(finding=>!finding||finding.kind==="task")||row.tasks.some(finding=>!finding||finding.kind!=="task"))throw new MeetingEvidenceError("finding_shape");
  return resolveMeetingEvidence({summary:row.summary,findings:[...row.findings,...row.tasks]},passages);
}
