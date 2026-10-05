import { headers } from "next/headers";
import { env } from "cloudflare:workers";

export class AuthenticationError extends Error {
  constructor() {
    super("Inicia sesión para acceder a tu espacio de trabajo.");
    this.name = "AuthenticationError";
  }
}

export async function currentUserId() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  if (!userId) throw new AuthenticationError();
  const ownerEmail = env.PROJECT_OS_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail && requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase() !== ownerEmail) throw new AuthenticationError();
  return userId;
}

export async function canClaimLegacyWorkspace(userId: string) {
  const requestHeaders = await headers();
  const ownerEmail = env.PROJECT_OS_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(ownerEmail && requestHeaders.get("oai-authenticated-user-id") === userId && requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase() === ownerEmail);
}
