// Pure policy: never authorize a decoded JWT, workspace ID or client metadata.
export class AuthError extends Error {
  constructor(message = "Inicia sesión para acceder a Project OS.", public status = 401) {
    super(message); this.name = "AuthError";
  }
}

export function authConfig(env: Record<string, unknown>) {
  try {
    const url = new URL(String(env.SUPABASE_URL || ""));
    const app = new URL(String(env.PROJECT_OS_APP_URL || ""));
    const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
    const owner = String(env.PROJECT_OS_OWNER_EMAIL || "").trim().toLowerCase();
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(app.hostname);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
        (!local && app.protocol !== "https:") || !["https:", "http:"].includes(app.protocol) ||
        app.username || app.password || !key || !owner.includes("@")) throw new Error();
    return { url: url.origin, origin: app.origin, key, owner, ownerId: String(env.PROJECT_OS_OWNER_ID || "").trim(), secure: app.protocol === "https:" };
  } catch { throw new AuthError("El login no está configurado en el servidor.", 503); }
}

export function assertOwner(user: unknown, config: ReturnType<typeof authConfig>) {
  const value = user as { id?: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null;
  if (!value || !/^[0-9a-f-]{36}$/i.test(value.id || "") || value.is_anonymous ||
      !value.email_confirmed_at || value.email?.toLowerCase() !== config.owner ||
      (config.ownerId && value.id !== config.ownerId)) {
    throw new AuthError("Esta cuenta no tiene acceso a Project OS.", 403);
  }
  return { id: value.id!, email: value.email! };
}

export function assertOrigin(headers: Headers, config: ReturnType<typeof authConfig>, required = false) {
  const origin = headers.get("origin");
  if ((required && !origin) || (origin && origin !== config.origin) ||
      headers.get("sec-fetch-site") === "cross-site") {
    throw new AuthError("Solicitud de otro origen rechazada.", 403);
  }
}
