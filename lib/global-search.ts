import type { Workspace } from "./workspace-types";
import { readMeeting } from "./meetings";
import { contentHash } from "./brain-content";

export type SearchTab = "overview" | "tasks" | "milestones" | "payments" | "timeline" | "knowledge";
export type SearchResult = { id:string; type:string; projectId:string|null; label:string; detail:string; excerpt:string; tab:SearchTab; knowledgeId?:string };
export type SearchCoverage = { total:number; ready:number; pending:{id:string;title:string}[]; unavailable:{id:string;title:string;error:string}[] };
export type GlobalSearchResponse = { results:SearchResult[]; total:number; page:number; pages:number; coverage:SearchCoverage };
export const foldSearchText=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function searchExcerpt(text:string,query:string) {
  const at=foldSearchText(text).indexOf(foldSearchText(query));
  const start=Math.max(0,at-70),end=Math.min(text.length,Math.max(0,at)+240);
  return `${start ? "…" : ""}${text.slice(start,end).replace(/\s+/g," ")}${end<text.length ? "…" : ""}`;
}
export async function searchFingerprint(item:Workspace["knowledge"][number]) {
  return contentHash(JSON.stringify({version:1,projectId:item.projectId,itemType:item.itemType,title:item.title,summary:item.summary,sourceReference:item.sourceReference,storageKey:item.storageKey,occurredAt:item.occurredAt}));
}
export function searchRecords(state:Workspace,query:string):SearchResult[] {
  const matches:SearchResult[]=[];
  const projectIds=new Set(state.projects.map(p=>p.id)),q=foldSearchText(query.trim());if(!q)return matches;
  const add=(row:Omit<SearchResult,"excerpt"|"detail">,text:string)=>{
    if(row.projectId && !projectIds.has(row.projectId))return;
    if(foldSearchText(text).includes(q))matches.push({...row,detail:row.projectId ? state.projects.find(p=>p.id===row.projectId)?.name ?? "" : "Inbox",excerpt:searchExcerpt(text,query.trim())});
  };
  state.projects.forEach(p=>add({id:p.id,type:"Proyecto",projectId:p.id,label:p.name,tab:"overview"},[p.name,p.description,p.currentSummary,p.nextStepSummary,p.blockedReason,p.operationalStatus,p.commercialStatus].filter(Boolean).join("\n")));
  state.tasks.forEach(t=>add({id:t.id,type:"Tarea",projectId:t.projectId,label:t.title,tab:"tasks"},[t.title,t.description,t.blockingReason,t.status,t.deadline].filter(Boolean).join("\n")));
  state.milestones.forEach(m=>add({id:m.id,type:"Hito",projectId:m.projectId,label:m.name,tab:"milestones"},[m.name,m.description,m.status].join("\n")));
  state.events.forEach(e=>add({id:e.id,type:"Historial",projectId:e.projectId,label:e.title,tab:"timeline"},`${e.title}\n${e.description}`));
  state.knowledge.forEach(k=>{const meeting=readMeeting(k);add({id:k.id,type:meeting ? "Reunión" : "Contexto",projectId:k.projectId,label:k.title,tab:"knowledge",knowledgeId:k.id},[k.title,k.summary,meeting ? meeting.files.map(f=>f.name).join("\n") : k.sourceReference].filter(Boolean).join("\n"));});
  state.inbox.forEach(i=>add({id:i.id,type:"Inbox",projectId:i.detectedProjectId && projectIds.has(i.detectedProjectId) ? i.detectedProjectId : null,label:i.content.slice(0,100),tab:"overview"},i.content));
  state.suggestions.forEach(s=>{if(!s.projectId)return;add({id:s.id,type:s.status==="pending" ? "Propuesta pendiente" : "Propuesta revisada",projectId:s.projectId,label:s.title,tab:"overview"},[s.title,s.reason,s.evidence,s.impact].join("\n"));});
  return matches;
}

export function mergeSearchResults(records:SearchResult[],documents:SearchResult[],page=1):Omit<GlobalSearchResponse,"coverage"> {
  const results=[...documents,...records].filter((row,index,all)=>all.findIndex(other=>other.id===row.id && other.projectId===row.projectId && (other.knowledgeId || !row.knowledgeId))===index);
  const pages=Math.max(1,Math.ceil(results.length/20)),selected=Math.min(Math.max(1,page),pages);
  return {results:results.slice((selected-1)*20,selected*20),total:results.length,page:selected,pages};
}
