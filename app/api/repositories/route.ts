import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { ownedRepositoryProject, linkGithubRepository, syncGithubRepository, githubContextPack } from "@/db/repositories";
import { projectRepositorySources } from "@/lib/github-context";
import { GithubError } from "@/lib/github-client";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
async function inputText(request: Request) {
  const reader = request.body?.getReader(); if (!reader) return "";
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1500) { await reader.cancel(); throw new GithubError("Entrada demasiado grande.",413); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) {bytes.set(part,offset);offset += part.byteLength;}
  return new TextDecoder().decode(bytes);
}
function failure(error: unknown) {
  if (error instanceof GithubError || error instanceof WorkspaceConfigurationError) return json({error:error.message},error.status);
  if (error instanceof SyntaxError) return json({error:"Entrada JSON no válida."},400);
  console.error("github_repository_failed",error instanceof Error ? error.name : "unknown");
  return json({error:"No se pudo vincular o sincronizar el repositorio. Los datos existentes se conservan."},503);
}
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), state = await getWorkspaceState(userId), params = new URL(request.url).searchParams;
    const project = ownedRepositoryProject(state,userId,params.get("projectId"));
    if (params.get("context") === "1") return json(await githubContextPack(userId,state,project.id,params.get("repositoryId") ?? undefined));
    return json({repositories:state.repositories.filter(r=>r.projectId === project.id && r.userId === userId),sources:projectRepositorySources(state,userId,project.id).map(s=>({id:s.item.id,...s.source}))});
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await currentWorkspaceId(request);
    const input = await inputText(request);
    const body = JSON.parse(input) as Record<string,unknown>;
    if (!body || Array.isArray(body) || typeof body !== "object") throw new GithubError("Entrada no válida.",400);
    const state = await getWorkspaceState(userId), project = ownedRepositoryProject(state,userId,body.projectId);
    const result = body.action === "link" ? await linkGithubRepository(userId,state,project.id,body.url,body.branch)
      : body.action === "sync" ? await syncGithubRepository(userId,state,project.id,body.repositoryId)
      : (()=>{throw new GithubError("Acción no válida.",400);})();
    return json({...result,state:await getWorkspaceState(userId)});
  } catch (error) { return failure(error); }
}
