import { BrainError } from "./gbrain-client";
import type { BrainHit } from "./brain-types";
const idPattern = /^[a-zA-Z0-9_-]{1,200}$/;
export const MAX_MEMORY_BYTES = 48 * 1024;
export const MAX_SOURCE_BYTES = 512 * 1024;
export async function contentHash(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((n) => n.toString(16).padStart(2, "0")).join(""); }
export async function memorySlug(userId: string, projectId: string, knowledgeId: string) {
  if (![userId, projectId, knowledgeId].every((id) => idPattern.test(id))) throw new BrainError("Identificador de memoria no válido.", 400);
  return `project-os/ws-${(await contentHash(userId)).slice(0, 32)}/project-${(await contentHash(projectId)).slice(0, 32)}/item-${(await contentHash(knowledgeId)).slice(0, 32)}`;
}
function validatedText(text: string, max: number) {
  if (!text.trim() || new TextEncoder().encode(text).byteLength > max) throw new BrainError(`Procesa texto de hasta ${max / 1024} KiB. El archivo original no se modifica.`, 413);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new BrainError("El archivo no es texto UTF-8 procesable.", 422);
  // Reject common credential formats before external embeddings/knowledge.
  if (/sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sb_secret_[a-zA-Z0-9_-]+|(?:API_KEY|CLIENT_SECRET|JWT_SECRET|PASSWORD|SERVICE_ROLE_KEY)\s*[:=]\s*\S{8,}|eyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}/i.test(text)) throw new BrainError("El texto parece contener credenciales. Retíralas antes de enviarlo a GBrain.", 422);
  return text.trim();
}
export function safeMemoryText(text: string) { return validatedText(text,MAX_MEMORY_BYTES); }
export function safeSourceText(text: string) { return validatedText(text,MAX_SOURCE_BYTES); }
export function memoryMarkdown(title: string, projectName: string, content: string) {
  const markdown = `---\ntitle: ${JSON.stringify(title)}\ntype: note\n---\n\nProyecto: ${projectName.replace(/[\r\n]/g, " ")}\n\n${safeMemoryText(content)}\n`;
  safeMemoryText(markdown); return markdown;
}
// Keep existing single-page Markdown unchanged. Long sources use bounded,
// deterministic pages; every character is retained and Unicode is never split.
export function memoryChunks(title: string, projectName: string, content: string) {
  const text = safeSourceText(content);
  try { return [{text,markdown:memoryMarkdown(title,projectName,text)}]; }
  catch (error) { if (!(error instanceof BrainError) || error.status !== 413) throw error; }
  const chunks: string[] = []; let current = "", bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!, size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > 32 * 1024) {
      const boundary = Math.max(current.lastIndexOf("\n"),current.lastIndexOf(" "));
      if (boundary >= current.length / 2) { chunks.push(current.slice(0,boundary+1)); current = current.slice(boundary+1); bytes = new TextEncoder().encode(current).byteLength; }
      else { chunks.push(current); current = ""; bytes = 0; }
    }
    current += character; bytes += size;
  }
  if (current) chunks.push(current);
  if (chunks.length > 16 || chunks.join("") !== text) throw new BrainError("La reunión supera el límite de 16 fragmentos. Divide los documentos; no se envió texto incompleto.",413);
  return chunks.map((part,index) => ({text:part,markdown:memoryMarkdown(title,projectName,`Fragmento ${index+1} de ${chunks.length}. Conserva la referencia a la fuente completa.\n\n${part}`)}));
}
export async function partRequestId(rootId: string, index: number) {
  const hash = await contentHash(`${rootId}:fragment:${index}`);
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

type ReadableLink = {source_id:string;external_reference:string;knowledge_id:string;project_id:string;title:string};
export function selectMemoryHits(raw: unknown, rows: ReadableLink[]): BrainHit[] {
  if (!Array.isArray(raw)) throw new BrainError("GBrain no devolvió resultados utilizables.",502);
  const linked = new Map(rows.map((row) => [row.external_reference,row]));
  const hits: BrainHit[] = []; let length = 0;
  for (const value of raw.slice(0,10)) {
    if (!value || typeof value !== "object") continue;
    const hit = value as {source_id?:string;slug?:string;chunk_text?:string;score?:number};
    const row = typeof hit.slug === "string" ? linked.get(hit.slug) ?? (/\/part-00(?:0[1-9]|1[0-6])$/.test(hit.slug) ? linked.get(hit.slug.replace(/\/part-\d{4}$/, "")) : undefined) : undefined;
    if (!row || hit.source_id !== row.source_id || typeof hit.chunk_text !== "string") continue;
    const text = hit.chunk_text.slice(0,1800);
    if (length+text.length > 12000 || hits.some((item) => item.knowledgeId === row.knowledge_id)) continue;
    length += text.length; hits.push({id:`brain:${row.knowledge_id}`,knowledgeId:row.knowledge_id,projectId:row.project_id,title:row.title,text,sourceReference:`GBrain · ${row.title}`,score:Number.isFinite(hit.score) ? hit.score! : 0});
  }
  return hits;
}
