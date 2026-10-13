// Shared isolated fixtures for server checks and browser QA. No credentials or real services.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import vm from 'node:vm';
import { openSqlite, d1Adapter } from '../runtime/sqlite.mjs';

export async function createNotebookFixture() {
  const sql = openSqlite(':memory:');
  sql.exec(await readFile(new URL('../drizzle/0001_empty_blade.sql', import.meta.url), 'utf8'));
  const userId = 'notebook-owner', origin = 'https://notebook.fixture.test';
  const fixtureEnv = { DB: d1Adapter(sql), OPENAI_API_KEY: 'synthetic-fixture-key', PROJECT_OS_AI_CONTEXT_ENABLED: 'true' };
  const fixture = { sql, userId, origin, fixtureEnv, denied: 0, providerStatus: 200, requests: 0, voiceRequests: 0, outputs: [], lastBody: null, contextIds: [], raw: null };
  let state = { projects: [], tasks: [], milestones: [], dependencies: [], financials: [], events: [], suggestions: [], inbox: [], calendar: [], knowledge: [], repositories: [], operations: [] };
  const tables = { projects: 'projects', tasks: 'tasks', milestones: 'milestones', task_dependencies: 'dependencies', project_financials: 'financials', project_events: 'events', ai_suggestions: 'suggestions', inbox_items: 'inbox', project_operations: 'operations' };
  const camel = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
  fixture.apply = plan => {
    const next = structuredClone(state);
    for (const c of plan.changes) {
      assert.ok(tables[c.table], `Unexpected mutation table ${c.table}`);
      const row = camel(c.row), prior = next[tables[c.table]].find(r => r.id === row.id);
      if (c.expected) assert.deepEqual(Object.fromEntries(Object.keys(camel(c.expected)).map(k => [k, prior?.[k]])), camel(c.expected), 'Stale mutation');
      if (c.kind === 'insert') assert.equal(prior, undefined, 'Duplicate row');
      next[tables[c.table]] = next[tables[c.table]].filter(r => r.id !== row.id);
      if (c.kind !== 'delete') next[tables[c.table]].push(row);
    }
    state = next;
    return { id: plan.id, state: structuredClone(state) };
  };
  const adapters = {
    async currentWorkspaceId(request) { if (fixture.denied) throw Object.assign(new Error('Owner required'), { status: fixture.denied }); if (request && request.headers.get('origin') !== origin) throw Object.assign(new Error('Origin rejected'), { status: 403 }); return userId; },
    async getWorkspaceState() { return structuredClone(state); },
    async persistCorePlan(owner, plan) { assert.equal(owner, userId); return fixture.apply(plan); },
    async recallMemory(owner, ids) { assert.equal(owner, userId); fixture.contextIds = ids; return { status: 'connected', hits: [] }; },
    async knowledgeText(owner, item) { assert.equal(owner, userId); assert.equal(item.userId, userId); return 'Documento sintético con criterios de revisión. ' + item.summary; },
  };
  const stubs = {
    'cloudflare:workers': 'export const env=globalThis.fixtureEnv;',
    '@/db': "export function getDb(){throw Error('Unexpected operational database')}",
    '@/db/schema': 'export const knowledgeItems={};',
    '@/db/workspace': 'export const getWorkspaceState=globalThis.adapters.getWorkspaceState;',
    '@/db/core-mutations': 'export const persistCorePlan=globalThis.adapters.persistCorePlan;',
    '@/db/supabase': 'export class SupabaseConflictError extends Error{};',
    '@/lib/brain-provider': 'export const {recallMemory,knowledgeText}=globalThis.adapters;',
    '@/lib/workspace-context': 'export class WorkspaceConfigurationError extends Error{constructor(message,status=503){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return await globalThis.adapters.currentWorkspaceId(request)}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}',
  };
  const compiled = await build({ stdin: { contents: 'import * as notebook from "../app/api/notebook/route";import * as voice from "../app/api/notebook/voice/route";export {notebook,voice};export * from "../lib/notebook";export * from "../lib/notebook-audio";export * from "../lib/notebook-context";export * from "../lib/core-commands";export * from "../lib/daily-commands";export * from "../db/notebook";export * from "../db/ai-history";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false, plugins: [{ name: 'notebook-fixtures', setup(builder) { builder.onResolve({ filter: /^(?:cloudflare:workers|@\/)/ }, args => args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' })); } }] });
  const context = vm.createContext({ fixtureEnv, adapters, crypto, TextEncoder, TextDecoder, Uint8Array, Float32Array, ArrayBuffer, DataView, URL, Request, Response, FormData, File, Blob, AbortSignal, Intl, Date, console, async fetch(url, options) {
    if (url === 'https://api.openai.com/v1/audio/transcriptions') { fixture.voiceRequests++; assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe'); if (fixture.providerStatus !== 200) return Response.json({ error: { code: 'synthetic' } }, { status: fixture.providerStatus }); return Response.json({ text: 'Alfa:\nPreparar una propuesta para revisión.' }); }
    assert.equal(url, 'https://api.openai.com/v1/responses', 'Only mocked provider calls permitted'); fixture.requests++; fixture.lastBody = JSON.parse(options.body);
    assert.equal(fixture.lastBody.store, false); assert.equal(fixture.lastBody.text.format.strict, true);
    if (fixture.providerStatus !== 200) return Response.json({ error: { code: 'synthetic' } }, { status: fixture.providerStatus });
    const output = fixture.outputs.shift() ?? (JSON.parse(fixture.lastBody.input[1].content).rounds.length ? fixture.ready() : fixture.questions());
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  const module = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
  await module.link(async specifier => { const exports = await import(specifier); return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context }); });
  await module.evaluate(); fixture.api = module.namespace;
  let number = 0;
  fixture.core = (action, payload) => fixture.apply(fixture.api.buildCoreCommand(state, userId, action, payload, crypto.randomUUID(), new Date().toISOString(), () => `synthetic-${++number}`));
  fixture.core('create_project', { name: 'Alfa', shortCode: 'ALF', description: 'Diseño de una propuesta', operationalStatus: 'Activo', currentSummary: 'Pendiente de revisión' });
  fixture.core('create_project', { name: 'Beta', shortCode: 'BET', description: 'Preparación de una entrega', operationalStatus: 'Activo' });
  fixture.alfa = state.projects[0].id; fixture.beta = state.projects[1].id;
  fixture.existingTask = fixture.core('create_task', { projectId: fixture.beta, title: 'Revisar la entrega', description: 'Revisión sintética', estimatedMinutes: 30 }).id;
  fixture.milestone = fixture.core('create_milestone', { projectId: fixture.beta, name: 'Primera entrega' }).id;
  const changes = data => Object.entries(data).map(([field, value]) => ({ field, value: value === null ? null : String(value) }));
  fixture.questions = () => ({ summary: 'Identifiqué dos secciones. Confirmemos los detalles antes de preparar los cambios.', questions: [{ id: 'detail', text: '¿Qué resultado y duración tendrá la propuesta de Alfa?', options: { A: 'Documento revisado; duración de 45 minutos.', B: 'Presentación con ejemplos; duración de 90 minutos.', C: 'Solo un borrador; duración de 30 minutos.' } }], proposals: [] });
  fixture.ready = () => ({ summary: 'Preparé las tareas, decisiones y cambios de cada proyecto. Revisa antes de enviar a Aprobaciones.', questions: [], proposals: [
    { projectId: fixture.alfa, action: 'create_task', targetId: null, title: 'Preparar la propuesta', reason: 'Solicitado en la nota', quote: 'Preparar una propuesta', changes: changes({ title: 'Preparar la propuesta', description: 'Preparar el documento del alcance', priority: 3, urgency: 3, estimatedMinutes: 45, criteria: 'Documento revisado' }) },
    { projectId: fixture.beta, action: 'update_task', targetId: fixture.existingTask, title: 'Ajustar la duración de revisión', reason: 'Nueva estimación', quote: 'Revisar la entrega', changes: changes({ estimatedMinutes: 60 }) },
    { projectId: fixture.beta, action: 'update_milestone', targetId: fixture.milestone, title: 'Ajustar primera entrega', reason: 'Nuevo plazo solicitado', quote: 'Mover la primera entrega', changes: changes({ targetDate: '2026-11-01' }) },
    { projectId: fixture.beta, action: 'update_project', targetId: fixture.beta, title: 'Actualizar próximos pasos', reason: 'Nueva etapa del proyecto', quote: 'Actualizar próximos pasos', changes: changes({ nextStepSummary: 'Revisar la entrega con el cliente', targetEndDate: '2026-11-10' }) },
    { projectId: fixture.alfa, action: 'record_decision', targetId: null, title: 'Registrar revisión acordada', reason: 'Decisión escrita en la nota', quote: 'Decidimos revisar con el cliente', changes: changes({ description: 'Revisaremos la propuesta con el cliente antes de entregar.' }) },
  ] });
  fixture.state = () => structuredClone(state);
  fixture.note = 'Alfa:\nPreparar una propuesta. Decidimos revisar con el cliente.\n\nBeta:\nRevisar la entrega. Mover la primera entrega. Actualizar próximos pasos.';
  fixture.age = () => {
    // Preserve round order while moving request timestamps outside the rate window.
    const rows = sql.prepare('SELECT id FROM ai_runs ORDER BY created_at,id').all();
    rows.forEach((row, index) => sql.prepare('UPDATE ai_runs SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), row.id));
  };
  fixture.post = (body, selectedOrigin = origin) => fixture.api.notebook.POST(new Request(`${origin}/api/notebook`, { method: 'POST', headers: { origin: selectedOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  fixture.voice = (file, requestId = crypto.randomUUID(), selectedOrigin = origin) => { const form = new FormData(); form.set('requestId', requestId); form.set('audio', file); return fixture.api.voice.POST(new Request(`${origin}/api/notebook/voice`, { method: 'POST', headers: { origin: selectedOrigin }, body: form })); };
  fixture.raw = context;
  return fixture;
}
