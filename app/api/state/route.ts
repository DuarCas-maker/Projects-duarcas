import { getWorkspaceState } from "@/db/workspace";
import { AuthenticationError, currentUserId } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getWorkspaceState(await currentUserId());
    return Response.json(state);
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    console.error("workspace_state_failed", error);
    return Response.json({ error: "No fue posible cargar el espacio de trabajo." }, { status: 500 });
  }
}
