import { env } from "cloudflare:workers";
import { GBrainClient, BrainError, validateBrainConfig } from "./gbrain-client";
import { memorySlug, memoryChunks, partRequestId, contentHash, safeMemoryText, safeSourceText, MAX_MEMORY_BYTES, selectMemoryHits } from "./brain-content";
import { readAnalysisResource, MAX_MEETING_TEXT_BYTES } from "./meetings";
import { addMemoryLink, memoryLink, memoryRows, setMemoryState, reserveBrainRequest, completeBrainRequest, retryBrainRequest, type MemoryRow } from "@/db/brain";
import { getDb } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSupabaseDocumentBytes, insertSupabaseRow, isSupabaseConfigured, updateSupabaseRow, uploadSupabaseDocument, SUPABASE_TABLES } from "@/db/supabase";
import { documentFormat, extractDocumentText, boundedDocumentBytes, MAX_DOCUMENT_BYTES } from "./brain-documents";
import type { Workspace } from "./workspace-types";
import type { BrainMemory } from "./brain-types";
import { readTaskVersion } from "./task-attachments";
import { projectSourceContext } from "@/db/project-sources";
import { currentProjectKnowledge, isProjectNews, type SourceCoverage } from "./project-sources";

export function brainConfig() { return { url: env.GBRAIN_URL ?? "", sourceId: env.GBRAIN_SOURCE_ID ?? "", clientId: env.GBRAIN_CLIENT_ID ?? "", clientSecret: env.GBRAIN_CLIENT_SECRET ?? "" }; }
export function brainConfigured() { const c = brainConfig(); return !!(c.url && c.sourceId && c.clientId && c.clientSecret); }
function client() { if (!brainConfigured() || env.PROJECT_OS_BRAIN_ENABLED !== "true") throw new BrainError("La memoria GBrain no está activada en este servidor."); return new GBrainClient(brainConfig()); }
let connection: { key: string; until: number; ok: boolean } | undefined;
export async function brainConnected() {
  if (!brainConfigured() || env.PROJECT_OS_BRAIN_ENABLED !== "true") return false;
  const c = brainConfig(), key = `${c.url}:${c.clientId}:${c.clientSecret}`;
  if (connection?.key === key && connection.until > Date.now()) return connection.ok;
  let ok = false; try { await client().call("whoami"); ok = true; } catch { /* status never exposes upstream messages or tokens */ }
  connection = { key, until: Date.now()+30000, ok }; return ok;
}
type Knowledge = Workspace["knowledge"][number];
export async function knowledgeText(userId: string, item: Knowledge) {
  if(item.itemType==="task_attachment")throw new BrainError("Este adjunto todavía no es una fuente de Contexto.",409);
  if(item.itemType==="task_resource") {
    const version=readTaskVersion(item);
    if(item.userId!==userId||!version?.textKey)throw new BrainError("El recurso está guardado, pero su contenido aún no está preparado. Reintenta desde Archivos de la tarea.",409);
    return safeSourceText(new TextDecoder("utf-8",{fatal:true}).decode(await originalBytes(userId,item.projectId,version.textKey,512*1024)));
  }
  if (item.itemType === "meeting" || item.itemType === "project_context") {
    const meeting = readAnalysisResource(item), context = item.itemType === "project_context";
    if (!meeting || item.userId !== userId) throw new BrainError("La ficha de reunión no es válida o no pertenece a este espacio.",422);
    const sections = [context ? `Contexto del proyecto: ${item.title}${meeting.date ? `\nFecha de referencia del documento: ${meeting.date}` : "\nSin fecha de referencia; no interpretar fechas relativas usando la fecha de subida."}` : `Reunión: ${item.title}\nFecha: ${meeting.date}${meeting.driveUrl ? `\nVideo de referencia (no analizado): ${meeting.driveUrl}` : ""}`];
    for (const file of meeting.files) {
      const max = documentFormat(file.key) === "text" ? MAX_MEETING_TEXT_BYTES : MAX_DOCUMENT_BYTES;
      const bytes = await originalBytes(userId,item.projectId,file.key,max);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as unknown as BufferSource))).map(n => n.toString(16).padStart(2,"0")).join("");
      if (hash !== file.hash) throw new BrainError("Un documento cambió respecto al original de la reunión. No se envió texto incompleto.",409);
      sections.push(`${file.role === "context" ? "DOCUMENTO DE CONTEXTO" : file.role === "transcript" ? "TRANSCRIPCIÓN COMPLETA" : "NOTAS DE LA REUNIÓN"} · ${file.name}\n\n${await extractDocumentText(file.key,bytes,true)}`);
    }
    return safeSourceText(sections.join("\n\n"));
  }
  if (!item.storageKey) return safeMemoryText([item.summary, item.sourceReference ? `Referencia: ${item.sourceReference}` : ""].filter(Boolean).join("\n\n"));
  const maxBytes = documentFormat(item.storageKey) === "text" ? MAX_MEMORY_BYTES : MAX_DOCUMENT_BYTES;
  return extractDocumentText(item.storageKey,await originalBytes(userId,item.projectId,item.storageKey,maxBytes));
}
async function originalBytes(userId: string, projectId: string, key: string, maxBytes: number) {
  if (!key.startsWith(`${userId}/${projectId}/`)) throw new BrainError("El archivo no pertenece a este proyecto.",404);
  if (isSupabaseConfigured()) return getSupabaseDocumentBytes(key,maxBytes);
  const object = await env.BUCKET?.get(key);
  if (!object) throw new BrainError("El archivo original no está disponible.", 404);
  if (object.size > maxBytes) throw new BrainError(`El archivo supera ${maxBytes === MAX_MEMORY_BYTES ? "48 KB" : "10 MB"} para procesamiento. El original se conserva.`, 413);
  return boundedDocumentBytes(new Response(object.body),maxBytes);
}
export async function saveOriginalNote(userId: string, projectId: string, id: string, title: string, content: string, state: Workspace) {
  const existing = state.knowledge.find((item) => item.id === id);
  const text = safeMemoryText(content), key = `${userId}/${projectId}/${id}-nota.md`;
  if (existing) {
    if (existing.projectId !== projectId || existing.title !== title || await knowledgeText(userId,existing) !== text) throw new BrainError("Esta operación pertenece a otra nota.", 409);
    return existing;
  }
  const item: Knowledge = { id, userId, projectId, itemType: "note", title, summary: text.slice(0,240), sourceReference: "Nota de Project OS", storageKey: key, processingStatus: "uploaded", occurredAt: new Date().toISOString() };
  if (isSupabaseConfigured()) {
    await uploadSupabaseDocument(key, new File([text], "nota.md", {type:"text/markdown"}), true);
    try { return await insertSupabaseRow<Knowledge>(SUPABASE_TABLES.knowledge,item); }
    catch { throw new BrainError("No se pudo registrar la nota. Su original se conserva; reintenta la misma operación."); }
  }
  if (!env.BUCKET) throw new BrainError("El almacenamiento de originales no está disponible.");
  await env.BUCKET.put(key,text,{httpMetadata:{contentType:"text/markdown"}});
  await getDb().insert(knowledgeItems).values(item).onConflictDoNothing(); return item;
}
export async function processMemory(userId: string, projectName: string, item: Knowledge, text: string) {
  const c = client(), config = brainConfig(), slug = await memorySlug(userId,item.projectId,item.id), parts = memoryChunks(item.title,projectName,text), hash = await contentHash(parts.length === 1 ? parts[0].markdown : JSON.stringify(parts.map(part => part.markdown)));
  let row = await memoryLink(userId,item.projectId,item.id);
  if (row && row.content_hash !== hash) throw new BrainError("El contenido cambió respecto a la memoria vinculada. No se sobrescribió nada.", 409);
  if (row?.status === "ready") return { knowledgeId: item.id, status: "ready", replayed: true };
  row ??= await addMemoryLink({ id: await contentHash(`${userId}:${item.projectId}:${item.id}`), user_id:userId,project_id:item.projectId,knowledge_id:item.id,title:item.title,brain_id:validateBrainConfig(config),source_id:config.sourceId,source_type:item.itemType,external_reference:slug,content_hash:hash,request_id:crypto.randomUUID(),status:"pending",error:"",indexed_at:null,created_at:new Date().toISOString() });
  if (row.content_hash !== hash) throw new BrainError("La nota cambió mientras se procesaba.", 409);
  const progress = /^Fragmentos verificados: (\d+) de (\d+)\./.exec(row.error), completed = progress && Number(progress[2]) === parts.length ? Number(progress[1]) : 0;
  if (completed < 0 || completed >= parts.length) throw new BrainError("El avance de la fuente no es válido. Los originales se conservan.",409);
  const part = parts[completed], partSlug = parts.length === 1 ? slug : `${slug}/part-${String(completed+1).padStart(4,"0")}`;
  const requestId = parts.length === 1 ? row.request_id : await partRequestId(row.request_id,completed);
  try {
    // Identical request_id/content replay the provider's durable receipt after
    // a lost response. No force overwrite; existing pages require revisions.
    const receipt = await c.call<{state?:string;revision?:string}>("put_page", { source_id:config.sourceId,slug:partSlug,content:part.markdown,request_id:requestId,wait_ms:10000 });
    if (receipt.state !== "committed") throw new BrainError("GBrain está procesando la escritura. El original está guardado. Reintenta para revisar el resultado.", 503, "write_pending");
    // Verify actual stored content before reporting an indexed source.
    const page = await c.call<{content?:string}>("get_page", { source_id:config.sourceId,slug:partSlug,include_content:true,content_only:true });
    if (!page.content?.includes(part.text.trim())) throw new BrainError("GBrain no confirmó el texto guardado. El original se conserva.", 502);
    if (completed+1 < parts.length) {
      await setMemoryState(row,"pending",`Fragmentos verificados: ${completed+1} de ${parts.length}.`,true);
      return {knowledgeId:item.id,status:"pending",processedParts:completed+1,totalParts:parts.length};
    }
    const finalized = await setMemoryState(row,"ready","",true);
    if (!finalized && (await memoryLink(userId,item.projectId,item.id))?.status !== "ready") return {knowledgeId:item.id,status:"pending",processedParts:completed,totalParts:parts.length};
    try {
      const processingStatus=item.itemType==="task_resource"?"ready":"indexed";
      if (isSupabaseConfigured()) await updateSupabaseRow(SUPABASE_TABLES.knowledge,userId,item.id,{processingStatus});
      else await getDb().update(knowledgeItems).set({processingStatus}).where(and(eq(knowledgeItems.id,item.id),eq(knowledgeItems.userId,userId)));
    } catch { /* The durable bridge is authoritative; don't replay a committed embedding for a display-state failure. */ }
    return {knowledgeId:item.id,status:"ready",processedParts:parts.length,totalParts:parts.length};
  } catch (error) {
    const failure = error instanceof BrainError ? error : new BrainError("No se pudo procesar la memoria. El original se conserva.");
    await setMemoryState(row,failure.code === "write_pending" ? "pending" : "error",`${parts.length > 1 ? `Fragmentos verificados: ${completed} de ${parts.length}. ` : ""}${failure.message}`,true); throw failure;
  }
}
export async function recallMemory(userId: string, projectIds: string[], query: string, requestId: string, state?:Workspace, previous?:SourceCoverage,options?:{prepare?:boolean}): Promise<BrainMemory> {
  const active=state?currentProjectKnowledge(state,userId,projectIds):undefined,activeIds=active&&new Set(active.map(k=>k.id));
  let local:BrainMemory["hits"]=[],coverage:SourceCoverage|undefined,localWarning:string|undefined;
  if(state) {
    try {const current=await projectSourceContext(userId,state,projectIds,query,previous,options?.prepare!==false);local=current.hits;coverage=current.coverage;}
    catch {localWarning="No se pudo consultar el índice de documentos. La cobertura documental está incompleta.";}
  }
  // Remote memory is a retrieval hint, never authority for a deleted or changed
  // original. With workspace state, only current, verified local text is sent.
  const merge=(hits:BrainMemory["hits"])=>state?(isProjectNews(query)?local:[...local].sort((a,b)=>(b.score+(hits.some(h=>h.knowledgeId===b.knowledgeId)?0.5:0))-(a.score+(hits.some(h=>h.knowledgeId===a.knowledgeId)?0.5:0)))):[...hits.filter(h=>!activeIds||activeIds.has(h.knowledgeId))];
  const localResult=(warning?:string):BrainMemory=>({status:local.length?"connected":"not_configured",hits:local,coverage,provider:"local",warning:[localWarning,warning].filter(Boolean).join(" ")||undefined});
  if (!brainConfigured() || env.PROJECT_OS_BRAIN_ENABLED !== "true") return localResult();
  const allowed = new Set(projectIds);let rows:MemoryRow[];
  try{rows=(await memoryRows(userId,projectIds.length === 1 ? projectIds[0] : undefined)).filter((row) => allowed.has(row.project_id) && (!activeIds||activeIds.has(row.knowledge_id)) && row.status === "ready" && row.source_id === brainConfig().sourceId && row.brain_id === brainConfig().url.replace(/\/$/,""));}
  catch(error){if(state)return localResult("No se pudo consultar el registro de GBrain; se usa el índice vigente del proyecto.");throw error;}
  if (!rows.length) return localResult();
  const hash = await contentHash(JSON.stringify({projectIds:[...allowed].sort(),query}));
  let reservation;
  try {reservation=await reserveBrainRequest(userId,requestId,projectIds.length === 1 ? projectIds[0] : "portfolio","search",hash);}
  catch(error){if(state)return localResult("GBrain no está disponible; se consultó el índice vigente del proyecto.");throw error;}
  if (reservation.replayed) {const saved=reservation.result as BrainMemory;return {...saved,hits:merge(saved.hits),coverage,provider:state?"local_and_gbrain":"gbrain"};}
  try {
    const raw = await client().call<unknown>("search",{query,source_id:brainConfig().sourceId,limit:10,snippet_chars:1800,return_unit:"window",return_window:1,token_budget:4000,fields:"full"});
    const hits = merge(selectMemoryHits(raw,rows));
    const result: BrainMemory = {status:"connected",hits,coverage,provider:state?"local_and_gbrain":"gbrain",warning:localWarning}; await completeBrainRequest(userId,requestId,result); return result;
  } catch (error) { await retryBrainRequest(userId,requestId);if(state)return localResult("GBrain no respondió; se consultó el índice vigente del proyecto.");throw error; }
}
