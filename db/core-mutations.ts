import { env } from "cloudflare:workers";
import { isSupabaseConfigured, applySupabaseChanges } from "./supabase";
import { buildCoreCommand, CoreValidationError, type CoreChange } from "@/lib/core-commands";
import { getWorkspaceState } from "./workspace";
import { DAILY_ACTIONS, buildDailyCommand } from "@/lib/daily-commands";

function statement(change: CoreChange, userId: string) {
  if (!env.DB) throw new Error("D1 unavailable");
  const allowed = new Set(["projects", "milestones", "tasks", "task_dependencies", "project_financials", "project_events", "inbox_items", "ai_suggestions", "calendar_blocks"]);
  if (!allowed.has(change.table) || change.row.user_id !== userId) throw new Error("Invalid mutation target");
  const keys = Object.keys(change.row);
  if (keys.some((key) => !/^[a-z_]+$/.test(key))) throw new Error("Invalid mutation column");
  const value = (item: unknown) => typeof item === "boolean" ? Number(item) : item as string | number | null;
  if (change.kind === "delete") return env.DB.prepare(`DELETE FROM ${change.table} WHERE id = ? AND user_id = ?`).bind(change.row.id, userId);
  if (change.kind === "insert") return env.DB.prepare(`INSERT INTO ${change.table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((key) => value(change.row[key])));
  const editable = keys.filter((key) => !["id", "user_id"].includes(key));
  return env.DB.prepare(`UPDATE ${change.table} SET ${editable.map((key) => `${key} = ?`).join(", ")} WHERE id = ? AND user_id = ?`).bind(...editable.map((key) => value(change.row[key])), change.row.id, userId);
}

export async function persistCorePlan(userId: string, plan: { id: string; changes: CoreChange[] }) {
  let savedId = plan.id;
  if (isSupabaseConfigured()) {
    const result = await applySupabaseChanges(userId, plan.changes);
    if (result.replayed && result.id) savedId = result.id;
  } else {
    if (!env.DB) throw new Error("D1 unavailable");
    const guards = plan.changes.filter((change) => change.expected).map((change) => {
      // Force an error inside the same atomic batch if the snapshot is stale.
      statement(change, userId); // Reuse the target/column allowlist checks.
      const expected = Object.entries(change.expected!);
      if (expected.some(([key]) => !/^[a-z_]+$/.test(key))) throw new Error("Invalid guard");
      return env.DB!.prepare(`SELECT json(CASE WHEN EXISTS (SELECT 1 FROM ${change.table} WHERE id = ? AND user_id = ? AND ${expected.map(([key]) => `${key} IS ?`).join(" AND ")}) THEN 'true' ELSE 'conflict' END)`).bind(change.row.id, userId, ...expected.map(([, value]) => typeof value === "boolean" ? Number(value) : value as string | number | null));
    });
    try { await env.DB.batch([...guards, ...plan.changes.map((change) => statement(change, userId))]); }
    catch (error) { if (String(error).includes("malformed JSON")) throw new CoreValidationError("El registro cambió. Recarga antes de volver a intentarlo.", 409); throw error; }
  }
  const saved = await getWorkspaceState(userId);
  return { state: saved, id: savedId, replayed: false, project: saved.projects.find((row) => row.id === savedId), task: saved.tasks.find((row) => row.id === savedId), milestone: saved.milestones.find((row) => row.id === savedId), inbox: saved.inbox.find((row) => row.id === savedId) };
}

export async function executeCoreCommand(userId: string, action: string, payload: Record<string, unknown>, commandId: string) {
  if (typeof commandId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(commandId)) throw new CoreValidationError("Identificador de operación no válido.");
  const state = await getWorkspaceState(userId);
  const existing = state.events.find((event) => event.id === commandId);
  if (existing) return { state, id: existing.sourceId, replayed: true };
  if (action === "create_inbox" && state.inbox.some((item) => item.id === commandId)) return { state, id: commandId, replayed: true };
  const build = DAILY_ACTIONS.has(action) ? buildDailyCommand : buildCoreCommand;
  const plan = build(state, userId, action, payload, commandId);
  return persistCorePlan(userId, plan);
}
