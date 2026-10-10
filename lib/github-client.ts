import { safeMemoryText } from "./brain-content";
import type { GithubActivity } from "./github-context";

export class GithubError extends Error {
  constructor(message: string, public status = 503) { super(message); this.name = "GithubError"; }
}
export const GITHUB_LIMITS = { files: 10, fileBytes: 8 * 1024, textBytes: 24 * 1024, responseBytes: 2 * 1024 * 1024, paths: 200 };
export function githubRepositoryUrl(value: unknown) {
  let url: URL;
  try { url = new URL(typeof value === "string" ? value.trim() : ""); } catch { throw new GithubError("Introduce la URL de un repositorio de GitHub.",400); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash)
    throw new GithubError("Usa https://github.com/propietario/repositorio, sin credenciales ni parámetros.",400);
  const match = /^\/([a-zA-Z0-9-]{1,39})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(url.pathname);
  const owner = match?.[1], repo = match?.[2].replace(/\.git$/i,"");
  if (!owner || !repo || [".",".."].includes(repo)) throw new GithubError("La URL debe identificar un repositorio, no un archivo o una carpeta.",400);
  return {owner,repo,url:`https://github.com/${owner}/${repo}`};
}
export function githubBranch(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 100 || /[\x00-\x20~^:?*\[\\]/.test(value) || value.includes("..") || value.includes("@{") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".lock"))
    throw new GithubError("La rama no es válida.",400);
  return value;
}
async function boundedJson(response: Response) {
  if (Number(response.headers.get("content-length")) > GITHUB_LIMITS.responseBytes) { await response.body?.cancel(); throw new GithubError("La respuesta de GitHub supera el límite de lectura.",413); }
  const reader = response.body?.getReader(); if (!reader) throw new GithubError("GitHub devolvió una respuesta vacía.",502);
  const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength; if (size > GITHUB_LIMITS.responseBytes) { await reader.cancel(); throw new GithubError("La respuesta de GitHub supera el límite de lectura.",413); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part,at); at += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); } catch { throw new GithubError("GitHub no devolvió datos utilizables.",502); }
}
// This pilot is deliberately credential-free: only public repositories, GET,
// the fixed GitHub API origin, no redirects, no remote code execution.
export async function githubGet(path: string) {
  if (!/^\/repos\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:\/|$)/.test(path)) throw new GithubError("Ruta de GitHub no válida.",400);
  let response: Response;
  try { response = await fetch(`https://api.github.com${path}`,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Accept:"application/vnd.github+json","User-Agent":"Project-OS-read-only","X-GitHub-Api-Version":"2026-03-10"}}); }
  catch { throw new GithubError("No se pudo conectar con GitHub. El contexto anterior se conserva.",502); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new GithubError("Repositorio o rama no disponible públicamente. Los privados requieren configurar una GitHub App.",404);
    if ([403,429].includes(response.status)) throw new GithubError("GitHub limitó la lectura pública. Espera antes de reintentar; el contexto anterior se conserva.",429);
    throw new GithubError("GitHub no pudo completar la lectura. El contexto anterior se conserva.",502);
  }
  return boundedJson(response);
}
export async function githubMetadata(owner: string, repo: string) {
  githubRepositoryUrl(`https://github.com/${owner}/${repo}`);
  const data = await githubGet(`/repos/${owner}/${repo}`);
  if (data.private !== false || data.visibility === "private") throw new GithubError("Este piloto solo lee repositorios públicos.",403);
  if (typeof data.full_name !== "string" || data.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) throw new GithubError("El repositorio cambió de ubicación. Vincula su URL actual.",409);
  const canonical = githubRepositoryUrl(data.html_url);
  return {...canonical,branch:githubBranch(data.default_branch)};
}
type TreeFile = {path:string;sha:string;size:number;type:string;mode:string};
export function eligibleGithubFile(file: TreeFile) {
  const path = file.path.toLowerCase(), segments = path.split("/");
  if (file.type !== "blob" || !["100644","100755"].includes(file.mode) || !/^[a-f0-9]{40}$/.test(file.sha) ||
    path.length > 300 || segments.some(s => !s || s === ".." || ["node_modules","vendor","dist","build",".git",".next","coverage"].includes(s)) ||
    /(^|\/)(?:\.env(?:\.|$)|[^/]*(?:secret|credential|password)[^/]*|.*\.lock$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$)/i.test(path) || /\.(?:pem|key|p12|pfx|map|min\.js)$/i.test(path)) return false;
  return /\.(?:md|markdown|txt|json|ts|tsx|js|jsx|py|sql|yaml|yml|toml|go|rs|css|html)$/i.test(path) || /(^|\/)(?:dockerfile|makefile)$/i.test(path);
}
function filePriority(path: string) {
  if (/(^|\/)readme(?:\.|$)/i.test(path)) return 0;
  if (/^(?:docs\/|architecture|prd|plan|roadmap|changelog)/i.test(path)) return 1;
  if (/^(?:package\.json|dockerfile|compose\.ya?ml|requirements\.txt|pyproject\.toml)$/i.test(path)) return 2;
  return 3;
}
async function githubActivity(owner: string, repo: string, sha: string, head: any, previousSha?: string): Promise<GithubActivity> {
  let message = ""; try { message = safeMemoryText(String(head.commit?.message ?? "").slice(0,1000)); } catch { message = "[Mensaje omitido por seguridad]"; }
  const date = head.commit?.committer?.date;
  const activity: GithubActivity = {message,committedAt:typeof date === "string" && /^\d{4}-\d{2}-\d{2}T/.test(date) && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,previousSha:previousSha ?? null,comparison:previousSha ? "unavailable" : "initial",aheadBy:null,behindBy:null,files:[],partial:true};
  if (!previousSha) return activity;
  try {
    const comparison = await githubGet(`/repos/${owner}/${repo}/compare/${previousSha}...${sha}?per_page=1`);
    if (comparison.base_commit?.sha !== previousSha || !["ahead","behind","diverged","identical"].includes(comparison.status) || !Array.isArray(comparison.files) || ![comparison.ahead_by,comparison.behind_by].every(n=>Number.isSafeInteger(n) && n >= 0)) return activity;
    const files = comparison.files.filter((f:any)=>f && typeof f.filename === "string" && ["added","removed","modified","renamed","copied","changed","unchanged"].includes(f.status) && eligibleGithubFile({path:f.filename,sha:"0".repeat(40),size:0,type:"blob",mode:"100644"}));
    const safeFiles: GithubActivity["files"] = [];
    for (const file of files.slice(0,20)) { try { safeFiles.push({path:safeMemoryText(file.filename),status:file.status}); } catch { /* Never expose credential-like paths. */ } }
    return {...activity,comparison:comparison.status,aheadBy:comparison.ahead_by,behindBy:comparison.behind_by,files:safeFiles,partial:comparison.files.length >= 300 || safeFiles.length !== comparison.files.length};
  } catch { return activity; } // Snapshot remains useful even if comparison is unavailable.
}
export async function readGithubSnapshot(owner: string, repo: string, branch: string, previousSha?: string) {
  githubRepositoryUrl(`https://github.com/${owner}/${repo}`); githubBranch(branch);
  if (previousSha !== undefined && !/^[a-f0-9]{40}$/.test(previousSha)) throw new GithubError("La versión anterior no es válida.",400);
  // Re-check visibility on every sync: a revoked/public-to-private repository
  // must never be refreshed using the agent's own GitHub connection.
  await githubMetadata(owner,repo);
  const head = await githubGet(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
  const sha = head.sha, treeSha = head.commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(treeSha)) throw new GithubError("El commit de GitHub no es válido.",502);
  if (sha === previousSha) return {unchanged:true as const,sha};
  const tree = await githubGet(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
  if (!Array.isArray(tree.tree)) throw new GithubError("No se pudo leer la estructura del repositorio.",502);
  const raw = tree.tree.filter((f:TreeFile) => f && typeof f.path === "string" && f.type === "blob") as TreeFile[];
  const eligible = raw.filter(eligibleGithubFile).sort((a,b) => filePriority(a.path)-filePriority(b.path) || a.path.localeCompare(b.path));
  const files: {path:string;text:string;url:string}[] = []; let total = 0, inspected = 0;
  for (const entry of eligible) {
    if (files.length >= GITHUB_LIMITS.files || inspected >= GITHUB_LIMITS.files + 2) break;
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > GITHUB_LIMITS.fileBytes || total + entry.size > GITHUB_LIMITS.textBytes) continue;
    inspected++;
    const blob = await githubGet(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`);
    if (blob.sha !== entry.sha || blob.encoding !== "base64" || typeof blob.content !== "string" || blob.content.length > GITHUB_LIMITS.fileBytes * 2 || blob.size !== entry.size) throw new GithubError("Un archivo de GitHub no coincide con su versión.",502);
    let text: string;
    try { const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g,"")),c=>c.charCodeAt(0)); if (bytes.byteLength !== entry.size) throw new Error("size"); text = safeMemoryText(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
    catch { continue; } // Omit binary/credential-like content, never log it.
    files.push({path:entry.path,text,url:`https://github.com/${owner}/${repo}/blob/${sha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`}); total += new TextEncoder().encode(text).byteLength;
  }
  const paths: string[] = []; let pathBytes = 0;
  for (const file of eligible.slice(0,GITHUB_LIMITS.paths)) {
    pathBytes += new TextEncoder().encode(file.path).byteLength + 1;
    if (pathBytes > 8192) break;
    paths.push(file.path);
  }
  const activity = await githubActivity(owner,repo,sha,head,previousSha);
  const content = safeMemoryText([`GITHUB · FUENTE DE SOLO LECTURA · COBERTURA PARCIAL\nRepositorio: ${owner}/${repo}\nRama: ${branch}\nCommit: ${sha}\nReferencia: https://github.com/${owner}/${repo}/tree/${sha}\nMensaje del commit: ${activity.message}\nActividad técnica guardada: ${JSON.stringify(activity)}\nArchivos completos incluidos: ${files.length}. Archivos de texto elegibles no leídos: ${eligible.length-files.length}. Archivos excluidos por tipo o seguridad: ${raw.length-eligible.length}. Árbol truncado por GitHub: ${tree.truncated === true ? "sí" : "no"}.\nNo es evidencia de que las tareas estén terminadas; no contiene conversaciones de Codex ni cambios locales.`,
    `ESTRUCTURA (máximo ${GITHUB_LIMITS.paths} rutas)\n${paths.join("\n")}`,
    ...files.map(f=>`ARCHIVO COMPLETO: ${f.path}\nReferencia: ${f.url}\n\n${f.text}`)].join("\n\n"));
  return {unchanged:false as const,sha,content,activity,files:files.map(f=>f.path),included:files.length,omitted:eligible.length-files.length,excluded:raw.length-eligible.length,treeTruncated:tree.truncated === true};
}
