import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { getWorkspaceState } from "@/db/workspace";
import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { isSupabaseConfigured, insertSupabaseRow, uploadSupabaseDocument, getSupabaseDocumentBytes, SUPABASE_TABLES } from "@/db/supabase";
import { MEETING_PREFIX, PROJECT_CONTEXT_PREFIX, MAX_MEETING_TEXT_BYTES, MAX_MEETING_FILE_BYTES, driveVideoUrl, meetingExtension, readAnalysisResource, type MeetingFile, type ProjectContextFile } from "@/lib/meetings";
import { contentHash } from "@/lib/brain-content";
import { BrainError } from "@/lib/gbrain-client";
import { boundedDocumentBytes } from "@/lib/brain-documents";
import { indexKnowledge } from "@/db/knowledge-search";


const json = (value: unknown, status = 200) => Response.json(value, {status, headers:{"Cache-Control":"no-store"}});
function failure(error: unknown) {
  if (error instanceof WorkspaceConfigurationError) return json({error:error.message},error.status);
  if (error instanceof BrainError) return json({error:error.message},error.status);
  console.error("meeting_request_failed",error instanceof Error ? error.name : "unknown");
  return json({error:"No se pudo guardar el recurso. Conserva los documentos y reintenta."},503);
}
export async function uploadAnalysisResource(request: Request, kind: "meeting" | "project_context") {
  const context = kind === "project_context";
  try {
    const userId = await currentWorkspaceId(request);
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) throw new BrainError("La carga de documentos es demasiado grande.",413);
    const body = await boundedDocumentBytes(new Response(request.body),21 * 1024 * 1024);
    const data = await new Response(body as unknown as BodyInit,{headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData(), state = await getWorkspaceState(userId);
    const projectId = String(data.get("projectId") ?? ""), id = String(data.get("requestId") ?? ""), title = String(data.get("title") ?? "").trim(), date = String(data.get("date") ?? "");
    if (!state.projects.some(row => row.id === projectId && row.userId === userId)) throw new BrainError("Proyecto no encontrado.",404);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || !title || title.length > 180 || !(validDate || (context && date === ""))) throw new BrainError("Completa el título y revisa la fecha de referencia.",400);
    let driveUrl: string; try { driveUrl = driveVideoUrl(String(data.get("driveUrl") ?? "")); } catch (error) { throw new BrainError((error as Error).message,400); }
    if (context && driveUrl) throw new BrainError("Los archivos de contexto no llevan un video de reunión.",400);
    const files: ((MeetingFile|ProjectContextFile) & {file: File})[] = [];
    for (const role of (context ? ["context"] : ["transcript","notes"]) as (MeetingFile["role"]|"context")[]) {
      const file = data.get(role);
      if (!(file instanceof File) || !file.size) { if (role !== "notes") throw new BrainError(context ? "Adjunta el archivo de contexto del proyecto." : "Adjunta la transcripción completa.",400); continue; }
      let extension: string; try { extension = meetingExtension(file.name); } catch (error) { throw new BrainError((error as Error).message,422); }
      if (context && !["txt","md","markdown","pdf","docx"].includes(extension)) throw new BrainError("Sube contexto en TXT, Markdown, PDF con texto o Word .docx.",422);
      const max = ["pdf","docx"].includes(extension) ? MAX_MEETING_FILE_BYTES : MAX_MEETING_TEXT_BYTES;
      if (file.size > max || file.name.length > 180) throw new BrainError("Documentos: hasta 10 MiB en PDF/Word o 256 KiB de texto por archivo. Acorta también los nombres a 180 caracteres.",413);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(n => n.toString(16).padStart(2,"0")).join("");
      files.push({role,name:file.name,key:"",size:file.size,type:file.type || "application/octet-stream",hash,file});
    }
    const fingerprint = await contentHash(JSON.stringify({title,date,driveUrl,files:files.map(({role,name,size,hash}) => ({role,name,size,hash}))}));
    const existing = state.knowledge.find(row => row.id === id);
    if (existing) {
      if (existing.userId !== userId || existing.itemType !== kind || existing.projectId !== projectId || readAnalysisResource(existing)?.fingerprint !== fingerprint) throw new BrainError("Esta operación pertenece a otro recurso. No se sobrescribió nada.",409);
      return json({item:existing,state,replayed:true},200);
    }
    for (const entry of files) {
      entry.key = `${userId}/${projectId}/${id}-${fingerprint}-${entry.role}.${meetingExtension(entry.name)}`;
      // Content-addressed keys keep retries identical; never overwrite a different meeting.
      if (isSupabaseConfigured()) await uploadSupabaseDocument(entry.key,entry.file,true);
      else { if (!env.BUCKET) throw new BrainError("El almacenamiento no está disponible."); await env.BUCKET.put(entry.key,entry.file.stream(),{httpMetadata:{contentType:entry.type},customMetadata:{originalName:entry.name}}); }
    }
    const item = {id,userId,projectId,itemType:kind,title,summary:context ? `Contexto del proyecto${date ? ` · referencia ${date}` : ""} · ${files[0].name}` : `Reunión del ${date} · transcripción${files.length > 1 ? " y notas" : ""} · video ${driveUrl ? "en Drive" : "sin enlace"}`,sourceReference:(context ? PROJECT_CONTEXT_PREFIX : MEETING_PREFIX)+JSON.stringify({version:1,date,driveUrl,fingerprint,files:files.map(({file:_,...entry}) => entry)}),storageKey:null,processingStatus:"uploaded",occurredAt:date ? `${date}T12:00:00Z` : new Date().toISOString()};
    try {
      if (isSupabaseConfigured()) await insertSupabaseRow(SUPABASE_TABLES.knowledge,item);
      else await getDb().insert(knowledgeItems).values(item).onConflictDoNothing();
    } catch {
      const raced = (await getWorkspaceState(userId)).knowledge.find(row => row.id === id);
      if (!raced || raced.itemType !== kind || raced.projectId !== projectId || readAnalysisResource(raced)?.fingerprint !== fingerprint) throw new BrainError("No se pudo registrar este recurso. Reintenta sin cambiar los documentos; no se sobrescribió otro recurso.",409);
    }
    const savedState = await getWorkspaceState(userId), saved = savedState.knowledge.find(row => row.id === id);
    if (!saved || saved.itemType !== kind || saved.projectId !== projectId || readAnalysisResource(saved)?.fingerprint !== fingerprint) throw new BrainError("Esta operación pertenece a otro recurso.",409);
    await indexKnowledge(userId,saved).catch(()=>console.error("meeting_search_index_pending"));
    return json({item:saved,state:savedState},201);
  } catch (error) { return failure(error); }
}
export async function downloadAnalysisResource(request: Request, kind: "meeting" | "project_context") {
  try {
    const params = new URL(request.url).searchParams, userId = await currentWorkspaceId(), state = await getWorkspaceState(userId);
    const item = state.knowledge.find(row => row.id === params.get("id") && row.userId === userId && row.itemType === kind), meeting = item && readAnalysisResource(item);
    if (!meeting) throw new BrainError("Recurso no encontrado.",404);
    const file = meeting.files.find(entry => entry.role === params.get("role"));
    if (!file) throw new BrainError("Documento no encontrado en este recurso.",404);
    const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="documento.${meetingExtension(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`};
    if (isSupabaseConfigured()) return new Response(await getSupabaseDocumentBytes(file.key,MAX_MEETING_FILE_BYTES) as unknown as BodyInit,{headers});
    const object = await env.BUCKET?.get(file.key); if (!object) throw new BrainError("El original no está disponible.",404);
    return new Response(object.body,{headers});
  } catch (error) { return failure(error); }
}
