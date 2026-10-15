import { env } from "cloudflare:workers";
import type { Workspace } from "@/lib/workspace-types";
import { indexKnowledge, readIndexedSource } from "./knowledge-search";
import { currentProjectKnowledge, sourceCatalog, sourceCoverage, isProjectNews, type SourceCoverage } from "@/lib/project-sources";
import { boundedMemoryExcerpt } from "@/lib/memory-answer";
import { foldSearchText } from "@/lib/global-search";
import { safeSourceText } from "@/lib/brain-content";
import type { BrainHit } from "@/lib/brain-types";

export async function projectSourceInventory(userId:string,state:Workspace,projectIds:string[]) {
  const entries=await sourceCatalog(state,userId,projectIds);
  if(!env.DB){for(const e of entries)if(e.status!=="excluded")e.reason="El índice de contenido no está disponible.";return sourceCoverage(entries);}
  const rows=(await env.DB.prepare("SELECT knowledge_id,project_id,fingerprint,status,error FROM knowledge_search WHERE user_id = ?").bind(userId).all<{knowledge_id:string;project_id:string;fingerprint:string;status:string;error:string}>()).results;
  const byId=new Map(rows.map(r=>[r.knowledge_id,r]));
  for(const entry of entries) {
    if(entry.status==="excluded" || entry.id.startsWith("repository:"))continue;
    const row=byId.get(entry.id);
    if(!row || row.project_id!==entry.projectId || row.fingerprint!==entry.version){entry.reason="Contenido pendiente de preparación o de actualización.";continue;}
    entry.status=row.status==="ready"?"ready":"unavailable";
    entry.reason=entry.status==="unavailable"?(row.error||"No se pudo extraer el texto del original."):undefined;
  }
  return sourceCoverage(entries);
}
export async function prepareProjectSources(userId:string,state:Workspace,projectIds:string[],retry=false) {
  const inventory=await projectSourceInventory(userId,state,projectIds),items=currentProjectKnowledge(state,userId,projectIds);
  const pending=inventory.entries.filter(e=>e.status==="pending" || retry && e.status==="unavailable").sort((a,b)=>(b.date??"").localeCompare(a.date??""));
  let prepared=0;
  // Bound legacy backfill work per request. New uploads already index on save.
  for(const entry of pending.filter(e=>items.some(i=>i.id===e.id)).slice(0,4)) {
    const item=items.find(i=>i.id===entry.id)!;
    try{await indexKnowledge(userId,item,retry);prepared++;}catch{/* Retain pending and the original; explicit retry remains available. */}
  }
  return {coverage:await projectSourceInventory(userId,state,projectIds),prepared};
}
export async function projectSourceContext(userId:string,state:Workspace,projectIds:string[],query:string,previous?:SourceCoverage,prepare=true) {
  const coverage=prepare?(await prepareProjectSources(userId,state,projectIds)).coverage:await projectSourceInventory(userId,state,projectIds);
  const items=new Map(currentProjectKnowledge(state,userId,projectIds).map(i=>[i.id,i]));
  const words=[...new Set(foldSearchText(query).match(/[a-z0-9]{3,}/g)??[])].filter(w=>!["que","del","los","las","hay","nuevo","proyecto","sobre","para","desde","documentos","archivos","contexto","cual","cuales"].includes(w));
  const candidates:{entry:typeof coverage.entries[number];text:string;score:number;length:number}[]=[];
  for(const entry of coverage.entries.filter(e=>e.status==="ready")) {
    try {
      const original=await readIndexedSource(userId,items.get(entry.id)!);
      const text=safeSourceText(original.content),normalized=foldSearchText(`${entry.title}\n${text}`);
      const score=words.reduce((n,w)=>n+(normalized.includes(w)?1:0),0);
      // Retain bounded excerpts only; never keep every original in memory together.
      candidates.push({entry,text:boundedMemoryExcerpt(text,query,8000).text,score,length:text.length});
    }catch{entry.status="unavailable";entry.reason="No se pudo leer el contenido vigente. Reintenta su preparación.";}
  }
  const news=isProjectNews(query);
  candidates.sort((a,b)=>(news?0:b.score-a.score)||(b.entry.date??"").localeCompare(a.entry.date??"")||a.entry.id.localeCompare(b.entry.id));
  // Reserve representation for every project/category, then fill by relevance.
  const first=new Map<string,typeof candidates[number]>();
  for(const c of candidates){const key=`${c.entry.projectId}:${c.entry.kind}`;if(!first.has(key))first.set(key,c);}
  const chosen=[...first.values(),...candidates.filter(c=>![...first.values()].includes(c))].slice(0,24);
  const hits:BrainHit[]=[],perSource=Math.min(8000,Math.floor(22000/Math.max(1,chosen.length)));
  for(const candidate of chosen) {
    const {entry}=candidate,excerpt=boundedMemoryExcerpt(candidate.text,query,perSource);
    // A short intermediate excerpt is still partial if the original was longer.
    const full=candidate.length===excerpt.text.length;
    entry.mode=full?"full":"excerpt";entry.evidenceId=`source:${entry.id}`;entry.text=excerpt.text;
    hits.push({id:entry.evidenceId,knowledgeId:entry.id,projectId:entry.projectId,title:entry.title,text:excerpt.text,sourceReference:`${entry.kind} · ${entry.title}${entry.date?` · ${entry.date}`:""}${entry.sha?` · commit ${entry.sha}`:""}`,score:candidate.score});
  }
  return {hits,coverage:await sourceCoverage(coverage.entries,previous)};
}
