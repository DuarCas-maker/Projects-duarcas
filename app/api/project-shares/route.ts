import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { sharesFor, newShareToken } from "@/db/project-shares";
import { operationsFor } from "@/lib/project-operations";
import { operationsChange } from "@/lib/operations-commands";
import { contentHash } from "@/lib/brain-content";
import { CoreValidationError, databaseRow, type CoreChange } from "@/lib/core-commands";
import { persistCorePlan } from "@/db/core-mutations";
import { SupabaseConflictError } from "@/db/supabase";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const failure = (error: unknown) => error instanceof SyntaxError ? json({ error: "Entrada no válida." }, 400) : error instanceof CoreValidationError || error instanceof WorkspaceConfigurationError ? json({ error: error.message }, error.status) : error instanceof SupabaseConflictError ? json({ error: error.message }, 409) : json({ error: "No se pudo administrar el enlace." }, 503);
export async function GET(request: Request) {
  try {
    const userId = await currentWorkspaceId(), projectId = new URL(request.url).searchParams.get("projectId") ?? "", state = await getWorkspaceState(userId);
    if (!state.projects.some(p => p.id === projectId)) throw new CoreValidationError("Proyecto no encontrado.", 404);
    return json({ shares: (await sharesFor(userId, projectId)).map(({ id, personId, active, createdAt }) => ({ id, personId, active, createdAt })) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await currentWorkspaceId(request), raw = await request.text();
    if (raw.length > 2000) throw new CoreValidationError("Entrada demasiado grande.", 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CoreValidationError("Entrada no válida.");
    const state = await getWorkspaceState(userId);
    const project = state.projects.find(p => p.id === body.projectId) ?? (() => { throw new CoreValidationError("Proyecto no encontrado.", 404); })();
    const data = operationsFor(state, project.id), person = data.people.find(p => p.id === body.personId && p.active);
    if (!person || !["create", "revoke"].includes(body.action)) throw new CoreValidationError("Selecciona una persona activa y una acción válida.");
    const existing = await sharesFor(userId, project.id), now = new Date().toISOString(), id = crypto.randomUUID(), changes: CoreChange[] = [];
    for (const share of existing.filter(s => s.personId === person.id && s.active)) changes.push({ table: "project_shares", kind: "update", row: databaseRow({ ...share, active: false, updatedAt: now }), expected: databaseRow(share) });
    const token = body.action === "create" ? newShareToken() : null;
    if (token) changes.push({ table: "project_shares", kind: "insert", row: databaseRow({ id, userId, projectId: project.id, personId: person.id, tokenHash: await contentHash(token), active: true, requestCount: 0, windowStart: now, createdAt: now, updatedAt: now }) });
    changes.push(operationsChange(state, project.id, data, now));
    changes.push({ table: "project_events", kind: "insert", row: databaseRow({ id, userId, projectId: project.id, eventType: "organization", title: token ? "Enlace personal generado" : "Enlace personal desactivado", description: person.name, sourceType: "manual", sourceId: person.id, eventDate: now, createdAt: now }) });
    await persistCorePlan(userId, { id, changes });
    // Raw bearer tokens are returned once and never persisted or logged.
    return json({ token, id, state: await getWorkspaceState(userId) }, 201);
  } catch (error) { return failure(error); }
}
