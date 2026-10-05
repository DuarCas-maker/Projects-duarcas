import { getWorkspaceState } from "@/db/workspace";
import { currentUserId } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getWorkspaceState(await currentUserId());
    return Response.json(state);
  } catch (error) {
    console.error("workspace_state_failed", error);
    return Response.json({ error: "No fue posible cargar el espacio de trabajo." }, { status: 500 });
  }
}
