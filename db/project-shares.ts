import { and, eq } from "drizzle-orm";
import { getDb } from "./index";
import { projectShares } from "./schema";
import { isSupabaseConfigured, getSupabaseShares, getSupabaseShareByHash } from "./supabase";
import { contentHash } from "@/lib/brain-content";
import { CoreValidationError } from "@/lib/core-commands";
import { getWorkspaceState } from "./workspace";
import { operationsFor } from "@/lib/project-operations";
export type ShareRecord = typeof projectShares.$inferSelect;
export function newShareToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function sharesFor(userId: string, projectId: string) {
  return isSupabaseConfigured() ? getSupabaseShares(userId, projectId) : getDb().select().from(projectShares).where(and(eq(projectShares.userId, userId), eq(projectShares.projectId, projectId), eq(projectShares.active, true)));
}
export async function shareContext(token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new CoreValidationError("El enlace no está disponible.", 404);
  const hash = await contentHash(token);
  const share = isSupabaseConfigured() ? await getSupabaseShareByHash(hash) : (await getDb().select().from(projectShares).where(and(eq(projectShares.tokenHash, hash), eq(projectShares.active, true))).limit(1))[0];
  if (!share) throw new CoreValidationError("El enlace fue desactivado o no está disponible.", 404);
  const state = await getWorkspaceState(share.userId, false), data = operationsFor(state, share.projectId);
  const person = data.people.find(p => p.id === share.personId && p.active);
  const project = state.projects.find(p => p.id === share.projectId && p.userId === share.userId);
  if (!person || !project) throw new CoreValidationError("El enlace no está disponible.", 404);
  return { share, state, data, person, project };
}
