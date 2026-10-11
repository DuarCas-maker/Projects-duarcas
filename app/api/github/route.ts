import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { githubConnection } from "@/lib/github-app";
import { GithubError } from "@/lib/github-errors";

export const dynamic = "force-dynamic";
export async function GET() {
  const headers = {"Cache-Control":"private, no-store"};
  try {
    await currentWorkspaceId();
    return Response.json(await githubConnection(),{headers});
  } catch (error) {
    if (error instanceof GithubError || error instanceof WorkspaceConfigurationError) return Response.json({error:error.message},{status:error.status,headers});
    console.error("github_connection_failed",error instanceof Error ? error.name : "unknown");
    return Response.json({error:"No se pudo comprobar la conexión de GitHub. Reintenta."},{status:503,headers});
  }
}
