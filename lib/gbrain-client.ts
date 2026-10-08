// Streamable HTTP adapter for the pinned GBrain release. Never imported by UI.
export class BrainError extends Error {
  constructor(message: string, public status = 503, public code = "unavailable") { super(message); this.name = "BrainError"; }
}
export type GBrainConfig = { url: string; sourceId: string; clientId: string; clientSecret: string };
type Rpc = { jsonrpc?: string; id?: string; result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: unknown };
let cached: { key: string; token: string; until: number } | undefined;

export function validateBrainConfig(config: GBrainConfig) {
  const url = new URL(config.url);
  // This installation has one approved origin. Configuration cannot redirect
  // credentials to arbitrary services or turn the public endpoint into SSRF.
  if (url.origin !== "https://brain.brant--co.com" || !["", "/"].includes(url.pathname) || url.username || url.password || url.search || url.hash || config.sourceId !== "project-os" || !config.clientId || !config.clientSecret) throw new BrainError("La configuración de GBrain no es válida.");
  return url.origin;
}
export async function boundedText(response: Response, max = 512 * 1024) {
  if (Number(response.headers.get("content-length")) > max) throw new BrainError("La respuesta supera el límite permitido.", 502);
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > max) throw new BrainError("La respuesta supera el límite permitido.", 502); chunks.push(item.value); }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export function parseRpc(text: string, contentType: string, id: string): Rpc {
  const values: Rpc[] = contentType.includes("text/event-stream")
    ? text.replace(/\r\n/g, "\n").split(/\n\n/).filter((block) => /^data:/m.test(block)).map((block) => JSON.parse(block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")))
    : [JSON.parse(text)];
  const message = values.find((value) => value.id === id && value.jsonrpc === "2.0");
  if (!message || message.error || !message.result) throw new BrainError("GBrain no devolvió una respuesta válida.", 502);
  return message;
}
function toolFailure(value: unknown): BrainError {
  const row = value && typeof value === "object" ? value as { code?: string; error?: { code?: string } | string } : {};
  const code = row.code ?? (typeof row.error === "object" ? row.error?.code : row.error) ?? "unavailable";
  const known: Record<string, [string, number]> = {
    page_not_found: ["La página de memoria no existe.", 404], not_found: ["La página de memoria no existe.", 404],
    permission_denied: ["La credencial no permite esta operación de memoria.", 503], unknown_tool: ["La credencial no permite esta operación de memoria.", 503],
    revision_conflict: ["La memoria cambió. No se sobrescribió su contenido.", 409], revision_required: ["La memoria ya existe. No se sobrescribió su contenido.", 409],
    write_pending: ["GBrain sigue procesando la escritura. Reintenta para revisar su resultado.", 503],
  };
  const info = known[code]; return new BrainError(info?.[0] ?? "GBrain no pudo completar la operación. El original se conserva.", info?.[1] ?? 502, code);
}
export class GBrainClient {
  private origin: string;
  constructor(private config: GBrainConfig) { this.origin = validateBrainConfig(config); }
  private async token(refresh = false) {
    const key = `${this.origin}:${this.config.clientId}:${this.config.clientSecret}`;
    if (!refresh && cached?.key === key && cached.until > Date.now()) return cached.token;
    const response = await fetch(`${this.origin}/token`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.config.clientId, client_secret: this.config.clientSecret, scope: "read write", resource: `${this.origin}/mcp` }) });
    if (!response.ok) { cached = undefined; throw new BrainError("GBrain rechazó la credencial o no está disponible."); }
    const data = JSON.parse(await boundedText(response, 16000)) as { access_token?: string; expires_in?: number; token_type?: string };
    if (!data.access_token || data.token_type?.toLowerCase() !== "bearer") throw new BrainError("No se pudo obtener acceso a GBrain.");
    cached = { key, token: data.access_token, until: Date.now() + Math.max(0, Math.min(3600, Number(data.expires_in) || 3600) - 30) * 1000 };
    return cached.token;
  }
  async call<T = Record<string, unknown>>(name: "put_page" | "get_page" | "search" | "get_write_request" | "whoami", args: Record<string, unknown> = {}): Promise<T> {
    const id = crypto.randomUUID();
    const send = async (refresh: boolean) => fetch(`${this.origin}/mcp`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(35000), headers: { Authorization: `Bearer ${await this.token(refresh)}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) });
    try {
      let response = await send(false);
      if (response.status === 401) { await response.body?.cancel(); response = await send(true); }
      if (!response.ok) throw new BrainError("No se pudo contactar con GBrain. El original se conserva.", 502);
      const result = parseRpc(await boundedText(response), response.headers.get("content-type") ?? "", id).result!;
      const value = JSON.parse(result.content?.find((block) => block.type === "text")?.text ?? "null");
      if (result.isError) throw toolFailure(value);
      return value as T;
    } catch (error) {
      if (error instanceof BrainError) throw error;
      // Only enum-like diagnostics, never error.message/cause payloads: a
      // network proxy or upstream response could echo authorization headers.
      const kind = error instanceof Error && ["TypeError","AbortError","TimeoutError","SyntaxError"].includes(error.name) ? error.name : "unknown";
      console.error("gbrain_transport_failed",kind);
      throw new BrainError("No se pudo contactar con GBrain. El original se conserva.",502);
    }
  }
}
