import { env } from "cloudflare:workers";
import type { getDemoState } from "@/lib/demo-data";

type JsonRecord = Record<string, unknown>;
type WorkspaceState = ReturnType<typeof getDemoState>;
export type WorkspaceSnapshot = Record<keyof WorkspaceState, JsonRecord[]> & { evidence: JsonRecord[] };

const TABLES = {
  projects: "projects",
  milestones: "milestones",
  tasks: "tasks",
  dependencies: "task_dependencies",
  financials: "project_financials",
  events: "project_events",
  suggestions: "ai_suggestions",
  inbox: "inbox_items",
  calendar: "calendar_blocks",
  knowledge: "knowledge_items",
  repositories: "repositories",
} as const;

function config() {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) throw new Error("Supabase runtime configuration is unavailable");
  if (!url.startsWith("https://")) throw new Error("Supabase must use HTTPS");
  return { url, secret };
}

export function isSupabaseConfigured() {
  return env.PROJECT_OS_BACKEND === "supabase";
}

function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toDatabase(row: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [snakeKey(key), value]));
}

function fromDatabase<T>(row: JsonRecord): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value])) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, secret } = config();
  const response = await fetch(`${url}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    // Do not log upstream response bodies: a proxy can echo request secrets.
    throw new Error(`Supabase request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function tablePath(table: string, params?: URLSearchParams) {
  const query = params?.toString();
  return `/rest/v1/${table}${query ? `?${query}` : ""}`;
}

async function rows<T>(table: string, userId: string, order?: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const params = new URLSearchParams({ select: "*", user_id: `eq.${userId}`, limit: "500", offset: String(offset), order: order ? `${order},id.asc` : "id.asc" });
    const page = await request<JsonRecord[]>(tablePath(table, params));
    result.push(...page.map(fromDatabase<T>));
    if (page.length < 500) return result;
  }
}

async function upsert(table: string, values: JsonRecord[]) {
  if (!values.length) return;
  const params = new URLSearchParams({ on_conflict: "id" });
  await request(tablePath(table, params), {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(values.map(toDatabase)),
  });
}

async function seeded(userId: string) {
  const params = new URLSearchParams({ select: "user_id", user_id: `eq.${userId}`, limit: "1" });
  return (await request<JsonRecord[]>(tablePath("workspace_bootstrap", params))).length > 0;
}

export async function ensureSupabaseWorkspace(userId: string, loadSnapshot: () => Promise<WorkspaceSnapshot>) {
  if (await seeded(userId)) return;
  const snapshot = await loadSnapshot();
  for (const row of snapshot.knowledge) {
    if (typeof row.storageKey !== "string" || !row.storageKey) continue;
    if (!env.BUCKET) throw new Error("R2 is required to migrate existing documents");
    const object = await env.BUCKET.get(row.storageKey);
    if (!object) throw new Error("A source document is unavailable during migration");
    const file = new File([await object.arrayBuffer()], String(row.title ?? "document"), { type: object.httpMetadata?.contentType || "application/octet-stream" });
    await uploadSupabaseDocument(row.storageKey, file, true);
  }
  // The marker is written last. Interrupted migrations can resume without
  // overwriting records already saved in Supabase or removing the D1 source.
  for (const [key, table] of Object.entries(TABLES)) {
    const values = snapshot[key as keyof WorkspaceState];
    for (let offset = 0; offset < values.length; offset += 200) await upsert(table, values.slice(offset, offset + 200));
    if (key === "tasks") await upsert("task_evidence", snapshot.evidence);
  }
  await request(tablePath("workspace_bootstrap"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, seeded_at: new Date().toISOString() }),
  });
}

export async function getSupabaseWorkspaceState(userId: string): Promise<WorkspaceState> {
  const [projects, milestones, tasks, dependencies, financials, events, suggestions, inbox, calendar, knowledge, repositories] = await Promise.all([
    rows<WorkspaceState["projects"][number]>(TABLES.projects, userId, "priority.desc"),
    rows<WorkspaceState["milestones"][number]>(TABLES.milestones, userId),
    rows<WorkspaceState["tasks"][number]>(TABLES.tasks, userId, "priority.desc"),
    rows<WorkspaceState["dependencies"][number]>(TABLES.dependencies, userId),
    rows<WorkspaceState["financials"][number]>(TABLES.financials, userId),
    rows<WorkspaceState["events"][number]>(TABLES.events, userId, "event_date.desc"),
    rows<WorkspaceState["suggestions"][number]>(TABLES.suggestions, userId, "created_at.desc"),
    rows<WorkspaceState["inbox"][number]>(TABLES.inbox, userId, "created_at.desc"),
    rows<WorkspaceState["calendar"][number]>(TABLES.calendar, userId, "starts_at.asc"),
    rows<WorkspaceState["knowledge"][number]>(TABLES.knowledge, userId, "occurred_at.desc"),
    rows<WorkspaceState["repositories"][number]>(TABLES.repositories, userId),
  ]);
  return { projects, milestones, tasks, dependencies, financials, events, suggestions, inbox, calendar, knowledge, repositories };
}

export async function supabaseProjectExists(userId: string, projectId: string) {
  const params = new URLSearchParams({ select: "id", user_id: `eq.${userId}`, id: `eq.${projectId}`, limit: "1" });
  return (await request<JsonRecord[]>(tablePath(TABLES.projects, params))).length > 0;
}

export async function insertSupabaseRow<T>(table: string, row: JsonRecord): Promise<T> {
  const result = await request<JsonRecord[]>(tablePath(table), {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(toDatabase(row)),
  });
  if (!result[0]) throw new Error(`Supabase did not return the inserted ${table} row`);
  return fromDatabase<T>(result[0]);
}

export async function createSupabaseTask<T>(task: JsonRecord): Promise<T> {
  const result = await request<JsonRecord>("/rest/v1/rpc/project_os_create_task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_task: toDatabase(task) }),
  });
  return fromDatabase<T>(result);
}

export async function updateSupabaseRow(table: string, userId: string, id: string, patch: JsonRecord) {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, id: `eq.${id}` });
  const result = await request<JsonRecord[]>(tablePath(table, params), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(toDatabase(patch)),
  });
  if (!result.length) throw new Error(`${table} row not found`);
  return fromDatabase<JsonRecord>(result[0]);
}

export async function uploadSupabaseDocument(key: string, file: File, overwrite = false) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  await request(`/storage/v1/object/project-documents/${encodedKey}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": String(overwrite) },
    body: file,
  });
}

export async function deleteSupabaseDocument(key: string) {
  await request("/storage/v1/object/project-documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [key] }),
  });
}

export const SUPABASE_TABLES = TABLES;
