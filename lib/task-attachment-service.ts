import { getWorkspaceState } from "@/db/workspace";
import { compareAttachmentRow,writeTaskObject,readTaskObject } from "@/db/task-attachments";
import { indexKnowledge } from "@/db/knowledge-search";
import { readTaskAttachment,TASK_ATTACHMENT_PREFIX,TASK_VERSION_PREFIX,MAX_TASK_FILE_BYTES,type Knowledge } from "./task-attachments";
import { extractTaskContent } from "./task-resource-content";
import { fetchTaskLink } from "./task-resource-link";
import { BrainError } from "./gbrain-client";
import { AiError } from "@/db/ai-history";

export async function prepareTaskAttachment(userId:string,rootId:string) {
  const state=await getWorkspaceState(userId),root=state.knowledge.find(k=>k.id===rootId&&k.userId===userId),attachment=root&&readTaskAttachment(root);
  if(!root||!attachment||!attachment.published)throw new BrainError("Envía primero el archivo a Contexto.",409);
  const version=attachment.versions.at(-1)!,resource=state.knowledge.find(k=>k.id===version.id&&k.projectId===root.projectId&&k.userId===userId);
  if(!resource)throw new BrainError("La versión del archivo no está disponible.",409);
  try {
    if(["ready","indexed"].includes(resource.processingStatus)) {
      const indexed=await indexKnowledge(userId,resource,true);
      if(indexed.status!=="ready")throw new BrainError(indexed.error||"No se pudo preparar la búsqueda.",422);
      version.error="";await compareAttachmentRow(root,{sourceReference:TASK_ATTACHMENT_PREFIX+JSON.stringify(attachment)});
      return {status:"ready" as const};
    }
    let text:string;
    if(version.url) {
      const linked=await fetchTaskLink(version.url);
      text=await extractTaskContent(userId,root.projectId,linked.name,linked.mime,linked.bytes);
    } else text=await extractTaskContent(userId,root.projectId,version.name,version.mime,await readTaskObject(userId,root.projectId,version.key!,MAX_TASK_FILE_BYTES));
    const textKey=`${userId}/${root.projectId}/task-resources/${version.id}/context.txt`;
    await writeTaskObject(textKey,new File([text],"context.txt",{type:"text/plain;charset=utf-8"}));
    const patch={sourceReference:TASK_VERSION_PREFIX+JSON.stringify({attachmentId:root.id,taskId:attachment.taskId,textKey}),processingStatus:"ready",summary:`Versión ${attachment.versions.length} · ${version.url?"Contenido del enlace":"Archivo de tarea"} · disponible para búsquedas e IA`};
    await compareAttachmentRow(resource,patch);
    const result=await indexKnowledge(userId,{...resource,...patch},true);
    if(result.status!=="ready")throw new BrainError(result.error||"El archivo no pudo prepararse para búsquedas.",422);
    version.error="";
    await compareAttachmentRow(root,{sourceReference:TASK_ATTACHMENT_PREFIX+JSON.stringify(attachment)});
    return {status:"ready" as const};
  } catch(error) {
    const message=error instanceof BrainError||error instanceof AiError?error.message:"No se pudo preparar esta versión. El original y su historial se conservan.";
    version.error=message;
    await compareAttachmentRow(root,{sourceReference:TASK_ATTACHMENT_PREFIX+JSON.stringify(attachment)}).catch(()=>undefined);
    return {status:"pending" as const,warning:message};
  }
}
export function versionKnowledge(root:Knowledge,versionId:string,name:string,key:string|null,taskId:string):Knowledge {
  return {id:versionId,userId:root.userId,projectId:root.projectId,itemType:"task_resource",title:name,summary:"Original guardado · pendiente de enviar a Contexto",sourceReference:TASK_VERSION_PREFIX+JSON.stringify({attachmentId:root.id,taskId,textKey:null}),storageKey:key,processingStatus:"uploaded",occurredAt:new Date().toISOString()};
}
