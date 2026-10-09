import { env } from "cloudflare:workers";
import { AuthError, assertWriteOrigin, requireOwner } from "./supabase-auth";

export class WorkspaceConfigurationError extends Error {
  constructor(message = "El espacio de trabajo no está configurado en el servidor.", public status = 503) {
    super(message);
    this.name = "WorkspaceConfigurationError";
  }
}

// Auth identity authorizes the existing workspace; it does not replace its ID.
// This preserves the owner's existing projects and private document namespace.
export async function currentWorkspaceId(writeRequest?: Request) {
  try {
    await requireOwner();
    if (writeRequest) assertWriteOrigin(writeRequest);
  } catch (error) {
    if (error instanceof AuthError) throw new WorkspaceConfigurationError(error.message, error.status);
    throw error;
  }
  const workspaceId = env.PROJECT_OS_WORKSPACE_ID?.trim();
  if (!workspaceId || !/^[a-zA-Z0-9_-]{1,200}$/.test(workspaceId)) {
    throw new WorkspaceConfigurationError();
  }
  return workspaceId;
}

export async function canClaimLegacyWorkspace(workspaceId: string) {
  return workspaceId === await currentWorkspaceId();
}
