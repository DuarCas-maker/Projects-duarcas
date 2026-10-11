import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { knowledgeItems } from "./schema";
import { and,eq } from "drizzle-orm";
import { isSupabaseConfigured,insertSupabaseRow,updateSupabaseRow,uploadSupabaseDocument,getSupabaseDocumentBytes,SUPABASE_TABLES } from "./supabase";
import { BrainError } from "@/lib/gbrain-client";
import { boundedDocumentBytes } from "@/lib/brain-documents";
import type { Knowledge } from "@/lib/task-attachments";

export async function insertAttachmentRow(item:Knowledge) {
  if(isSupabaseConfigured())await insertSupabaseRow(SUPABASE_TABLES.knowledge,item);
  else await getDb().insert(knowledgeItems).values(item);
}
export async function compareAttachmentRow(previous:Knowledge,patch:Partial<Knowledge>) {
  if(isSupabaseConfigured())return updateSupabaseRow(SUPABASE_TABLES.knowledge,previous.userId,previous.id,patch,{source_reference:previous.sourceReference});
  const changed=await getDb().update(knowledgeItems).set(patch).where(and(eq(knowledgeItems.id,previous.id),eq(knowledgeItems.userId,previous.userId),eq(knowledgeItems.sourceReference,previous.sourceReference!))).returning({id:knowledgeItems.id});
  if(!changed.length)throw new BrainError("El archivo cambió mientras lo actualizabas. Recarga y vuelve a intentarlo.",409);
}
export async function writeTaskObject(key:string,file:File) {
  if(isSupabaseConfigured())return uploadSupabaseDocument(key,file,true);
  if(!env.BUCKET)throw new BrainError("El almacenamiento de archivos no está disponible.",503);
  await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
}
export async function readTaskObject(userId:string,projectId:string,key:string,max:number) {
  if(!key.startsWith(`${userId}/${projectId}/`)||key.split("/").includes(".."))throw new BrainError("Archivo no encontrado.",404);
  if(isSupabaseConfigured())return getSupabaseDocumentBytes(key,max);
  const object=await env.BUCKET?.get(key);if(!object)throw new BrainError("El original no está disponible.",404);
  return boundedDocumentBytes(new Response(object.body),max);
}
