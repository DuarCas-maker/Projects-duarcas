import { env } from "cloudflare:workers";
import { shareContext } from "@/db/project-shares";
import { CoreValidationError, buildCoreCommand, databaseRow, type CoreChange } from "@/lib/core-commands";
import { buildOperationsCommand, operationsChange } from "@/lib/operations-commands";
import { sharedProjection } from "@/lib/shared-project";
import { personHasTask } from "@/lib/project-operations";
import { persistCorePlan } from "@/db/core-mutations";
import { writeTaskObject, readTaskObject } from "@/db/task-attachments";
import { boundedDocumentBytes } from "@/lib/brain-documents";
import { BrainError } from "@/lib/gbrain-client";
import { SupabaseConflictError } from "@/db/supabase";
import { TASK_FILE_ACCEPT, taskAttachments } from "@/lib/task-attachments";
export const dynamic = "force-dynamic";
const MAX_UPLOAD = 10 * 1024 * 1024;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const tokenFor = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
const failure = (error: unknown) => error instanceof SyntaxError ? json({ error: "Entrada no válida." }, 400) : error instanceof CoreValidationError || error instanceof BrainError ? json({ error: error.message }, error.status) : error instanceof SupabaseConflictError ? json({ error: "Las tareas cambiaron. Actualiza la vista antes de guardar." }, 409) : json({ error: "No se pudo completar la operación." }, 503);
export async function GET(request: Request) {
  try {
    const c = await shareContext(tokenFor(request)), params = new URL(request.url).searchParams;
    if (params.has("deliveryId")) {
      const delivery = c.data.deliveries.find(d => d.id === params.get("deliveryId") && personHasTask(c.data, d.taskId, c.person.id));
      if (!delivery) throw new CoreValidationError("Archivo no encontrado.", 404);
      const bytes = await readTaskObject(c.share.userId, c.project.id, delivery.key, MAX_UPLOAD);
      return new Response(bytes as unknown as BodyInit, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(delivery.name)}` } });
    }
    if (params.has("resourceId")) {
      const attached = c.state.tasks.filter(t => t.projectId === c.project.id && personHasTask(c.data, t.id, c.person.id)).flatMap(t => taskAttachments(c.state, t.id)).flatMap(a => a.attachment.versions.filter(v => v.id === a.attachment.activeVersionId));
      const resource = attached.find(v => v.id === params.get("resourceId") && v.key);
      if (!resource?.key) throw new CoreValidationError("Archivo no encontrado.", 404);
      const bytes = await readTaskObject(c.share.userId, c.project.id, resource.key, 25 * 1024 * 1024);
      return new Response(bytes as unknown as BodyInit, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resource.name)}` } });
    }
    return json(sharedProjection(c.state, c.project.id, c.person.id));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const expectedOrigin = env.PROJECT_OS_APP_URL ? new URL(env.PROJECT_OS_APP_URL).origin : new URL(request.url).origin;
    if (request.headers.get("origin") !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") throw new CoreValidationError("Solicitud de otro origen rechazada.", 403);
    const c = await shareContext(tokenFor(request)), now = new Date().toISOString();
    const windowStart = Date.parse(c.share.windowStart), sameWindow = Date.now() - windowStart < 60_000;
    if (sameWindow && c.share.requestCount >= 20) throw new CoreValidationError("Espera un minuto antes de enviar más cambios.", 429);
    let body: Record<string, unknown>, uploaded: File | null = null;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const bytes = await boundedDocumentBytes(new Response(request.body), MAX_UPLOAD + 64 * 1024), form = await new Response(bytes as unknown as BodyInit, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
      body = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
      const file = form.get("file"); if (file instanceof File) uploaded = file;
    } else {
      const raw = await request.text(); if (raw.length > 6000) throw new CoreValidationError("Entrada demasiado grande.", 413); body = JSON.parse(raw);
    }
    if (!body || Array.isArray(body) || !["status", "comment", "upload"].includes(String(body.action)) || typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new CoreValidationError("Entrada no válida.");
    const task = c.state.tasks.find(t => t.id === body.taskId && t.projectId === c.project.id && personHasTask(c.data, t.id, c.person.id));
    if (!task) throw new CoreValidationError("Tarea no encontrada.", 404);
    const commandId = `share_${c.share.id}_${body.requestId}`;
    if (c.state.events.some(e => e.id === commandId)) return json({ ...sharedProjection(c.state, c.project.id, c.person.id), replayed: true });
    let plan: { id: string; changes: CoreChange[] };
    if (body.action === "status") {
      if (!["pending", "in_progress", "blocked", "review", "completed"].includes(String(body.status))) throw new CoreValidationError("El estado no está permitido.");
      plan = buildCoreCommand(c.state, c.share.userId, "update_task_status", { id: task.id, status: body.status, updatedAt: body.updatedAt, blockingReason: body.blockingReason, ...(body.columnId ? { columnId: body.columnId } : {}) }, commandId, now);
    } else if (body.action === "comment") {
      plan = buildOperationsCommand(c.state, c.share.userId, "add_task_comment", { projectId: c.project.id, taskId: task.id, body: body.body, personId: c.person.id }, commandId, now);
    } else {
      if (!uploaded || uploaded.size < 1 || uploaded.size > MAX_UPLOAD || !TASK_FILE_ACCEPT.split(",").includes(`.${uploaded.name.split(".").at(-1)?.toLowerCase()}`)) throw new CoreValidationError("Sube un documento o imagen de hasta 10 MB.", 413);
      const name = uploaded.name.slice(0, 180), key = `${c.share.userId}/${c.project.id}/shared-deliveries/${commandId}/${crypto.randomUUID()}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await writeTaskObject(key, uploaded);
      plan = buildOperationsCommand(c.state, c.share.userId, "add_task_delivery", { projectId: c.project.id, taskId: task.id, personId: c.person.id, key, name, size: uploaded.size, mime: uploaded.type || "application/octet-stream" }, commandId, now);
    }
    // Guard both current membership and link revocation inside the same commit.
    if (!plan.changes.some(change => change.table === "project_operations")) plan.changes.unshift(operationsChange(c.state, c.project.id, c.data, now));
    plan.changes.unshift({ table: "project_shares", kind: "update", row: databaseRow({ ...c.share, requestCount: sameWindow ? c.share.requestCount + 1 : 1, windowStart: sameWindow ? c.share.windowStart : now, updatedAt: now }), expected: databaseRow(c.share) });
    const event = plan.changes.find(change => change.table === "project_events")!;
    event.row.source_type = "shared_link"; event.row.description = `Desde el enlace de ${c.person.name}. ${event.row.description}`;
    const result = await persistCorePlan(c.share.userId, plan, false);
    return json(sharedProjection(result.state, c.project.id, c.person.id));
  } catch (error) { return failure(error); }
}
