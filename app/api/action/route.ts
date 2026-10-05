import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureWorkspace } from "@/db/workspace";
import { aiSuggestions, calendarBlocks, inboxItems, projectEvents, projects, tasks } from "@/db/schema";
import { currentUserId } from "@/lib/current-user";

export const dynamic = "force-dynamic";

type ActionPayload = { action?: string; payload?: Record<string, unknown> };

const cleanText = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const cleanId = (value: unknown) => cleanText(value, 100).replace(/[^a-zA-Z0-9_-]/g, "");

export async function POST(request: Request) {
  try {
    const userId = await currentUserId();
    await ensureWorkspace(userId);
    const db = getDb();
    const body = (await request.json()) as ActionPayload;
    const payload = body.payload ?? {};
    const now = new Date().toISOString();

    if (body.action === "create_task") {
      const projectId = cleanId(payload.projectId);
      const title = cleanText(payload.title, 180);
      if (!projectId || !title) return Response.json({ error: "Proyecto y título son obligatorios." }, { status: 400 });
      const project = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.id, projectId))).limit(1);
      if (!project.length) return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
      const task = {
        id: crypto.randomUUID(), userId, projectId, milestoneId: null, parentTaskId: null, title,
        description: cleanText(payload.description, 1000), status: "pending", priority: Number(payload.priority) || 3,
        urgency: Number(payload.urgency) || 3, estimatedMinutes: Number(payload.estimatedMinutes) || 30,
        deadline: cleanText(payload.deadline, 20) || null, scheduledStart: null, scheduledEnd: null,
        isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null,
        aiGenerated: false, approved: true, completedAt: null, createdAt: now, updatedAt: now,
      };
      await db.insert(tasks).values(task);
      await db.insert(projectEvents).values({ id: crypto.randomUUID(), userId, projectId, eventType: "task", title: "Tarea creada", description: title, sourceType: "manual", sourceId: task.id, eventDate: now, createdAt: now });
      return Response.json({ task }, { status: 201 });
    }

    if (body.action === "update_task_status") {
      const id = cleanId(payload.id);
      const allowed = ["inbox", "pending", "ready", "in_progress", "blocked", "review", "completed", "cancelled"];
      const status = cleanText(payload.status, 30);
      if (!id || !allowed.includes(status)) return Response.json({ error: "Estado inválido." }, { status: 400 });
      await db.update(tasks).set({ status, isBlocked: status === "blocked", completedAt: status === "completed" ? now : null, updatedAt: now }).where(and(eq(tasks.userId, userId), eq(tasks.id, id)));
      return Response.json({ id, status, updatedAt: now });
    }

    if (body.action === "create_inbox") {
      const content = cleanText(payload.content, 2000);
      if (!content) return Response.json({ error: "Escribe o dicta una actualización." }, { status: 400 });
      const lowered = content.toLocaleLowerCase("es");
      const detected = ["lyn", "erm", "charlo", "santi", "brant", "malajunta", "arrendamientos", "banivado", "mashiramo", "contenido"].find((id) => lowered.includes(id === "lyn" ? "lyn" : id));
      const inbox = { id: crypto.randomUUID(), userId, content, inputType: cleanText(payload.inputType, 20) || "text", detectedProjectId: detected ?? null, classification: /urgente|error|incidencia/.test(lowered) ? "Posible incidencia · revisar" : "Actualización · revisar", status: "unprocessed", createdAt: now };
      await db.insert(inboxItems).values(inbox);
      return Response.json({ inbox }, { status: 201 });
    }

    if (body.action === "suggestion_status") {
      const id = cleanId(payload.id);
      const status = cleanText(payload.status, 20);
      if (!id || !["approved", "rejected", "edited"].includes(status)) return Response.json({ error: "Decisión inválida." }, { status: 400 });
      await db.update(aiSuggestions).set({ status }).where(and(eq(aiSuggestions.userId, userId), eq(aiSuggestions.id, id)));
      return Response.json({ id, status });
    }

    if (body.action === "approve_calendar") {
      const ids = Array.isArray(payload.ids) ? payload.ids.map(cleanId).filter(Boolean) : [];
      for (const id of ids) await db.update(calendarBlocks).set({ status: "approved" }).where(and(eq(calendarBlocks.userId, userId), eq(calendarBlocks.id, id)));
      return Response.json({ ids, status: "approved" });
    }

    return Response.json({ error: "Acción no soportada." }, { status: 400 });
  } catch (error) {
    console.error("workspace_action_failed", error);
    return Response.json({ error: "No fue posible guardar el cambio." }, { status: 500 });
  }
}
