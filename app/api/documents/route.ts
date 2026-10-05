import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { ensureWorkspace, ensureWorkspaceBackend } from "@/db/workspace";
import { knowledgeItems, projects } from "@/db/schema";
import { AuthenticationError, currentUserId } from "@/lib/current-user";
import { and, eq } from "drizzle-orm";
import {
  deleteSupabaseDocument,
  insertSupabaseRow,
  isSupabaseConfigured,
  SUPABASE_TABLES,
  supabaseProjectExists,
  uploadSupabaseDocument,
} from "@/db/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await currentUserId();
    const data = await request.formData();
    const file = data.get("file");
    const projectId = String(data.get("projectId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!(file instanceof File) || !projectId) return Response.json({ error: "Archivo y proyecto son obligatorios." }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return Response.json({ error: "El archivo supera el límite de 25 MB." }, { status: 413 });
    const id = crypto.randomUUID();
    const key = `${userId}/${projectId}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const item = { id, userId, projectId, itemType: "document", title: file.name.slice(0, 180), summary: `${Math.max(1, Math.round(file.size / 1024))} KB · listo para procesamiento`, sourceReference: "Carga directa", storageKey: key, processingStatus: "uploaded", occurredAt: new Date().toISOString() };

    if (isSupabaseConfigured()) {
      await ensureWorkspaceBackend(userId);
      if (!(await supabaseProjectExists(userId, projectId))) return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
      await uploadSupabaseDocument(key, file);
      let savedItem: typeof item;
      try {
        savedItem = await insertSupabaseRow<typeof item>(SUPABASE_TABLES.knowledge, item);
      } catch (error) {
        await deleteSupabaseDocument(key).catch(() => console.error("supabase_document_cleanup_failed"));
        throw error;
      }
      return Response.json({ item: savedItem }, { status: 201 });
    }

    await ensureWorkspace(userId);
    if (!env.BUCKET) throw new Error("R2 BUCKET unavailable");
    const db = getDb();
    const project = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.id, projectId))).limit(1);
    if (!project.length) return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name, projectId } });
    await db.insert(knowledgeItems).values(item);
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    console.error("document_upload_failed", error);
    return Response.json({ error: "No fue posible almacenar el archivo." }, { status: 500 });
  }
}
