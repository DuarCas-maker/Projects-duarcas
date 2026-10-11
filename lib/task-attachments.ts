import type { Workspace } from "./workspace-types";

export const TASK_ATTACHMENT_PREFIX = "project-os:task-attachment:v1:";
export const TASK_VERSION_PREFIX = "project-os:task-version:v1:";
export const TASK_FILE_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.doc,.xls,.ppt";
export const MAX_TASK_FILE_BYTES = 25 * 1024 * 1024;
export type TaskFileVersion = { id:string; name:string; key:string|null; size:number; mime:string; url:string|null; createdAt:string; error:string };
export type TaskAttachment = { version:1; taskId:string; kind:"file"|"link"; published:boolean; activeVersionId:string|null; versions:TaskFileVersion[] };
export type Knowledge = Workspace["knowledge"][number];
const validId=(value:unknown):value is string=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function readTaskAttachment(item:Knowledge):TaskAttachment|null {
  if(item.itemType!=="task_attachment"||!item.sourceReference?.startsWith(TASK_ATTACHMENT_PREFIX))return null;
  try {
    const value=JSON.parse(item.sourceReference.slice(TASK_ATTACHMENT_PREFIX.length)) as TaskAttachment;
    if(value.version!==1||!validId(value.taskId)||!["file","link"].includes(value.kind)||typeof value.published!=="boolean"||!Array.isArray(value.versions)||!value.versions.length)return null;
    const ids=new Set<string>(),prefix=`${item.userId}/${item.projectId}/`;
    for(const v of value.versions) {
      if(!validId(v.id)||ids.has(v.id)||typeof v.name!=="string"||!v.name||v.name.length>180||!Number.isSafeInteger(v.size)||v.size<0||v.size>MAX_TASK_FILE_BYTES||typeof v.mime!=="string"||!Number.isFinite(Date.parse(v.createdAt))||typeof v.error!=="string")return null;
      if(value.kind==="file"?(typeof v.key!=="string"||!v.key.startsWith(prefix)||v.key.split("/").some(s=>s==="..")||v.url!==null):(v.key!==null||typeof v.url!=="string"||!publicLink(v.url)))return null;
      ids.add(v.id);
    }
    if(value.published?value.activeVersionId!==value.versions.at(-1)!.id:value.activeVersionId!==null)return null;
    return value;
  } catch {return null;}
}
export function publicLink(value:string):string|null {
  try {const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||url.hostname.length<4||!url.hostname.includes(".")||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal")||url.hostname.endsWith(".localhost")||/^[\d.]+$/.test(url.hostname)||url.hostname.includes(":"))return null;url.hash="";return url.href;}catch{return null;}
}
export function readTaskVersion(item:Knowledge|undefined):{attachmentId:string;taskId:string;textKey:string|null}|null {
  if(item?.itemType!=="task_resource"||!item.sourceReference?.startsWith(TASK_VERSION_PREFIX))return null;
  try {const v=JSON.parse(item.sourceReference.slice(TASK_VERSION_PREFIX.length));if(!validId(v.attachmentId)||!validId(v.taskId)||(v.textKey!==null&&(typeof v.textKey!=="string"||!v.textKey.startsWith(`${item.userId}/${item.projectId}/`)||v.textKey.split("/").includes(".."))))return null;return v;}catch{return null;}
}
export function activeKnowledge(state:Workspace):Knowledge[] {
  const roots=new Map(state.knowledge.filter(k=>k.itemType==="task_attachment").flatMap(k=>{const a=readTaskAttachment(k);return a&&state.tasks.some(t=>t.id===a.taskId&&t.userId===k.userId&&t.projectId===k.projectId)?[[k.id,{item:k,attachment:a}] as const]:[];}));
  return state.knowledge.filter(k=>{
    if(k.itemType==="task_attachment")return false;
    if(k.itemType!=="task_resource")return true;
    const v=readTaskVersion(k),root=v&&roots.get(v.attachmentId);
    return !!root&&root.item.userId===k.userId&&root.item.projectId===k.projectId&&root.attachment.taskId===v!.taskId&&root.attachment.activeVersionId===k.id;
  });
}
export function taskAttachments(state:Workspace,taskId:string) {
  return state.knowledge.flatMap(item=>{const attachment=readTaskAttachment(item);return attachment?.taskId===taskId?[{item,attachment}]:[];});
}
