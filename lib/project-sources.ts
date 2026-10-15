import type { Workspace } from "./workspace-types";
import { activeKnowledge, readTaskAttachment } from "./task-attachments";
import { projectRepositorySources, readGithubSource } from "./github-context";
import { readAnalysisResource } from "./meetings";
import { contentHash } from "./brain-content";
import { searchFingerprint } from "./global-search";

export type SourceEntry = {
  id:string; projectId:string; title:string; kind:string; version:string; date:string|null;
  status:"ready"|"pending"|"unavailable"|"excluded"; mode:"none"|"summary"|"full"|"excerpt";
  reason?:string; evidenceId?:string; text?:string; sha?:string; url?:string; syncedAt?:string|null;
};
export type SourceChange = {id:string;projectId:string;title:string;kind:"added"|"updated"|"removed"};
export type SourceCoverage = {
  revision:string; generatedAt:string; entries:SourceEntry[];
  total:number; ready:number; used:number; pending:number; unavailable:number; excluded:number;
  baseline:string|null; changes:SourceChange[]; omittedRecords?:number;
};
export function currentProjectKnowledge(state:Workspace,userId:string,projectIds:string[]) {
  const ids=new Set(state.projects.filter(p=>p.userId===userId && projectIds.includes(p.id)).map(p=>p.id));
  const repos=new Set([...ids].flatMap(id=>projectRepositorySources(state,userId,id).map(s=>s.item.id)));
  return activeKnowledge(state).filter(k=>k.userId===userId && ids.has(k.projectId) && (k.itemType!=="repository" || repos.has(k.id)));
}
export async function sourceCatalog(state:Workspace,userId:string,projectIds:string[]):Promise<SourceEntry[]> {
  const items=currentProjectKnowledge(state,userId,projectIds);
  const entries:SourceEntry[]=await Promise.all(items.map(async item=>{
    const resource=readAnalysisResource(item),repo=readGithubSource(item);
    return {id:item.id,projectId:item.projectId,title:item.title,kind:item.itemType,version:await searchFingerprint(item),date:resource ? resource.date||null : item.occurredAt,
      status:"pending",mode:"none",...(repo?{sha:repo.sha,url:repo.url,syncedAt:state.repositories.find(r=>r.id===repo.repositoryId)?.lastSync??null}:{}),
    };
  }));
  const allowed=new Set(state.projects.filter(p=>p.userId===userId && projectIds.includes(p.id)).map(p=>p.id));
  for(const item of state.knowledge.filter(k=>k.userId===userId && allowed.has(k.projectId) && k.itemType==="task_attachment")) {
    const attachment=readTaskAttachment(item);
    if(attachment?.published)continue;
    entries.push({id:item.id,projectId:item.projectId,title:item.title,kind:"task_attachment",version:await searchFingerprint(item),date:item.occurredAt,status:"excluded",mode:"none",reason:"Pendiente de «Enviar a contexto» desde Archivos de la tarea."});
  }
  for(const repo of state.repositories.filter(r=>r.userId===userId && allowed.has(r.projectId))) {
    if(projectRepositorySources(state,userId,repo.projectId).some(s=>s.repository.id===repo.id))continue;
    entries.push({id:`repository:${repo.id}`,projectId:repo.projectId,title:`${repo.owner}/${repo.repo}`,kind:"repository",version:await contentHash(JSON.stringify(repo)),date:null,status:"pending",mode:"none",reason:"Repositorio conectado sin una copia vigente. Sincroniza desde Contexto.",syncedAt:repo.lastSync});
  }
  return entries.sort((a,b)=>a.projectId.localeCompare(b.projectId)||a.id.localeCompare(b.id));
}
export async function sourceCoverage(entries:SourceEntry[],previous?:SourceCoverage):Promise<SourceCoverage> {
  const prior=new Map(previous?.entries.map(e=>[e.id,e])??[]),current=new Map(entries.map(e=>[e.id,e]));
  const changes:SourceChange[]=previous?[...entries.flatMap<SourceChange>(e=>!prior.has(e.id)?[{id:e.id,projectId:e.projectId,title:e.title,kind:"added"}]:prior.get(e.id)!.version!==e.version?[{id:e.id,projectId:e.projectId,title:e.title,kind:"updated"}]:[]),...previous.entries.filter(e=>!current.has(e.id)).map(e=>({id:e.id,projectId:e.projectId,title:e.title,kind:"removed" as const}))]:[];
  return {revision:await contentHash(JSON.stringify(entries.map(e=>[e.id,e.projectId,e.version,e.status]))),generatedAt:new Date().toISOString(),entries,total:entries.length,ready:entries.filter(e=>e.status==="ready").length,used:entries.filter(e=>["full","excerpt","summary"].includes(e.mode)).length,pending:entries.filter(e=>e.status==="pending").length,unavailable:entries.filter(e=>e.status==="unavailable").length,excluded:entries.filter(e=>e.status==="excluded").length,baseline:previous?.generatedAt??null,changes};
}
// The final context builder is authoritative about what the model actually saw.
export function selectedSourceCoverage(coverage:SourceCoverage|undefined,ids:Set<string>,omittedRecords=0):SourceCoverage|undefined {
  if(!coverage)return undefined;
  const entries=coverage.entries.map(e=>{
    if(e.evidenceId && ids.has(e.evidenceId))return {...e};
    if(ids.has(e.id))return {...e,mode:"summary" as const,text:undefined,evidenceId:e.id};
    return {...e,mode:"none" as const,text:undefined,evidenceId:undefined,reason:e.reason??"Contenido fuera de esta respuesta por relevancia o límite de tamaño."};
  });
  return {...coverage,entries,used:entries.filter(e=>e.mode!=="none").length,omittedRecords};
}
export function isProjectNews(query:string) {return /que hay de nuevo|novedades|que cambio|actualiz|desde|reciente/.test(query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase());}
