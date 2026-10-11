import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const context = vm.createContext({ crypto, Intl, Date });
const modules = new Map();
async function sourceModule(file) {
  if (modules.has(file)) return modules.get(file);
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const module = new vm.SourceTextModule(outputText, { context });
  modules.set(file, module);
  await module.link(specifier => sourceModule(`../lib/${specifier.split("/").at(-1)}.ts`));
  return module;
}
const coreModule = await sourceModule("../lib/core-commands.ts"), typesModule = await sourceModule("../lib/workspace-types.ts");
await coreModule.evaluate(); await typesModule.evaluate();
const { buildCoreCommand, CoreValidationError } = coreModule.namespace;
const { emptyWorkspace, deriveWorkspaceState } = typesModule.namespace;
let state = emptyWorkspace();
const userId = `core-check-${crypto.randomUUID()}`;
const plans = [];
const tables = { projects: "projects", milestones: "milestones", tasks: "tasks", task_dependencies: "dependencies", project_financials: "financials", project_events: "events" };
const camel = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
function run(action, payload) {
  const plan = buildCoreCommand(state, userId, action, payload, crypto.randomUUID());
  plans.push(plan);
  for (const change of plan.changes) {
    const key = tables[change.table]; const row = camel(change.row);
    state[key] = state[key].filter((item) => item.id !== row.id);
    if (change.kind !== "delete") state[key].push(row);
  }
  state = deriveWorkspaceState(state);
  assert.equal(plan.changes.filter((change) => change.table === "project_events").length, 1);
  assert.ok(plan.changes.every((change) => change.row.user_id === userId));
  return plan.id;
}
const projectId = run("create_project", { name: "Verificación temporal del núcleo", description: "Solo dentro de una transacción revertida", operationalStatus: "Activo" });
const milestoneId = run("create_milestone", { projectId, name: "Entregable verificado", targetDate: "2026-10-30" });
const first = run("create_task", { projectId, milestoneId, title: "Preparar", estimatedMinutes: 45 });
const second = run("create_task", { projectId, milestoneId, title: "Entregar", dependsOnTaskIds: [first] });
const invalid = (action, payload) => assert.throws(() => buildCoreCommand(state, userId, action, payload, crypto.randomUUID()), CoreValidationError);
assert.equal(state.tasks.find((task) => task.id === second).isBlocked, true);
invalid("update_task_status", { id: second, status: "in_progress" });
invalid("update_task", { id: first, dependsOnTaskIds: [second] });
invalid("update_task", { id: first, dependsOnTaskIds: [first] });
invalid("update_milestone", { id: milestoneId, status: "completed" });
invalid("update_project", { id: projectId, operationalStatus: "Finalizado" });
invalid("create_project", { name: "Fecha inválida", targetEndDate: "2026-02-30" });
invalid("create_task", { projectId: "unknown", title: "Sin proyecto" });
invalid("create_task", { projectId, title: "Estimación inválida", estimatedMinutes: -5 });
invalid("update_project", { id: projectId, updatedAt: "2000-01-01T00:00:00Z", name: "Edición desactualizada" });
run("update_financials", { projectId, totalValue: 1000, currency: "COP" });
run("record_payment", { projectId, amount: 400, paymentDate: "2026-10-05", reference: "Comprobante de prueba" });
assert.equal(state.financials[0].amountPaid, 400);
assert.equal(state.financials[0].amountPending, 600);
invalid("record_payment", { projectId, amount: 700 });
invalid("record_payment", { projectId, amount: -1 });
invalid("update_financials", { projectId, totalValue: 300 });
invalid("update_financials", { projectId, currency: "USD" });
run("update_task_status", { id: first, status: "completed" });
assert.equal(state.tasks.find((task) => task.id === second).isBlocked, false);
run("update_task_status", { id: second, status: "completed" });
run("update_milestone", { id: milestoneId, status: "completed" });
run("update_project", { id: projectId, operationalStatus: "Finalizado" });
assert.equal(state.events.length, plans.length);
assert.equal(state.projects[0].operationalStatus, "Finalizado");
if (process.argv.includes("--sql")) {
  const rpc = (changes) => `public.project_os_apply_changes('${userId}', '${JSON.stringify(changes).replaceAll("'", "''")}'::jsonb)`;
  const payment = plans.find((plan) => plan.changes.some((change) => change.row.event_type === "payment"));
  const stale = structuredClone(plans.at(-1).changes);
  stale[0].expected = { updated_at: "2000-01-01T00:00:00Z" };
  stale.at(-1).row.id = crypto.randomUUID();
  const sql = plans.map((plan) => `select ${rpc(plan.changes)};`).join("\n") + `\nselect ${rpc(payment.changes)};\ndo $$ begin\nbegin\nperform ${rpc(stale)};\nraise exception 'Stale update incorrectly accepted';\nexception when unique_violation then null;\nend;\nif exists (select 1 from public.project_events where id = '${stale.at(-1).row.id}') then raise exception 'Rejected event incorrectly persisted'; end if;\nend $$;`;
  // The final ROLLBACK removes the entire fixture, including payments and events.
  console.log(`begin;\n${sql}\ndo $$ begin\nif not exists (select 1 from public.projects where id = '${projectId}' and operational_status = 'Finalizado') then raise exception 'Project assertion failed'; end if;\nif not exists (select 1 from public.project_financials where project_id = '${projectId}' and amount_paid = 400 and amount_pending = 600) then raise exception 'Payment assertion failed'; end if;\nif (select count(*) from public.project_events where user_id = '${userId}') <> ${plans.length} then raise exception 'Timeline assertion failed'; end if;\nend $$;\nrollback;`);
} else console.log("Core checks passed: projects, milestones, task editing, dependency cycles, prerequisite blocking/unblocking, dates, payment balances, project completion and timeline.");
