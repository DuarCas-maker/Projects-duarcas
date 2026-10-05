import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../db/supabase.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

async function backend(env, fetch) {
  const context = vm.createContext({ fetch, URLSearchParams, AbortSignal, File });
  const module = new vm.SourceTextModule(outputText, { context });
  const binding = new vm.SyntheticModule(["env"], function () { this.setExport("env", env); }, { context });
  await module.link((specifier) => {
    assert.equal(specifier, "cloudflare:workers");
    return binding;
  });
  await module.evaluate();
  return module.namespace;
}

const runtime = { PROJECT_OS_BACKEND: "supabase", SUPABASE_URL: "https://supabase.example.test", SUPABASE_SECRET_KEY: "sb_secret_test_only" };
let calls = [];
const service = await backend(runtime, async (url, init) => {
  calls.push({ url, init });
  assert.equal(init.headers.apikey, runtime.SUPABASE_SECRET_KEY);
  assert.equal(init.redirect, "error");
  const parsed = new URL(url);
  if (parsed.pathname === "/rest/v1/projects") {
    assert.equal(parsed.searchParams.get("user_id"), "eq.owner-1");
    const offset = Number(parsed.searchParams.get("offset") ?? 0);
    return Response.json(Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({ id: `project-${offset + index}`, user_id: "owner-1", short_code: "TEST" })));
  }
  if (parsed.pathname === "/rest/v1/rpc/project_os_create_task") {
    const { p_task } = JSON.parse(init.body);
    assert.equal(p_task.user_id, "owner-1");
    assert.equal(p_task.project_id, "project-1");
    return Response.json(p_task);
  }
  return Response.json([]);
});

const state = await service.getSupabaseWorkspaceState("owner-1");
assert.equal(state.projects.length, 501, "records beyond the API page size must not be lost");
assert.equal(state.projects[0].shortCode, "TEST");
assert.equal(state.projects[0].userId, "owner-1");
const created = await service.createSupabaseTask({ id: "task-1", userId: "owner-1", projectId: "project-1", isBlocked: false });
assert.equal(created.projectId, "project-1");
assert.equal(created.isBlocked, false);

const insecure = await backend({ ...runtime, SUPABASE_URL: "http://supabase.example.test" }, () => { throw new Error("credentials were sent over HTTP"); });
await assert.rejects(insecure.supabaseProjectExists("owner-1", "project-1"), /HTTPS/);
const missing = await backend({ PROJECT_OS_BACKEND: "supabase" }, () => { throw new Error("unexpected request"); });
await assert.rejects(missing.supabaseProjectExists("owner-1", "project-1"), /configuration/);
const inactive = await backend({ ...runtime, PROJECT_OS_BACKEND: "d1" }, () => { throw new Error("unexpected request"); });
assert.equal(inactive.isSupabaseConfigured(), false);

const snapshot = Object.fromEntries(["projects", "milestones", "tasks", "dependencies", "financials", "events", "suggestions", "inbox", "calendar", "knowledge", "repositories", "evidence"].map((key) => [key, []]));
snapshot.projects.push({ id: "project-1", userId: "owner-1", name: "Existing edited project" });
snapshot.tasks.push({ id: "task-1", userId: "owner-1", projectId: "project-1", title: "Existing task", status: "completed" });
snapshot.evidence.push({ id: "evidence-1", userId: "owner-1", taskId: "task-1" });
const migrationCalls = [];
const migration = await backend(runtime, async (url, init) => {
  const table = new URL(url).pathname.split("/").at(-1);
  migrationCalls.push({ table, init });
  if (!init.method) return Response.json([]);
  return new Response(null, { status: 204 });
});
await migration.ensureSupabaseWorkspace("owner-1", async () => snapshot);
assert.equal(migrationCalls.at(-1).table, "workspace_bootstrap");
assert.equal(migrationCalls.at(-1).init.method, "POST", "completion marker must be persisted last");
assert.deepEqual(migrationCalls.filter(({ init }) => init.method === "POST").map(({ table }) => table), ["projects", "tasks", "task_evidence", "workspace_bootstrap"]);
assert.equal(JSON.parse(migrationCalls.find(({ table }) => table === "tasks").init.body)[0].status, "completed");

let loaded = false;
const initialized = await backend(runtime, async () => Response.json([{ user_id: "owner-1" }]));
await initialized.ensureSupabaseWorkspace("owner-1", async () => { loaded = true; return snapshot; });
assert.equal(loaded, false, "completed migrations must not replay source data");

const denied = await backend(runtime, async () => new Response("upstream body containing credentials", { status: 401 }));
await assert.rejects(denied.supabaseProjectExists("owner-1", "project-1"), /^Error: Supabase request failed \(401\)$/);
console.log("Supabase checks passed: HTTPS, ownership filters, pagination, field mapping, atomic task RPC, migration preservation and error handling.");
