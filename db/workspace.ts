import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { canClaimLegacyWorkspace } from "@/lib/workspace-context";
import { deriveWorkspaceState } from "@/lib/workspace-types";
import { getDb } from "./index";
import * as schema from "./schema";
import { ensureSupabaseWorkspace, getSupabaseWorkspaceState, isSupabaseConfigured, type WorkspaceSnapshot } from "./supabase";
import {
  DEMO_CALENDAR,
  DEMO_DEPENDENCIES,
  DEMO_EVENTS,
  DEMO_FINANCIALS,
  DEMO_INBOX,
  DEMO_KNOWLEDGE,
  DEMO_MILESTONES,
  DEMO_PROJECTS,
  DEMO_REPOSITORIES,
  DEMO_SUGGESTIONS,
  DEMO_TASKS,
  NOW_ISO,
} from "@/lib/demo-data";

export async function ensureWorkspace(userId: string) {
  const db = getDb();
  // Older releases could bootstrap the personal workspace under this reserved
  // development identity. Only the server-configured workspace may claim it.
  if (userId !== "local-owner" && await canClaimLegacyWorkspace(userId)) {
    const legacy = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.userId, "local-owner")).limit(1);
    if (legacy.length && env.DB) {
      const tables = ["projects", "milestones", "tasks", "task_dependencies", "task_evidence", "project_financials", "project_events", "ai_suggestions", "inbox_items", "calendar_blocks", "knowledge_items", "repositories"];
      await env.DB.batch(tables.map((table) => env.DB!.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).bind(userId, "local-owner")));
    }
  }
  const existing = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.userId, userId));
  if (existing.length >= DEMO_PROJECTS.length) return db;

  // D1 limits bound parameters per statement. Seed rows individually so this
  // remains portable and idempotent if two first-load requests overlap.
  for (const row of DEMO_PROJECTS) await db.insert(schema.projects).values({ ...row, userId, createdAt: NOW_ISO, updatedAt: NOW_ISO }).onConflictDoNothing();
  for (const row of DEMO_MILESTONES) await db.insert(schema.milestones).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_TASKS) await db.insert(schema.tasks).values({ ...row, userId, createdAt: NOW_ISO, updatedAt: NOW_ISO }).onConflictDoNothing();
  for (const row of DEMO_DEPENDENCIES) await db.insert(schema.taskDependencies).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_FINANCIALS) await db.insert(schema.projectFinancials).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_EVENTS) await db.insert(schema.projectEvents).values({ ...row, userId, createdAt: row.eventDate }).onConflictDoNothing();
  for (const row of DEMO_SUGGESTIONS) await db.insert(schema.aiSuggestions).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_INBOX) await db.insert(schema.inboxItems).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_CALENDAR) await db.insert(schema.calendarBlocks).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_KNOWLEDGE) await db.insert(schema.knowledgeItems).values({ ...row, userId }).onConflictDoNothing();
  for (const row of DEMO_REPOSITORIES) await db.insert(schema.repositories).values({ ...row, userId }).onConflictDoNothing();
  return db;
}

export async function getD1WorkspaceState(userId: string) {
  const db = await ensureWorkspace(userId);
  const [projects, milestones, tasks, dependencies, financials, events, suggestions, inbox, calendar, knowledge, repositories] = await Promise.all([
    db.select().from(schema.projects).where(eq(schema.projects.userId, userId)).orderBy(desc(schema.projects.priority)),
    db.select().from(schema.milestones).where(eq(schema.milestones.userId, userId)),
    db.select().from(schema.tasks).where(eq(schema.tasks.userId, userId)).orderBy(desc(schema.tasks.priority)),
    db.select().from(schema.taskDependencies).where(eq(schema.taskDependencies.userId, userId)),
    db.select().from(schema.projectFinancials).where(eq(schema.projectFinancials.userId, userId)),
    db.select().from(schema.projectEvents).where(eq(schema.projectEvents.userId, userId)).orderBy(desc(schema.projectEvents.eventDate)),
    db.select().from(schema.aiSuggestions).where(eq(schema.aiSuggestions.userId, userId)).orderBy(desc(schema.aiSuggestions.createdAt)),
    db.select().from(schema.inboxItems).where(eq(schema.inboxItems.userId, userId)).orderBy(desc(schema.inboxItems.createdAt)),
    db.select().from(schema.calendarBlocks).where(eq(schema.calendarBlocks.userId, userId)).orderBy(schema.calendarBlocks.startsAt),
    db.select().from(schema.knowledgeItems).where(eq(schema.knowledgeItems.userId, userId)).orderBy(desc(schema.knowledgeItems.occurredAt)),
    db.select().from(schema.repositories).where(eq(schema.repositories.userId, userId)),
  ]);
  return { projects, milestones, tasks, dependencies, financials, events, suggestions, inbox, calendar, knowledge, repositories };
}

export async function ensureWorkspaceBackend(userId: string) {
  if (!isSupabaseConfigured()) {
    await ensureWorkspace(userId);
    return;
  }
  await ensureSupabaseWorkspace(userId, async () => {
    const state = await getD1WorkspaceState(userId);
    const evidence = await getDb().select().from(schema.taskEvidence).where(eq(schema.taskEvidence.userId, userId));
    return { ...state, evidence } as WorkspaceSnapshot;
  });
}

export async function getWorkspaceState(userId: string) {
  if (!isSupabaseConfigured()) return deriveWorkspaceState(await getD1WorkspaceState(userId));
  await ensureWorkspaceBackend(userId);
  return deriveWorkspaceState(await getSupabaseWorkspaceState(userId));
}

export function owned(userId: string, column: typeof schema.tasks.userId, idColumn: typeof schema.tasks.id, id: string) {
  return and(eq(column, userId), eq(idColumn, id));
}
