import { AiError } from "@/db/ai-history";
import { CoreValidationError } from "./core-commands";
import { WorkspaceConfigurationError } from "@/lib/workspace-context";
import { SupabaseConflictError } from "@/db/supabase";

export const notebookJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function notebookFailure(error: unknown) {
  if (error instanceof AiError || error instanceof CoreValidationError || error instanceof WorkspaceConfigurationError) return notebookJson({ error: error.message }, error.status);
  if (error instanceof SupabaseConflictError) return notebookJson({ error: error.message }, 409);
  if (error instanceof SyntaxError) return notebookJson({ error: "Entrada JSON no válida." }, 400);
  console.error("notebook_request_failed", error instanceof Error ? error.name : "unknown");
  return notebookJson({ error: "No se pudo completar la operación del bloc. Revisa el historial antes de reintentar." }, 503);
}
