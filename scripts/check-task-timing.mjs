import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { openSqlite, migrate } from "../runtime/sqlite.mjs";

// Pure task/date/approval logic and real SQLite schema. No network or AI calls.
const compiled = await build({ stdin: { contents: 'export * from "./lib/task-timing"; export * from "./lib/core-commands"; export * from "./lib/daily-commands"; export * from "./lib/daily-engine"; export * from "./lib/workspace-types"; export * from "./lib/meetings";', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "node" });
const module = new vm.SourceTextModule(compiled.outputFiles[0].text, { context: vm.createContext({ crypto, Date, Intl, URL }) });
await module.link(() => {}); await module.evaluate();
const api = module.namespace, userId = "timing-fixture", projectId = "timing-project";
let state = api.emptyWorkspace();
const tables = { projects: "projects", tasks: "tasks", project_events: "events", ai_suggestions: "suggestions" };
function apply(plan) {
  for (const change of plan.changes) {
    const key = tables[change.table];
    const row = Object.fromEntries(Object.entries(change.row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
    state[key] = state[key].filter(item => item.id !== row.id).concat(row);
  }
  return plan.id;
}
const command = (action, payload, now = "2026-10-10T18:00:00Z") => api.buildCoreCommand(state, userId, action, payload, crypto.randomUUID(), now);
apply(command("create_project", { name: "Fecha de reunión ficticia", operationalStatus: "Activo" }));
state.projects[0].id = projectId;
const fingerprint = "a".repeat(64);
function meeting(id, date, owner = userId, project = projectId) {
  return { id, userId: owner, projectId: project, itemType: "meeting", title: `Reunión ficticia ${id} · archivo 2030`, occurredAt: "2030-01-01T00:00:00Z", sourceReference: api.MEETING_PREFIX + JSON.stringify({ version: 1, date, driveUrl: "", fingerprint, files: [{ role: "transcript", name: "archivo-2030.txt", key: `${owner}/${project}/${id}-${fingerprint}-transcript.txt`, size: 100, hash: "b".repeat(64), type: "text/plain" }] }) };
}
state.knowledge.push(meeting("original", "2026-09-28"), meeting("newer", "2026-10-09"), meeting("other-user", "2026-09-01", "other"), meeting("other-project", "2026-09-01", userId, "another"));
const taskId = apply(command("create_task", { projectId, title: "Tarea ficticia", originMeetingId: "original" }));
let task = state.tasks[0];
assert.equal(api.taskTiming(state, task, new Date("2026-10-10T04:59:59Z")).days, 11);
assert.equal(api.taskTiming(state, task, new Date("2026-10-10T05:00:00Z")).days, 12);
assert.equal(api.taskTiming(state, task, new Date("2026-10-10T18:00:00Z")).label, "Hace 12 días");
assert.equal(api.taskMeeting(state, task).item.id, "original"); // not newer, upload, filename
const initialRank = api.rankTask(task, state, "2026-10-10");
apply(command("update_task", { id: taskId, tentativeDeliveryDate: "2026-09-01" }));
task = state.tasks[0];
assert.equal(task.deadline, null); assert.equal(task.tentativeDeliveryDate, "2026-09-01");
assert.equal(api.rankTask(task, state, "2026-10-10").score, initialRank.score);
assert.equal(api.rankTask(task, state, "2026-10-10").reason, initialRank.reason);
apply(command("update_task_status", { id: taskId, status: "completed" }, "2026-10-03T04:59:59Z"));
task = state.tasks[0];
assert.equal(api.taskTiming(state, task, new Date("2030-01-01T12:00:00Z")).days, 4);
assert.equal(api.taskTiming(state, task, new Date("2030-01-01T12:00:00Z")).label, "Completada en 4 días");
const completedAt = task.completedAt;
apply(command("update_task", { id: taskId, tentativeDeliveryDate: "" }));
assert.equal(state.tasks[0].completedAt, completedAt); assert.equal(state.tasks[0].tentativeDeliveryDate, null);
apply(command("update_task_status", { id: taskId, status: "pending" }));
assert.equal(api.taskTiming(state, state.tasks[0], new Date("2026-10-10T18:00:00Z")).days, 12);
for (const payload of [{ originMeetingId: "newer" }, { originMeetingId: "" }, { tentativeDeliveryDate: "2026-02-30" }]) assert.throws(() => command("update_task", { id: taskId, ...payload }), api.CoreValidationError);
for (const originMeetingId of ["other-user", "other-project", "unknown"]) assert.throws(() => command("create_task", { projectId, title: "Out of scope", originMeetingId }), api.CoreValidationError);
const manualId = apply(command("create_task", { projectId, title: "Manual sin origen" }));
const manual = state.tasks.find(task => task.id === manualId);
assert.equal(api.taskTiming(state, manual).label, "Sin reunión vinculada");
apply(command("update_task", { id: manualId, originMeetingId: "original" }));
assert.equal(api.taskMeeting(state, state.tasks.find(task => task.id === manualId)).item.id, "original");
assert.equal(api.taskTiming(state, { ...manual, originMeetingId: "newer" }, new Date("2026-10-09T12:00:00Z")).days, 0);
assert.equal(api.taskTiming(state, { ...manual, originMeetingId: "newer" }, new Date("2026-10-08T12:00:00Z")).label, "Reunión en 1 día");
assert.equal(api.taskTiming(state, { ...manual, originMeetingId: "original", status: "completed", completedAt: null }).days, null);
assert.equal(api.calendarDate("2024-02-29"), true); assert.equal(api.calendarDate("2026-02-29"), false);
assert.equal(api.displayCalendarDate("2026-09-28"), "28/09/2026");

// A persisted legacy approval is sufficient to recover the original meeting.
const proposalId = apply(api.buildDailyCommand(state, userId, "create_task_suggestion", { projectId, title: "Desde propuesta", tentativeDeliveryDate: "2026-11-01" }, crypto.randomUUID()));
let proposal = state.suggestions.find(item => item.id === proposalId);
proposal.payload = JSON.stringify({ ...JSON.parse(proposal.payload), meetingId: "original", meetingFingerprint: fingerprint });
const count = state.tasks.length;
apply(api.buildDailyCommand(state, userId, "edit_suggestion", { id: proposalId, tentativeDeliveryDate: "2026-11-02" }, crypto.randomUUID()));
assert.equal(state.tasks.length, count); assert.equal(state.suggestions.find(item => item.id === proposalId).status, "pending");
const approve = api.buildDailyCommand(state, userId, "suggestion_status", { id: proposalId, status: "approved" }, crypto.randomUUID());
const createdTaskId = approve.changes.find(change => change.table === "tasks").row.id;
apply(approve);
const approved = state.tasks.find(item => item.id === createdTaskId);
assert.equal(approved.originMeetingId, "original"); assert.equal(approved.tentativeDeliveryDate, "2026-11-02");
const legacy = { ...approved, originMeetingId: undefined };
assert.equal(api.taskMeeting(state, legacy).item.id, "original");
const wrongOwner = { ...legacy, userId: "another" }; assert.equal(api.taskMeeting(state, wrongOwner), null);
const wrongProject = { ...legacy, projectId: "another" }; assert.equal(api.taskMeeting(state, wrongProject), null);
state.suggestions.find(item => item.id === proposalId).payload = JSON.stringify({ ...JSON.parse(state.suggestions.find(item => item.id === proposalId).payload), meetingFingerprint: "c".repeat(64) });
assert.equal(api.taskMeeting(state, legacy), null);
const clearingId = apply(api.buildDailyCommand(state, userId, "create_task_suggestion", { projectId, title: "Vacía opcional", tentativeDeliveryDate: "2026-11-01" }, crypto.randomUUID()));
apply(api.buildDailyCommand(state, userId, "edit_suggestion", { id: clearingId, tentativeDeliveryDate: "" }, crypto.randomUUID()));
assert.equal(JSON.parse(state.suggestions.find(item => item.id === clearingId).payload).data.tentativeDeliveryDate, null);
assert.throws(() => api.buildDailyCommand(state, userId, "edit_suggestion", { id: clearingId, tentativeDeliveryDate: "2026-13-01" }, crypto.randomUUID()), api.CoreValidationError);

// Test the additive migration against existing records, then a persisted plan.
const sql = openSqlite(":memory:");
try {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries.slice(0, -1)) sql.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  sql.prepare("INSERT INTO projects(id,user_id,name,short_code,project_type,operational_status,commercial_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(projectId, userId, "Prueba", "P", "Por alcance", "Activo", "Sin definir", "now", "now");
  sql.prepare("INSERT INTO tasks(id,user_id,project_id,title,deadline,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("old-task", userId, projectId, "Old", "2026-11-01", "now", "now");
  sql.exec(await readFile(`drizzle/${journal.entries.at(-1).tag}.sql`, "utf8"));
  const row = sql.prepare("SELECT deadline,tentative_delivery_date,origin_meeting_id FROM tasks WHERE id='old-task'").get();
  assert.equal(row.deadline, "2026-11-01"); assert.equal(row.tentative_delivery_date, null); assert.equal(row.origin_meeting_id, null);
  const fresh = openSqlite(":memory:"); migrate(fresh); migrate(fresh); fresh.close();
  const columns = sql.prepare("PRAGMA table_info(tasks)").all().map(item => item.name);
  assert.ok(columns.includes("tentative_delivery_date") && columns.includes("origin_meeting_id"));
} finally { sql.close(); }
console.log(JSON.stringify({ passed: true, authoritativeOriginalMeeting: true, bogotaCalendarDays: true, completedCounterFrozen: true, noInventedLegacyAge: true, tentativeNoRankingEffect: true, editAndClear: true, approvalOnlyCreatesTask: true, additiveMigrationPreservesRows: true, liveApiCalls: 0 }));
