import { GithubError } from "./github-errors";

// Fixed origin, bounded responses, no redirects, no upstream error bodies in logs.
export async function githubRequest(path: string, token?: string, body?: unknown) {
  if (!/^\/(repos|app|installation)(\/|\?|$)/.test(path) || /[\x00-\x20#\\]/.test(path) ||
      new URL(`https://api.github.com${path}`).pathname !== path.split("?")[0]) throw new GithubError("Ruta de GitHub no válida.",400);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Project-OS-read-only", "X-GitHub-Api-Version": "2026-03-10",
        ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body === undefined ? {} : {"Content-Type":"application/json"}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
  } catch { throw new GithubError("No se pudo conectar con GitHub. El contexto anterior se conserva.",502); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new GithubError("Repositorio, rama o instalación no disponible. Para privados, autoriza el repositorio en la GitHub App.",404);
    if (response.status === 401) throw new GithubError("GitHub rechazó la credencial de la App. Revisa su configuración en el servidor.",503);
    if ([403,429].includes(response.status)) throw new GithubError("GitHub rechazó o limitó la lectura. Revisa los permisos de la App o espera antes de reintentar.",response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after") || !token ? 429 : 403);
    throw new GithubError("GitHub no pudo completar la lectura. El contexto anterior se conserva.",502);
  }
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new GithubError("La respuesta de GitHub supera el límite de lectura.",413); }
  const reader = response.body?.getReader(); if (!reader) throw new GithubError("GitHub devolvió una respuesta vacía.",502);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new GithubError("La respuesta de GitHub supera el límite de lectura.",413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part,at); at += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
  catch { throw new GithubError("GitHub no devolvió datos utilizables.",502); }
}
