// One live request with synthetic meeting data; no workspace records are read.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const env = {};
for (const file of [".env", ".env.local"]) {
  try {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const name of ["OPENAI_API_KEY", "OPENAI_MODEL"]) if (process.env[name]) env[name] = process.env[name];
assert.ok(env.OPENAI_API_KEY, "An existing OpenAI key is required.");
let requests = 0;
const context = vm.createContext({
  crypto, Intl, Date, TextEncoder, TextDecoder, Uint8Array, URL, AbortSignal,
  Response, fixtureEnv: env,
  async fetch(...args) { requests++; return fetch(...args); },
});
const compiled = await build({
  stdin: { contents: 'export * from "../lib/meeting-ai-provider"; export * from "../lib/meeting-analysis";', resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "test-env", setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "env", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const env=globalThis.fixtureEnv;", loader: "js" }));
  } }],
});
const analysisModule = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
await analysisModule.link(() => {}); await analysisModule.evaluate();
const text = `## Reunión ficticia de pruebas · 2026-10-08
Ana: Decidimos lanzar la demostración el 15 de octubre de 2026.
Luis: Me encargaré de preparar el informe de muestras para el 12 de octubre.
Ana: La tarea acordada de Luis es preparar ese informe, duración estimada 45 minutos.
Bea: Mi tarea acordada es diseñar la portada, 30 minutos, para el 13 de octubre.
Carlos: Me comprometo a revisar los cálculos, 60 minutos, para el 14 de octubre.
Diego: Queda como tarea mía enviar la invitación, 15 minutos, para el 10 de octubre.
Elena: Mi tarea acordada es verificar las pruebas, 90 minutos, para el 14 de octubre.
Fabio: Mi tarea es solicitar las muestras, 20 minutos, el 9 de octubre.
Ana: No podemos verificar las pruebas sin recibir las muestras.
Bea: Sigue abierta la pregunta de quién presentará la demostración.
Ana: Estas son las acciones concretas acordadas en esta reunión ficticia.`;
try {
  const output = await analysisModule.namespace.requestMeetingAnalysis(text, {
    title: "Reunión ficticia de validación", date: "2026-10-08", project: "Prueba sintética", part: 2, totalParts: 3, existingTasks: [],
  });
  const result = analysisModule.namespace.validateMeetingPart(output.result, text, 1);
  assert.ok(result.findings.length);
  assert.ok(result.findings.every(finding => text.includes(finding.quote)));
  assert.ok(result.findings.filter(finding => finding.kind === "task").length <= 3);
  console.log(JSON.stringify({ passed: true, model: env.OPENAI_MODEL || "gpt-4.1-mini", findings: result.findings.length, exactEvidenceValidated: true, liveApiCalls: requests, noProjectDataSent: true }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, errorCode: error.code, errorName: error.name, status: error.status, message: error.message, liveApiCalls: requests, noProjectDataSent: true }));
  process.exitCode = 1;
}
