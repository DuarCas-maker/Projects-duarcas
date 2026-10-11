import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { operationsFor } from "@/lib/project-operations";
import { readTaskObject } from "@/db/task-attachments";
import { CoreValidationError } from "@/lib/core-commands";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), params = new URL(request.url).searchParams, projectId = params.get("projectId") ?? "", state = await getWorkspaceState(userId);
    if (!state.projects.some(p => p.id === projectId)) throw new CoreValidationError("Proyecto no encontrado.", 404);
    const delivery = operationsFor(state, projectId).deliveries.find(d => d.id === params.get("id"));
    if (!delivery) throw new CoreValidationError("Archivo no encontrado.", 404);
    const bytes = await readTaskObject(userId, projectId, delivery.key, 10 * 1024 * 1024);
    return new Response(bytes as unknown as BodyInit, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(delivery.name)}` } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo leer el archivo." }, { status: error instanceof CoreValidationError || error instanceof WorkspaceConfigurationError ? error.status : 503 }); }
}
