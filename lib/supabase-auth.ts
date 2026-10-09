import { env } from "cloudflare:workers";
import { cookies, headers } from "next/headers";
import { AuthError, assertOrigin, assertOwner, authConfig } from "./auth-policy";
export { AuthError } from "./auth-policy";

const ACCESS = "project_os_access";
const REFRESH = "project_os_refresh";
type Session = { access_token: string; refresh_token: string; expires_in: number };
async function limitedText(response: Response, limit: number, status: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AuthError("Solicitud o respuesta de autenticación demasiado grande.", status); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function authRequest(path: string, init: RequestInit = {}, token?: string) {
  const config = authConfig(env as Record<string, unknown>);
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1${path}`, {
      ...init, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { apikey: config.key, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    });
  } catch { throw new AuthError("No se pudo contactar con Supabase Auth. Reintenta en unos segundos.", 503); }
  if (!response.ok) {
    if (response.status === 429) throw new AuthError("Demasiados intentos. Espera antes de reintentar.", 429);
    if (response.status >= 500 || response.status < 400) throw new AuthError("Supabase Auth no está disponible.", 503);
    throw new AuthError("Correo, contraseña o sesión no válidos.");
  }
  if (response.status === 204) return null;
  const text = await limitedText(response, 262144, 503);
  try { return JSON.parse(text); } catch { throw new AuthError("Respuesta de autenticación no válida.", 503); }
}

export async function requireOwner() {
  const config = authConfig(env as Record<string, unknown>);
  assertOrigin(new Headers(await headers()), config);
  const token = (await cookies()).get(ACCESS)?.value;
  if (!token || token.length > 8192) throw new AuthError();
  // Verify with Supabase Auth on every protected request; no cookie/JWT decoding trust.
  return assertOwner(await authRequest("/user", {}, token), config);
}
export function assertWriteOrigin(request: Request) {
  assertOrigin(request.headers, authConfig(env as Record<string, unknown>), true);
}

async function saveSession(session: Session) {
  if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string" ||
      session.access_token.length > 8192 || session.refresh_token.length > 8192 || !Number.isFinite(session.expires_in) || session.expires_in <= 0) {
    throw new AuthError("Respuesta de autenticación no válida.", 503);
  }
  const config = authConfig(env as Record<string, unknown>);
  const owner = assertOwner(await authRequest("/user", {}, session.access_token), config);
  const jar = await cookies();
  const options = { httpOnly: true, secure: config.secure, sameSite: "strict" as const, path: "/" };
  jar.set(ACCESS, session.access_token, { ...options, maxAge: Math.min(session.expires_in, 3600) });
  jar.set(REFRESH, session.refresh_token, { ...options, maxAge: 7 * 86400 });
  return owner;
}

export async function authOperation(request: Request) {
  const config = authConfig(env as Record<string, unknown>);
  assertOrigin(request.headers, config, true);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AuthError("Formato no válido.", 400);
  const text = await limitedText(new Response(request.body), 8192, 413);
  let body: { action?: string; email?: string; password?: string };
  try { body = JSON.parse(text); } catch { throw new AuthError("Solicitud no válida.", 400); }
  if (!body || Array.isArray(body) || typeof body !== "object") throw new AuthError("Solicitud no válida.", 400);
  if (body.action === "login") {
    if (typeof body.email !== "string" || body.email.trim().toLowerCase() !== config.owner ||
        typeof body.password !== "string" || body.password.length < 1 || body.password.length > 1024) {
      throw new AuthError("Correo, contraseña o sesión no válidos.");
    }
    const session = await authRequest("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: config.owner, password: body.password }) });
    return saveSession(session);
  }
  if (body.action === "refresh") {
    const token = (await cookies()).get(REFRESH)?.value;
    if (!token || token.length > 8192) throw new AuthError();
    return saveSession(await authRequest("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: token }) }));
  }
  if (body.action === "logout") {
    const jar = await cookies();
    const token = jar.get(ACCESS)?.value;
    jar.set(ACCESS, "", { path: "/", httpOnly: true, secure: config.secure, sameSite: "strict", maxAge: 0 });
    jar.set(REFRESH, "", { path: "/", httpOnly: true, secure: config.secure, sameSite: "strict", maxAge: 0 });
    if (token && token.length <= 8192) {
      try { await authRequest("/logout?scope=local", { method: "POST" }, token); } catch { /* Local cookies are cleared even if upstream is unavailable. */ }
    }
    return null;
  }
  throw new AuthError("Operación no válida.", 400);
}
