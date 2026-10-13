import { env } from "cloudflare:workers";
import { currentWorkspaceId } from "@/lib/workspace-context";
import { AiError, findAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { reserveVoice, voiceStatus } from "@/db/notebook";
import { NOTEBOOK_AUDIO_MAX_BYTES, notebookWavDuration } from "@/lib/notebook-audio";
import { notebookFailure, notebookJson as json } from "@/lib/notebook-http";
import { notebookOpenAiError } from "@/lib/notebook-provider";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let reserved: { userId: string; id: string } | undefined;
  try {
    const userId = await currentWorkspaceId(request);
    if (Number(request.headers.get("content-length")) > NOTEBOOK_AUDIO_MAX_BYTES + 8192) throw new AiError("El audio supera cinco minutos.", 413);
    // Bound the stream before multipart parsing, including requests without Content-Length.
    const reader = request.body?.getReader(); if (!reader) throw new AiError("No se recibió audio.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > NOTEBOOK_AUDIO_MAX_BYTES + 8192) { await reader.cancel(); throw new AiError("El audio supera el tamaño permitido.", 413); } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const id = form.get("requestId"), audio = form.get("audio");
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !(audio instanceof File) || audio.size > NOTEBOOK_AUDIO_MAX_BYTES) throw new AiError("Audio o identificador no válido.", 400);
    const buffer = await audio.arrayBuffer(), seconds = notebookWavDuration(buffer);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
    const existing = await findAiRun(userId, id);
    if (existing) {
      if (existing.kind !== "notebook_voice" || JSON.parse(existing.query).hash !== hash) throw new AiError("Este envío pertenece a otro audio.", 409);
      if (existing.status === "completed") return json({ ...JSON.parse(existing.result), voice: await voiceStatus(userId), replayed: true });
      if (existing.status === "failed" || existing.status === "pending" && Date.parse(existing.created_at) < Date.now() - 5 * 60000) {
        if (existing.status === "pending") await failAiRun(userId, id);
        throw new AiError("El intento de dictado anterior falló o expiró. Puedes reintentar con el audio conservado.", 502);
      }
      throw new AiError("Este dictado está en curso o falló. Recarga antes de enviar otro intento.", 409);
    }
    await reserveVoice(userId, id, hash, seconds); reserved = { userId, id };
    const input = new FormData(); input.set("file", new File([buffer], "dictado.wav", { type: "audio/wav" })); input.set("model", "gpt-4o-mini-transcribe"); input.set("language", "es"); input.set("response_format", "json");
    let response: Response;
    try { response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: input }); }
    catch { throw new AiError("No se pudo transcribir el dictado. Puedes reintentar con el audio conservado en esta pantalla.", 502); }
    if (!response.ok) return await notebookOpenAiError(response);
    const result = await response.json() as { text?: string };
    if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 12000) throw new AiError("No se obtuvo una transcripción válida de hasta 12000 caracteres.", 502);
    const saved = { text: result.text.trim(), seconds };
    await finishAiRun(userId, id, saved); reserved = undefined;
    return json({ ...saved, voice: await voiceStatus(userId) });
  } catch (error) { if (reserved) await failAiRun(reserved.userId, reserved.id).catch(() => undefined); return notebookFailure(error); }
}
