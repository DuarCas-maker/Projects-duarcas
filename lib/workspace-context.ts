import { env } from "cloudflare:workers";

export class WorkspaceConfigurationError extends Error {
  constructor() {
    super("El espacio de trabajo no está configurado en el servidor.");
    this.name = "WorkspaceConfigurationError";
  }
}

// Project OS is deliberately a single shared workspace with anonymous read and
// write access. Visitors cannot select another workspace through request input.
export async function currentWorkspaceId() {
  const workspaceId = env.PROJECT_OS_WORKSPACE_ID?.trim();
  if (!workspaceId || !/^[a-zA-Z0-9_-]{1,200}$/.test(workspaceId)) {
    throw new WorkspaceConfigurationError();
  }
  return workspaceId;
}

export async function canClaimLegacyWorkspace(workspaceId: string) {
  return workspaceId === await currentWorkspaceId();
}
