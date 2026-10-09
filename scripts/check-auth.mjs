import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
// Synthetic fixtures only: no live Supabase or paid AI requests.
const env = { SUPABASE_URL: "https://supabase.fixture.test", SUPABASE_PUBLISHABLE_KEY: "public-fixture", PROJECT_OS_APP_URL: "https://app.fixture.test", PROJECT_OS_OWNER_EMAIL: "owner@fixture.test", PROJECT_OS_WORKSPACE_ID: "existing-workspace" };
const values = new Map(), written = new Map();
const jar = { get: key => values.has(key) ? { value: values.get(key) } : undefined, set(key, value, options) { written.set(key, options); if (options.maxAge === 0) values.delete(key); else values.set(key, value); } };
let requestHeaders = new Headers(), calls = [], upstreamStatus = 200;
let user = { id: "12345678-1234-1234-1234-123456789012", email: "owner@fixture.test", email_confirmed_at: "2026-01-01", is_anonymous: false };
const context = vm.createContext({ Response, Request, Headers, URL, AbortSignal, TextDecoder, Uint8Array, console, fixtureEnv: env, fixtureCookies: jar, fixtureHeaders: () => requestHeaders,
  async fetch(url, init) {
    calls.push({ url, init });
    if (upstreamStatus !== 200) return Response.json({ error: "upstream-private-message" }, { status: upstreamStatus });
    if (url.includes("/token?")) return Response.json({ access_token: "access-fixture", refresh_token: "refresh-fixture", expires_in: 3600, user: { email: "untrusted@fixture.test" } });
    if (url.includes("/logout?")) return new Response(null, { status: 204 });
    return Response.json(user);
  },
});
const compiled = await build({ stdin: { contents: 'export * from "../lib/supabase-auth";export * from "../lib/auth-policy";export * from "../lib/workspace-context";', resolveDir: fileURLToPath(new URL(".", import.meta.url)) }, bundle: true, format: "esm", platform: "node", write: false, plugins: [{ name: "auth-fixtures", setup(builder) {
  builder.onResolve({ filter: /^(cloudflare:workers|next\/headers)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "cloudflare:workers" ? "export const env=globalThis.fixtureEnv" : "export async function cookies(){return globalThis.fixtureCookies} export async function headers(){return globalThis.fixtureHeaders()}" }));
} }] });
const module = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
await module.link(() => {}); await module.evaluate(); const api = module.namespace;
await assert.rejects(api.currentWorkspaceId(), error => error.status === 401); assert.equal(calls.length, 0);
values.set("project_os_access", "untrusted-cookie"); upstreamStatus = 401;
await assert.rejects(api.requireOwner(), error => error.status === 401 && !error.message.includes("private"));
upstreamStatus = 200; user.email = "other@fixture.test"; await assert.rejects(api.currentWorkspaceId(), error => error.status === 403);
user.email = env.PROJECT_OS_OWNER_EMAIL; user.email_confirmed_at = null; await assert.rejects(api.requireOwner());
user.email_confirmed_at = "2026-01-01"; user.is_anonymous = true; await assert.rejects(api.requireOwner()); user.is_anonymous = false;
assert.equal(await api.currentWorkspaceId(), "existing-workspace");
assert.equal(await api.canClaimLegacyWorkspace("user-selected-workspace"), false);
assert.ok(calls.at(-1).url.endsWith("/auth/v1/user")); assert.equal(calls.at(-1).init.redirect, "manual");
assert.equal(calls.at(-1).init.headers.apikey, "public-fixture");
env.PROJECT_OS_OWNER_ID = "87654321-1234-1234-1234-123456789012"; await assert.rejects(api.requireOwner()); delete env.PROJECT_OS_OWNER_ID;
requestHeaders.set("origin", "https://attacker.fixture.test"); await assert.rejects(api.requireOwner(), error => error.status === 403); requestHeaders = new Headers();
const request = (body, origin = env.PROJECT_OS_APP_URL) => new Request(`${env.PROJECT_OS_APP_URL}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
await assert.rejects(api.authOperation(request({ action: "login" }, "https://attacker.fixture.test")), error => error.status === 403);
await assert.rejects(api.authOperation(request({ action: "login" }, "")), error => error.status === 403);
await assert.rejects(api.authOperation(request(null)), error => error.status === 400);
await assert.rejects(api.authOperation(request({ action: "login", password: "x".repeat(9000) })), error => error.status === 413);
await assert.rejects(api.authOperation(request({ action: "login", email: "other@fixture.test", password: "fixture" })), error => error.status === 401);
const owner = await api.authOperation(request({ action: "login", email: env.PROJECT_OS_OWNER_EMAIL, password: "fixture" }));
assert.deepEqual(JSON.parse(JSON.stringify(owner)), { id: user.id, email: user.email });
assert.equal(values.get("project_os_access"), "access-fixture");
for (const option of written.values()) { assert.equal(option.httpOnly, true); assert.equal(option.secure, true); assert.equal(option.sameSite, "strict"); assert.equal(option.path, "/"); }
await api.authOperation(request({ action: "refresh" })); assert.ok(calls.some(call => call.url.endsWith("grant_type=refresh_token")));
upstreamStatus = 503; await assert.rejects(api.requireOwner(), error => error.status === 503);
await api.authOperation(request({ action: "logout" })); assert.equal(values.size, 0);
delete env.SUPABASE_PUBLISHABLE_KEY; await assert.rejects(api.currentWorkspaceId(), error => error.status === 503);
console.log("Auth passed: verified owner-only access, existing workspace, HttpOnly cookies, refresh/logout, CSRF and fail-closed outages.");
