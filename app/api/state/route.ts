import { getWorkspaceState } from "@/db/workspace";
import { WorkspaceConfigurationError, currentWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getWorkspaceState(await currentWorkspaceId());
    return Response.json(state);
  } catch (error) {
    if (error instanceof WorkspaceConfigurationError) return Response.json({ error: error.message }, { status: 503 });
    console.error("workspace_state_failed", error);
    return Response.json({ error: "No fue posible cargar el espacio de trabajo." }, { status: 500 });
  }
}
