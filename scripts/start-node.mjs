import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { openSqlite, migrate } from "../runtime/sqlite.mjs";
import { requireAuxiliaryImport } from "../runtime/import-auxiliary.mjs";
import { initializeNamesOnly } from "../runtime/names-only.mjs";

// Fail before listening: no anonymous mode, no demo import into production.
for (const key of ["SUPABASE_URL", "PROJECT_OS_APP_URL", "PROJECT_OS_OWNER_EMAIL", "PROJECT_OS_WORKSPACE_ID"])
  if (!process.env[key]?.trim()) throw new Error(`Missing runtime setting: ${key}`);
if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) throw new Error("Missing Supabase public Auth key");
if (process.env.PROJECT_OS_BACKEND !== "supabase" || !process.env.SUPABASE_SECRET_KEY) throw new Error("Docker requires the existing Supabase backend and its server-only secret");
process.env.PROJECT_OS_REQUIRE_EXISTING_WORKSPACE = "true";
const directory = resolve(process.env.PROJECT_OS_DATA_DIR || ".node-runtime");
process.env.PROJECT_OS_DATA_DIR = directory;
const sql = openSqlite(join(directory, "project-os.sqlite"));
try {
  migrate(sql);
  const mode = process.env.PROJECT_OS_INITIALIZATION_MODE || "preserve-history";
  if (mode === "names-only") {
    console.log(JSON.stringify(await initializeNamesOnly(sql, process.env)));
  } else if (mode === "preserve-history") {
    if (process.env.PROJECT_OS_REQUIRE_AUXILIARY_IMPORT === "true") requireAuxiliaryImport(sql, process.env.PROJECT_OS_WORKSPACE_ID);
  } else throw new Error("Unknown workspace initialization mode");
} finally { sql.close(); }
const root = fileURLToPath(new URL("../", import.meta.url));
const server = existsSync(join(root, "server.js")) ? join(root, "server.js") : join(root, ".next-node/standalone/server.js");
if (!existsSync(server)) throw new Error("Build with npm run build:docker first");
const child = spawn(process.execPath, [server], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Unable to start the application"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
