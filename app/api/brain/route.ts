import { env } from "cloudflare:workers";
import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { memoryStatus, reserveBrainRequest, completeBrainRequest, retryBrainRequest } from "@/db/brain";
import { brainConfigured, brainConnected, knowledgeText, processMemory, recallMemory, saveOriginalNote } from "@/lib/brain-provider";
import { BrainError, boundedText } from "@/lib/gbrain-client";
import { contentHash, safeMemoryText } from "@/lib/brain-content";
import { documentFormat } from "@/lib/brain-documents";
import type { Workspace } from "@/lib/workspace-types";
import { indexKnowledge } from "@/db/knowledge-search";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const fail = (error: unknown, state?: Workspace) => {
  if (error instanceof BrainError || error instanceof WorkspaceConfigurationError) return json({error:error.message,state},error.status);
  if (error instanceof SyntaxError) return json({error:"Entrada JSON no válida."},400);
  console.error("brain_request_failed",error instanceof Error ? error.name : "unknown");
  return json({error:"La memoria no está disponible. Los originales se conservan.",state},503);
};
function project(state: Workspace, id: unknown) { const row = typeof id === "string" ? state.projects.find((item) => item.id === id) : undefined; if (!row) throw new BrainError("Proyecto no encontrado.",404); return row; }
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), state = await getWorkspaceState(userId), row = project(state,new URL(request.url).searchParams.get("projectId"));
    const configured = brainConfigured(), enabled = env.PROJECT_OS_BRAIN_ENABLED === "true", connected = await brainConnected();
    return json({configured,enabled,connected,...await memoryStatus(userId,row.id)});
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  let reserved: {userId:string;id:string} | undefined, savedState: Workspace | undefined;
  try {
    const userId = await currentWorkspaceId(request);
    const body = JSON.parse(await boundedText(new Response(request.body),80000)) as Record<string,unknown>;
    if (!body || Array.isArray(body) || typeof body !== "object") throw new BrainError("Entrada no válida.",400);
    const state = await getWorkspaceState(userId), row = project(state,body.projectId);
    if (!brainConfigured() || env.PROJECT_OS_BRAIN_ENABLED !== "true") throw new BrainError("GBrain no está activado en este servidor.");
    if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new BrainError("Identificador de operación no válido.",400);
    if (body.action === "search") {
      if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 1000) throw new BrainError("Escribe una búsqueda de hasta 1000 caracteres.",400);
      return json(await recallMemory(userId,[row.id],safeMemoryText(body.query),body.requestId));
    }
    if (!["process","create_note"].includes(String(body.action))) throw new BrainError("Operación de memoria no válida.",400);
    let item: Workspace["knowledge"][number] | undefined, text = "", title: string;
    if (body.action === "process") {
      item = state.knowledge.find((entry) => entry.id === body.knowledgeId && entry.projectId === row.id);
      if (!item) throw new BrainError("Fuente no encontrada en este proyecto.",404);
      if (item.storageKey) documentFormat(item.storageKey);
      title = item.title;
    } else {
      title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 180 || typeof body.content !== "string") throw new BrainError("La nota necesita un título de hasta 180 caracteres y su texto.",400);
      text = safeMemoryText(body.content); safeMemoryText(title);
    }
    const hash = await contentHash(JSON.stringify({action:body.action,projectId:row.id,knowledgeId:item?.id,title,...(item ? {} : {text})}));
    const reservation = await reserveBrainRequest(userId,body.requestId,row.id,String(body.action),hash);
    if (reservation.replayed) return json({...reservation.result as object,replayed:true,state:await getWorkspaceState(userId)});
    reserved = {userId,id:body.requestId};
    // Reserve before fetching/parsing originals, and replay without parsing.
    // Uploaded originals have immutable storage keys; processMemory additionally
    // verifies the extracted content hash before any provider write.
    if (item) text = await knowledgeText(userId,item);
    if (!item) { item = await saveOriginalNote(userId,row.id,body.requestId,title,text,state); savedState = await getWorkspaceState(userId); }
    const result = await processMemory(userId,row.name,item,text);
    await indexKnowledge(userId,item).catch(()=>console.error("note_search_index_pending"));
    await completeBrainRequest(userId,body.requestId,result);
    return json({...result,state:await getWorkspaceState(userId)});
  } catch (error) { if (reserved) await retryBrainRequest(reserved.userId,reserved.id).catch(() => undefined); return fail(error,savedState); }
}
