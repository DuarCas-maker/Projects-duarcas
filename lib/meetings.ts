import type { Workspace } from "./workspace-types";

export const MEETING_PREFIX = "project-os-meeting:v1:";
export const PROJECT_CONTEXT_PREFIX = "project-os-context:v1:";
export const PROJECT_CONTEXT_ACCEPT = ".txt,.md,.markdown,.pdf,.docx";
export const MAX_MEETING_TEXT_BYTES = 256 * 1024;
export const MAX_MEETING_FILE_BYTES = 10 * 1024 * 1024;
export const MEETING_ACCEPT = ".txt,.md,.markdown,.srt,.vtt,.pdf,.docx";
export type MeetingFile = { role: "transcript" | "notes"; name: string; key: string; size: number; type: string; hash: string };
export type MeetingData = { version: 1; date: string; driveUrl: string; fingerprint: string; files: MeetingFile[] };
export type ProjectContextFile = Omit<MeetingFile,"role"> & {role:"context"};
export type ProjectContextData = Omit<MeetingData,"files"> & {files:ProjectContextFile[]};
export type AnalysisResource = Omit<MeetingData,"files"> & {files:(MeetingFile|ProjectContextFile)[]};

export function driveVideoUrl(value: string) {
  if (!value.trim()) return "";
  if (value.length > 2048) throw new Error("El enlace de Drive es demasiado largo.");
  let url: URL; try { url = new URL(value.trim()); } catch { throw new Error("Pega un enlace HTTPS al video en Google Drive."); }
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.port || url.username || url.password || !(/^\/file\/d\/[a-zA-Z0-9_-]+\/(?:view|preview)\/?$/.test(url.pathname) || (url.pathname === "/open" && /^[a-zA-Z0-9_-]+$/.test(url.searchParams.get("id") ?? "")))) throw new Error("Usa el enlace del archivo de video en drive.google.com, no una carpeta ni otro sitio.");
  return url.href;
}
export function meetingExtension(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!["txt", "md", "markdown", "srt", "vtt", "pdf", "docx"].includes(extension)) throw new Error("Sube transcripciones o notas en TXT, Markdown, SRT, VTT, PDF con texto o Word .docx. El video se enlaza desde Drive.");
  return extension;
}
export function readMeeting(item: Workspace["knowledge"][number]): MeetingData | null {
  return item.itemType === "meeting" ? readAnalysisResource(item) as MeetingData|null : null;
}
export function readProjectContext(item: Workspace["knowledge"][number]): ProjectContextData | null {
  return item.itemType === "project_context" ? readAnalysisResource(item) as ProjectContextData|null : null;
}
export function readAnalysisResource(item: Workspace["knowledge"][number]): AnalysisResource | null {
  const context = item.itemType === "project_context", prefix = context ? PROJECT_CONTEXT_PREFIX : MEETING_PREFIX;
  if ((!context && item.itemType !== "meeting") || !item.sourceReference?.startsWith(prefix)) return null;
  try {
    const data = JSON.parse(item.sourceReference.slice(prefix.length)) as AnalysisResource;
    const validDate = typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) && Number.isFinite(Date.parse(`${data.date}T12:00:00Z`)) && new Date(`${data.date}T12:00:00Z`).toISOString().slice(0,10) === data.date;
    if (data.version !== 1 || !(validDate || (context && data.date === "")) || !/^[a-f0-9]{64}$/.test(data.fingerprint) || !Array.isArray(data.files) || data.files.length < 1 || data.files.length > (context ? 1 : 2)) return null;
    if (context && data.driveUrl !== "") return null;
    if (driveVideoUrl(data.driveUrl) !== data.driveUrl) return null;
    const roles = new Set<string>();
    for (const file of data.files) {
      if (!(context ? ["context"] : ["transcript", "notes"]).includes(file.role) || roles.has(file.role) || typeof file.name !== "string" || file.name.length > 180 || typeof file.type !== "string" || !Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_MEETING_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.hash)) return null;
      roles.add(file.role);
      const extension = meetingExtension(file.name);
      if (context && !["txt","md","markdown","pdf","docx"].includes(extension)) return null;
      if (file.key !== `${item.userId}/${item.projectId}/${item.id}-${data.fingerprint}-${file.role}.${extension}`) return null;
    }
    return roles.has(context ? "context" : "transcript") ? data : null;
  } catch { return null; }
}
