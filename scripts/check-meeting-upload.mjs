import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";

// A repeated React key leaves detached meeting panels behind on tab changes.
// Check direct siblings, not unrelated components in separate tab panels.
const source = await readFile(new URL("../app/project-os.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("project-os.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let meetingInstances = 0;
function inspect(node) {
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const keys = new Set();
    for (const child of node.children) {
      const opening = ts.isJsxElement(child) ? child.openingElement : ts.isJsxSelfClosingElement(child) ? child : null;
      if (!opening) continue;
      if (opening.tagName.getText(tree) === "MeetingResources") meetingInstances++;
      const key = opening.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === "key");
      if (!key?.initializer) continue;
      const expression = key.initializer.getText(tree);
      assert.ok(!keys.has(expression), `Duplicate sibling React key ${expression}; meeting panels must not accumulate`);
      keys.add(expression);
    }
  }
  ts.forEachChild(node, inspect);
}
inspect(tree);
assert.equal(meetingInstances, 1, "Render only one meeting module per project");

// Execute the actual upload/download route with in-memory storage and workspace
// adapters. No user data, live Supabase, GBrain or OpenAI calls are allowed.
const workspace = { projects: [{ id: "project-fixture", userId: "owner-fixture" }], knowledge: [] };
const storage = new Map();
let uploads = 0, indexCalls = 0;
const adapters = {
  async currentWorkspaceId(request) {
    if (request && request.headers.get("origin") !== "https://app.fixture.test") throw Object.assign(new Error("Origin rejected"), { status: 403 });
    return "owner-fixture";
  },
  async getWorkspaceState() { return structuredClone(workspace); },
  async insertSupabaseRow(_table, item) { workspace.knowledge.push(structuredClone(item)); },
  async uploadSupabaseDocument(key, file) { uploads++; storage.set(key, new Uint8Array(await file.arrayBuffer())); },
  async getSupabaseDocumentBytes(key) { return storage.get(key); },
  async indexKnowledge() { indexCalls++; },
};
const stubs = {
  "cloudflare:workers": "export const env = {};",
  "@/db": "export function getDb(){throw Error('Unexpected database adapter')}",
  "@/db/schema": "export const knowledgeItems = {};",
  "@/db/workspace": "export const getWorkspaceState = globalThis.adapters.getWorkspaceState;",
  "@/lib/workspace-context": "export class WorkspaceConfigurationError extends Error{constructor(message,status=503){super(message);this.status=status}};export async function currentWorkspaceId(request){try{return await globalThis.adapters.currentWorkspaceId(request)}catch(error){throw new WorkspaceConfigurationError(error.message,error.status)}}",
  "@/db/supabase": "export const isSupabaseConfigured=()=>true;export const SUPABASE_TABLES={knowledge:'knowledge_items'};export const {insertSupabaseRow,uploadSupabaseDocument,getSupabaseDocumentBytes}=globalThis.adapters;",
  "@/db/knowledge-search": "export const indexKnowledge=globalThis.adapters.indexKnowledge;",
};
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/api/meetings/route.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false, packages: "external",
  plugins: [{ name: "isolated-meeting-adapters", setup(builder) {
    builder.onResolve({ filter: /^(?:cloudflare:workers|@\/)/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});
const context = vm.createContext({ adapters, crypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, FormData, File, Blob, console,
  fetch() { throw Error("Live upstream calls are forbidden"); },
});
const route = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
await route.link(() => { throw Error("Unexpected external dependency"); }); await route.evaluate();
const { POST, GET } = route.namespace;
const id = crypto.randomUUID(), transcript = "[00:01] Reunión ficticia: conservar el texto completo. 🧠", notes = "Notas ficticias en Markdown.";
function form(overrides = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ requestId: id, projectId: "project-fixture", title: "Prueba de carga", date: "2026-10-10", driveUrl: "https://drive.google.com/file/d/fixture_video/view" })) body.set(key, value);
  body.set("transcript", new File([transcript], "transcripcion.md", { type: "text/markdown" }));
  body.set("notes", new File([notes], "notas.txt", { type: "text/plain" }));
  for (const [key, value] of Object.entries(overrides)) value === null ? body.delete(key) : body.set(key, value);
  return body;
}
const post = (body, origin = "https://app.fixture.test") => POST(new Request("https://app.fixture.test/api/meetings", { method: "POST", headers: { Origin: origin }, body }));
assert.equal((await post(form(), "https://unapproved.fixture.test")).status, 403);
assert.equal((await post(form({ projectId: "different-project" }))).status, 404);
assert.equal((await post(form({ transcript: null }))).status, 400);
assert.equal((await post(form({ transcript: new File(["video"], "video.mp4") }))).status, 422);
assert.equal((await post(form({ transcript: new File(["x".repeat(256 * 1024 + 1)], "large.txt") }))).status, 413);
assert.equal(uploads, 0, "Rejected inputs must not write originals");
const saved = await post(form()); assert.equal(saved.status, 201); const result = await saved.json();
assert.equal(result.state.knowledge.length, 1); assert.equal(result.item.projectId, "project-fixture");
assert.equal(uploads, 2); assert.equal(indexCalls, 1);
const replay = await post(form()); assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
assert.equal(workspace.knowledge.length, 1); assert.equal(uploads, 2, "Retry must not duplicate originals");
assert.equal((await post(form({ title: "Changed operation" }))).status, 409);
for (const [role, text] of [["transcript", transcript], ["notes", notes]]) {
  const download = await GET(new Request(`https://app.fixture.test/api/meetings?id=${id}&role=${role}`));
  assert.equal(download.status, 200); assert.equal(await download.text(), text);
  assert.match(download.headers.get("content-disposition"), /attachment/); assert.match(download.headers.get("cache-control"), /no-store/);
}
const transcriptOnly = await post(form({ requestId: crypto.randomUUID(), notes: null, driveUrl: "" }));
assert.equal(transcriptOnly.status, 201); assert.equal(JSON.parse((await transcriptOnly.json()).item.sourceReference.split("project-os-meeting:v1:")[1]).files.length, 1);
assert.equal((await GET(new Request("https://app.fixture.test/api/meetings?id=missing&role=transcript"))).status, 404);
console.log("Meetings passed: one module, unique sibling keys, complete upload/download, optional notes/Drive, retries without duplicates, invalid uploads and origins rejected. Live API calls: 0.");
