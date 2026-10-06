import assert from "node:assert/strict";

// Deliberately restricted to the independent local development workspace.
const origin = "http://127.0.0.1:3001";
const name = "Verificación del núcleo · local";
const initial = await fetch(`${origin}/api/state`).then((response) => response.json());
const fixture = initial.projects.find((project) => project.name === name);
assert.ok(fixture, "Create the named local fixture before running this check.");
assert.equal(fixture.userId, "local_seedy");
assert.equal(initial.tasks.filter((task) => task.projectId === fixture.id).length, 0, "The fixture must be unused.");
const projectId = fixture.id;
let state = initial;
const eventIds = [];
async function command(action, payload, expectedStatus = 200, commandId = crypto.randomUUID()) {
  const response = await fetch(`${origin}/api/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, commandId }) });
  const result = await response.json();
  if (expectedStatus >= 400) { assert.equal(response.status, expectedStatus, result.error); return result; }
  assert.ok(response.ok, `${response.status}: ${result.error}`);
  assert.ok(result.state, "The confirmed response must contain the saved state.");
  state = result.state;
  if (!eventIds.includes(commandId)) eventIds.push(commandId);
  return result;
}
const milestoneId = (await command("create_milestone", { projectId, name: "Primer entregable verificado", description: "Prueba local de persistencia", targetDate: "2026-10-30" })).id;
const first = (await command("create_task", { projectId, milestoneId, title: "Preparar el entregable", estimatedMinutes: 45 })).id;
const second = (await command("create_task", { projectId, milestoneId, title: "Entregar y verificar", dependsOnTaskIds: [first] })).id;
assert.equal(state.tasks.find((task) => task.id === second).isBlocked, true);
await command("update_task_status", { id: second, status: "completed" }, 409);
await command("update_task", { id: first, dependsOnTaskIds: [second] }, 400);
await command("update_milestone", { id: milestoneId, status: "completed" }, 409);
await command("update_project", { id: projectId, updatedAt: "2000-01-01T00:00:00Z", name: "Desactualizado" }, 409);
await command("update_task", { id: first, description: "Criterio: resultado revisado", priority: 4, deadline: "2026-10-15" });
await command("update_project", { id: projectId, operationalStatus: "Activo", currentSummary: "Guardado y recarga verificados", nextStepSummary: "Completar el entregable" });
await command("update_financials", { projectId, totalValue: 1000000, currency: "COP", paymentStructure: "40% anticipo · 60% entrega", notes: "Valores ficticios de prueba local" });
const paymentCommand = crypto.randomUUID();
await command("record_payment", { projectId, amount: 400000, paymentDate: "2026-10-05", reference: "Prueba local — no es una transferencia" }, 200, paymentCommand);
const repeated = await command("record_payment", { projectId, amount: 400000 }, 200, paymentCommand);
assert.equal(repeated.replayed, true);
assert.equal(state.financials.find((row) => row.projectId === projectId).amountPaid, 400000);
assert.equal(state.financials.find((row) => row.projectId === projectId).amountPending, 600000);
await command("record_payment", { projectId, amount: 700000 }, 400);
await command("update_task_status", { id: first, status: "completed" });
assert.equal(state.tasks.find((task) => task.id === second).isBlocked, false);
await command("update_task_status", { id: second, status: "completed" });
await command("update_milestone", { id: milestoneId, status: "completed" });
await command("update_project", { id: projectId, operationalStatus: "Finalizado" });
await command("update_project", { id: projectId, operationalStatus: "Archivado", nextStepSummary: "Verificación terminada; este proyecto solo contiene datos de prueba locales" });
const reloaded = await fetch(`${origin}/api/state`).then((response) => response.json());
assert.equal(reloaded.projects.find((project) => project.id === projectId).operationalStatus, "Archivado");
assert.equal(reloaded.tasks.filter((task) => task.projectId === projectId && task.status === "completed").length, 2);
assert.equal(reloaded.events.filter((event) => event.projectId === projectId && event.eventType === "payment").length, 1);
assert.ok(eventIds.every((id) => reloaded.events.some((event) => event.id === id)));
assert.deepEqual(reloaded.financials.find((row) => row.projectId === projectId), state.financials.find((row) => row.projectId === projectId));
assert.equal(reloaded.projects.filter((project) => project.id !== projectId).length, initial.projects.length - 1);
console.log(JSON.stringify({ passed: true, projectId, commands: eventIds.length, duplicatePaymentPrevented: true, persistenceVerified: true, fixtureArchived: true, productionDataTouched: false }));
