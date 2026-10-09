import { env } from "cloudflare:workers";
import type { Workspace } from "@/lib/workspace-types";
import { BrainError } from "@/lib/gbrain-client";
import { knowledgeText } from "@/lib/brain-provider";
import { contentHash } from "@/lib/brain-content";
import { searchFingerprint, foldSearchText, type SearchCoverage, type SearchResult } from "@/lib/global-search";

type IndexRow={id:string;project_id:string;knowledge_id:string;fingerprint:string;status:string;error:string};
function db(){if(!env.DB)throw new BrainError("El índice de búsqueda no está disponible.");return env.DB;}
export async function readIndexedSource(userId:string,item:Workspace["knowledge"][number]) {
  if(item.userId!==userId)throw new BrainError("Fuente no encontrada.",404);
  const row=await db().prepare("SELECT fingerprint,status,content FROM knowledge_search WHERE user_id = ? AND knowledge_id = ? AND project_id = ?").bind(userId,item.id,item.projectId).first<{fingerprint:string;status:string;content:string}>();
  if(!row || row.fingerprint!==await searchFingerprint(item) || row.status!=="ready")throw new BrainError("Prepara esta fuente desde la búsqueda global para ver su texto completo.",409);
  return {id:item.id,title:item.title,content:row.content};
}
export async function indexKnowledge(userId:string,item:Workspace["knowledge"][number],retry=false) {
  if(item.userId!==userId)throw new BrainError("Fuente no encontrada.",404);
  const id=await contentHash(`${userId}:${item.id}`),fingerprint=await searchFingerprint(item);
  const existing=await db().prepare("SELECT fingerprint,status FROM knowledge_search WHERE id = ? AND user_id = ?").bind(id,userId).first<{fingerprint:string;status:string}>();
  if(existing?.fingerprint===fingerprint && (existing.status==="ready" || !retry))return {status:existing.status,replayed:true};
  let text="",error="",status="ready";
  try{text=await knowledgeText(userId,item);}
  catch(failure){
    // Transient parser/storage errors are retryable; don't permanently mark
    // a readable original unavailable just because another parser is busy.
    if(failure instanceof BrainError && [429,503,502].includes(failure.status))throw failure;
    status="unavailable";error=failure instanceof BrainError ? failure.message : "No se pudo extraer el texto. El original se conserva.";
  }
  await db().prepare("INSERT INTO knowledge_search (id,user_id,project_id,knowledge_id,fingerprint,content,normalized_content,status,error,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,fingerprint=excluded.fingerprint,content=excluded.content,normalized_content=excluded.normalized_content,status=excluded.status,error=excluded.error,indexed_at=excluded.indexed_at WHERE knowledge_search.user_id=excluded.user_id").bind(id,userId,item.projectId,item.id,fingerprint,text,foldSearchText(text),status,error,new Date().toISOString()).run();
  return {status,error};
}
export async function searchIndex(userId:string,state:Workspace,query:string) {
  const projects=new Set(state.projects.filter(p=>p.userId===userId).map(p=>p.id));
  const items=state.knowledge.filter(k=>k.userId===userId && projects.has(k.projectId));
  const rows=(await db().prepare("SELECT id,project_id,knowledge_id,fingerprint,status,error FROM knowledge_search WHERE user_id = ?").bind(userId).all<IndexRow>()).results;
  const indexed=new Map(rows.map(r=>[r.knowledge_id,r])),valid:IndexRow[]=[];
  const coverage:SearchCoverage={total:items.length,ready:0,pending:[],unavailable:[]};
  const fingerprints=await Promise.all(items.map(searchFingerprint));
  items.forEach((item,index)=>{const row=indexed.get(item.id);if(!row || row.project_id!==item.projectId || row.fingerprint!==fingerprints[index])coverage.pending.push({id:item.id,title:item.title});else if(row.status==="ready"){coverage.ready++;valid.push(row);}else coverage.unavailable.push({id:item.id,title:item.title,error:row.error});});
  const matches:SearchResult[]=[];
  if(query.trim())for(let start=0;start<valid.length;start+=40){
    const batch=valid.slice(start,start+40),needle=foldSearchText(query.trim());
    // Parameterized literal substring matching: %, _ and SQL punctuation have
    // no special meaning. Keep all original text, return only a short excerpt.
    const hits=(await db().prepare(`SELECT knowledge_id,substr(content,max(instr(normalized_content,?)-70,1),310) AS excerpt FROM knowledge_search WHERE user_id = ? AND status = 'ready' AND id IN (${batch.map(()=>"?").join(",")}) AND instr(normalized_content,?) > 0`).bind(needle,userId,...batch.map(r=>r.id),needle).all<{knowledge_id:string;excerpt:string}>()).results;
    for(const hit of hits){const item=items.find(k=>k.id===hit.knowledge_id)!;matches.push({id:item.id,type:item.itemType==="meeting" ? "Contenido de reunión" : "Contenido de documento",projectId:item.projectId,label:item.title,detail:state.projects.find(p=>p.id===item.projectId)?.name??"",excerpt:hit.excerpt.replace(/\s+/g," "),tab:"knowledge",knowledgeId:item.id});}
  }
  return {matches,coverage};
}
