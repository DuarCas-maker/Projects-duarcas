import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { openSqlite, migrate } from "../runtime/sqlite.mjs";

// Fail before listening: no anonymous mode, no demo import into production.
for (const key of ["SUPABASE_URL", "PROJECT_OS_APP_URL", "PROJECT_OS_OWNER_EMAIL", "PROJECT_OS_WORKSPACE_ID"])
  if (!process.env[key]?.trim()) throw new Error(`Missing runtime setting: ${key}`);
if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) throw new Error("Missing Supabase public Auth key");
if (process.env.PROJECT_OS_BACKEND !== "supabase" || !process.env.SUPABASE_SECRET_KEY) throw new Error("Docker requires the existing Supabase backend and its server-only secret");
process.env.PROJECT_OS_REQUIRE_EXISTING_WORKSPACE = "true";
const directory = resolve(process.env.PROJECT_OS_DATA_DIR || ".node-runtime");
process.env.PROJECT_OS_DATA_DIR = directory;
const sql = openSqlite(join(directory, "project-os.sqlite"));
try { migrate(sql); } finally { sql.close(); }
const root = fileURLToPath(new URL("../", import.meta.url));
const server = existsSync(join(root, "server.js")) ? join(root, "server.js") : join(root, ".next-node/standalone/server.js");
if (!existsSync(server)) throw new Error("Build with npm run build:docker first");
const child = spawn(process.execPath, [server], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Unable to start the application"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
