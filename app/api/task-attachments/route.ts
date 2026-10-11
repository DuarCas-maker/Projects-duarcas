import { currentWorkspaceId,WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { insertAttachmentRow,compareAttachmentRow,writeTaskObject,readTaskObject } from "@/db/task-attachments";
import { readTaskAttachment,readTaskVersion,taskAttachments,publicLink,TASK_ATTACHMENT_PREFIX,MAX_TASK_FILE_BYTES,TASK_FILE_ACCEPT,type TaskAttachment,type Knowledge } from "@/lib/task-attachments";
import { prepareTaskAttachment,versionKnowledge } from "@/lib/task-attachment-service";
import { BrainError } from "@/lib/gbrain-client";
import { boundedDocumentBytes } from "@/lib/brain-documents";
import { SupabaseConflictError } from "@/db/supabase";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const fail=(error:unknown)=>error instanceof BrainError||error instanceof WorkspaceConfigurationError?json({error:error.message},error.status):error instanceof SupabaseConflictError?json({error:error.message},409):json({error:"No se pudo guardar el recurso. Recarga y vuelve a intentarlo."},503);
export async function GET(request:Request) {
  try {
    const userId=await currentWorkspaceId(),params=new URL(request.url).searchParams,state=await getWorkspaceState(userId);
    const task=state.tasks.find(t=>t.id===params.get("taskId")&&t.userId===userId&&state.projects.some(p=>p.id===t.projectId&&p.userId===userId));
    if(!task)throw new BrainError("Tarea no encontrada.",404);
    if(!params.has("versionId"))return json({attachments:taskAttachments(state,task.id)});
    const selected=taskAttachments(state,task.id).flatMap(a=>a.attachment.versions).find(v=>v.id===params.get("versionId"));
    if(!selected)throw new BrainError("Archivo no encontrado.",404);
    const textKey=params.has("snapshot")||!selected.key?readTaskVersion(state.knowledge.find(k=>k.id===selected.id)!)?.textKey:null;
    const key=textKey??selected.key;if(!key)throw new BrainError("Esta versión del enlace aún no tiene una lectura guardada.",409);
    const bytes=await readTaskObject(userId,task.projectId,key,MAX_TASK_FILE_BYTES);
    return new Response(bytes as unknown as BodyInit,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(textKey?selected.name+".txt":selected.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch(error){return fail(error);}
}
export async function POST(request:Request) {
  try {
    const userId=await currentWorkspaceId(request);
    const bytes=await boundedDocumentBytes(new Response(request.body),MAX_TASK_FILE_BYTES+1024*1024);
    const form=await new Response(bytes as unknown as BodyInit,{headers:{"Content-Type":request.headers.get("content-type")??""}}).formData();
    const state=await getWorkspaceState(userId),task=state.tasks.find(t=>t.id===form.get("taskId")&&t.userId===userId&&state.projects.some(p=>p.id===t.projectId&&p.userId===userId));
    if(!task)throw new BrainError("Tarea no encontrada.",404);
    const action=String(form.get("action")??""),requestId=String(form.get("requestId")??"");
    if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new BrainError("Identificador de operación no válido.",400);
    const previous=state.knowledge.find(k=>k.id===form.get("attachmentId")&&k.userId===userId&&k.projectId===task.projectId),old=previous&&readTaskAttachment(previous);
    if(form.has("attachmentId")&&(!previous||old?.taskId!==task.id))throw new BrainError("Recurso no encontrado en esta tarea.",404);
    if(action==="publish"||action==="retry") {
      if(!previous||!old)throw new BrainError("Selecciona un recurso de la tarea.",400);
      if(!old.published){old.published=true;old.activeVersionId=old.versions.at(-1)!.id;await compareAttachmentRow(previous,{sourceReference:TASK_ATTACHMENT_PREFIX+JSON.stringify(old)});}
      const result=await prepareTaskAttachment(userId,previous.id);
      return json({...result,state:await getWorkspaceState(userId)});
    }
    if(action!=="upload"&&action!=="update")throw new BrainError("Acción no válida.",400);
    if(action==="update"&&!old)throw new BrainError("Selecciona el archivo que quieres actualizar.",400);
    const replay=taskAttachments(state,task.id).find(a=>a.attachment.versions.some(v=>v.id===requestId));
    if(replay){if(action==="update"&&replay.item.id!==previous?.id)throw new BrainError("Esta operación pertenece a otro archivo.",409);const latest=replay.attachment.versions.at(-1)!;const ready=["ready","indexed"].includes(state.knowledge.find(k=>k.id===latest.id)?.processingStatus??"");return json({replayed:true,status:!replay.attachment.published?"uploaded":ready&&!latest.error?"ready":"pending",warning:latest.error||undefined,state});}
    const rootId=previous?.id??requestId+"-attachment",existingVersion=state.knowledge.find(k=>k.id===requestId),versionReference=readTaskVersion(existingVersion);
    if(existingVersion&&(!versionReference||versionReference.attachmentId!==rootId||versionReference.taskId!==task.id||existingVersion.userId!==userId||existingVersion.projectId!==task.projectId))throw new BrainError("Esta operación pertenece a otro recurso.",409);
    const file=form.get("file"),url=String(form.get("url")??"").trim();
    const kind=file instanceof File?"file":"link";
    if(old&&old.kind!==kind)throw new BrainError("Actualiza un archivo con otro archivo, o un enlace con otro enlace.",400);
    let name:string,key:string|null=null,mime="text/uri-list",size=0,link:string|null=null;
    if(file instanceof File) {
      if(!file.size||file.size>MAX_TASK_FILE_BYTES)throw new BrainError("Sube un archivo de entre 1 byte y 25 MB.",413);
      if(!TASK_FILE_ACCEPT.split(",").includes(`.${file.name.split(".").at(-1)?.toLowerCase()}`))throw new BrainError("Usa PDF, Office, texto o imágenes PNG, JPG, WebP o GIF.",422);
      name=existingVersion?.title??file.name.slice(0,180);mime=file.type||"application/octet-stream";size=file.size;
      key=existingVersion?.storageKey??`${userId}/${task.projectId}/task-resources/${requestId}/${name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      if(existingVersion&&!existingVersion.storageKey)throw new BrainError("La operación original pertenece a un enlace.",409);
      if(existingVersion){size=(await readTaskObject(userId,task.projectId,key,MAX_TASK_FILE_BYTES)).length;mime="application/octet-stream";}else await writeTaskObject(key,file);
    } else {
      link=publicLink(url);if(!link)throw new BrainError("Usa un enlace HTTPS público válido.",400);
      name=String(form.get("name")??"").trim().slice(0,180)||new URL(link).hostname;
    }
    if(existingVersion&&kind==="link"&&existingVersion.storageKey)throw new BrainError("La operación original pertenece a un archivo.",409);
    const root:Knowledge=previous??{id:rootId,userId,projectId:task.projectId,itemType:"task_attachment",title:name,summary:"Adjunto de tarea",sourceReference:null,storageKey:null,processingStatus:"uploaded",occurredAt:new Date().toISOString()};
    const attachment:TaskAttachment=old??{version:1,taskId:task.id,kind,published:false,activeVersionId:null,versions:[]};
    attachment.versions.push({id:requestId,name,key,mime,size,url:link,createdAt:existingVersion?.occurredAt??new Date().toISOString(),error:""});
    if(attachment.published)attachment.activeVersionId=requestId;
    const reference=TASK_ATTACHMENT_PREFIX+JSON.stringify(attachment);
    if(!existingVersion)await insertAttachmentRow(versionKnowledge(root,requestId,name,key,task.id));
    if(previous)await compareAttachmentRow(previous,{title:name,sourceReference:reference});else await insertAttachmentRow({...root,sourceReference:reference});
    const result=attachment.published?await prepareTaskAttachment(userId,root.id):{status:"uploaded"};
    return json({...result,state:await getWorkspaceState(userId)},201);
  } catch(error){return fail(error);}
}
