import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openSqlite, migrate } from "../runtime/sqlite.mjs";
import { validateSnapshot } from "../runtime/transfer-contract.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = process.env.PROJECT_OS_NODE_DIST_DIR === ".next-node-qa" ? ".next-node-qa" : ".next-node";
const directory = await mkdtemp(join(tmpdir(), "project-os-auth-http-"));
const sql = openSqlite(join(directory, "project-os.sqlite")); migrate(sql); sql.close();
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const appOrigin = "https://app.fixture.test"; // HTTPS proxy origin, like Dokploy.
const child = spawn(process.execPath, ["--import", new URL("fixtures/auth-upstream.mjs", import.meta.url).href, join(root, dist, "standalone/server.js")], { cwd: root, env: {
  ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  PROJECT_OS_AUTH_FIXTURE: "synthetic-only", PROJECT_OS_DATA_DIR: directory, PROJECT_OS_BACKEND: "supabase", PROJECT_OS_REQUIRE_EXISTING_WORKSPACE: "true", PROJECT_OS_WORKSPACE_ID: "existing-workspace",
  PROJECT_OS_APP_URL: appOrigin, SUPABASE_URL: "https://supabase.fixture.test", SUPABASE_PUBLISHABLE_KEY: "public-fixture", SUPABASE_SECRET_KEY: "server-fixture", PROJECT_OS_OWNER_EMAIL: "owner@fixture.test", PROJECT_OS_OWNER_ID: "", OPENAI_API_KEY: "", GBRAIN_CLIENT_SECRET: "",
}, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", data => { log += data; }); child.stderr.on("data", data => { log += data; });
const request = (path, init = {}) => fetch(origin + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000) });
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await request("/login")).ok) break; } catch {}
    if (attempt > 300 || child.exitCode !== null) throw new Error("Fixture server failed: " + log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request("/")).headers.get("location"), "/login");
  assert.equal((await request("/deployment")).headers.get("location"), "/login");
  for (const path of ["/api/state", "/api/ai", "/api/github", "/api/repositories?projectId=fixture", "/api/project-shares?projectId=fixture", "/api/project-deliveries?projectId=fixture&deliveryId=fixture", "/api/brain?projectId=fixture", "/api/search?q=fixture", "/api/meetings?id=fixture&file=transcript", "/api/meetings/analyze?id=fixture", "/api/meetings/revise?id=fixture", "/api/projects/update?projectId=fixture", "/api/auth"]) {
    const response = await request(path); assert.equal(response.status, 401, path); assert.ok(response.headers.get("cache-control").includes("no-store"), path);
  }
  for (const path of ["/api/action", "/api/project-shares", "/api/documents", "/api/ai", "/api/brain", "/api/brain/answer", "/api/search", "/api/meetings", "/api/meetings/analyze", "/api/meetings/revise", "/api/projects/update", "/api/deployment/backup"]) {
    const response = await request(path, { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 401, path);
  }
  const post = (body, extra = {}) => request("/api/auth", { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "login", email: "owner@fixture.test", password: "wrong" })).status, 401);
  assert.equal((await post({ action: "login" }, { Origin: "https://attacker.fixture.test" })).status, 403);
  const login = await post({ action: "login", email: "owner@fixture.test", password: "synthetic-password" });
  assert.equal(login.status, 200); const payload = await login.json(); assert.equal(payload.user.email, "owner@fixture.test"); assert.ok(!JSON.stringify(payload).includes("token"));
  const setCookies = login.headers.getSetCookie(); assert.equal(setCookies.length, 2);
  for (const cookie of setCookies) { assert.ok(cookie.toLowerCase().includes("httponly")); assert.ok(cookie.toLowerCase().includes("samesite=strict")); assert.ok(cookie.toLowerCase().includes("secure")); }
  const Cookie = setCookies.map(cookie => cookie.split(";")[0]).join("; ");
  assert.equal((await request("/", { headers: { Cookie } })).status, 200);
  assert.equal((await request("/api/state", { headers: { Cookie } })).status, 200);
  assert.equal((await request("/deployment", { headers: { Cookie } })).status, 200);
  assert.equal((await request("/api/deployment/backup", {method:"POST",headers:{Cookie,Origin:"https://attacker.fixture.test"}})).status,403);
  const backup = await request("/api/deployment/backup",{method:"POST",headers:{Cookie,Origin:appOrigin}});
  assert.equal(backup.status,200); assert.ok(backup.headers.get("content-disposition").includes("attachment"));
  assert.ok(backup.headers.get("cache-control").includes("no-store"));
  await validateSnapshot(await backup.json(),"existing-workspace","https://supabase.fixture.test");
  assert.equal((await request("/api/state", { headers: { Cookie, Origin: "https://attacker.fixture.test" } })).status, 403);
  assert.equal((await post({ action: "refresh" }, { Cookie })).status, 200);
  const logout = await post({ action: "logout" }, { Cookie }); assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0")));
  assert.equal((await request("/api/state")).status, 401);
  console.log("Standalone HTTP passed: all protected API routes, downloads, owner login, cookies, page/data access, CSRF, refresh and logout. Live API calls: 0.");
} finally {
  child.kill("SIGTERM"); if (child.exitCode === null) await once(child, "exit");
  await rm(directory, { recursive: true, force: true });
}
