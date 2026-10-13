import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["lib/task-copy.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { formatTasksForCopy, copyTaskText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const task = (id, extra = {}) => ({ id, projectId: "p", title: `Tarea ${id}`, description: "", status: "pending", deadline: null, tentativeDeliveryDate: null, isBlocked: false, ...extra });
const state = {
  projects: [{ id: "p", name: "Proyecto de prueba" }],
  tasks: [task("a", { description: "Revisar portada\r\nConfirmar tamaño", deadline: "2026-10-20", tentativeDeliveryDate: "2026-10-18", isBlocked: true, blockingReason: "Falta aprobación" }), task("b"), task("foreign", { projectId: "another", title: "Privado de otro proyecto" })],
  operations: [{ projectId: "p", data: JSON.stringify({ version: 1, people: [{ id: "ana", name: "Ana" }, { id: "luis", name: "Luis" }], taskDetails: { a: { primaryId: "ana", collaboratorIds: ["luis"], plannedStart: "2026-10-15", plannedEnd: "2026-10-19" } }, agreements: [] }) }],
};
const text = formatTasksForCopy(state, "p", ["b", "a", "a", "foreign", "deleted"]);
assert.equal(text, `*Proyecto: Proyecto de prueba*

2 tareas seleccionadas

1. *Tarea a*
   Revisar portada
   Confirmar tamaño
   • Estado: Pendiente
   • Responsable: Ana
   • Colaboradores: Luis
   • Fecha límite: 20/10/2026
   • Entrega tentativa: 18/10/2026
   • Inicio previsto: 15/10/2026
   • Fin previsto: 19/10/2026
   • Bloqueo: Falta aprobación

2. *Tarea b*
   • Estado: Pendiente
   • Responsable: Sin asignar`);
assert.equal(formatTasksForCopy(state, "p", []), "");
assert.equal(formatTasksForCopy(state, "missing", ["a"]), "");
assert.equal(formatTasksForCopy(state, "p", ["deleted", "foreign"]), "");
assert.match(formatTasksForCopy(state, "p", ["b"]), /1 tarea seleccionada\n\n1\. \*Tarea b\*/);
assert.match(formatTasksForCopy({ ...state, operations: [] }, "p", ["a"]), /Responsable: Sin asignar/);
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let copied;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
try {
  assert.equal(await copyTaskText(text), true);
  assert.equal(copied, text);
  assert.equal(await copyTaskText(""), false);
  let removed = false, restored = false, selected = false;
  class Element { focus() { restored = true; } }
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: new Element(), getSelection: () => null, createElement: () => ({ style: {}, focus() {}, select() { selected = true; }, setSelectionRange() {}, remove() { removed = true; } }), body: { appendChild() {} }, execCommand: () => true };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  assert.equal(await copyTaskText(text), true);
  assert.ok(removed && restored && selected);
  globalThis.document.execCommand = () => false;
  assert.equal(await copyTaskText(text), false);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("Permission denied"); } } } });
  assert.equal(await copyTaskText(text), false);
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.HTMLElement;
}
console.log("Task copy checks passed: formatting, project isolation, missing records, clipboard and manual fallback.");
