import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";

const filename = resolve(process.argv[2] ?? "");
const migrationRoot = resolve("supabase/migrations");
const verification = filename === resolve("outputs/core-verification.sql");
if (!verification && (!relative(migrationRoot, filename) || relative(migrationRoot, filename).startsWith("..") || !filename.endsWith(".sql"))) throw new Error("Select a project migration or the bounded rollback-only verification file.");
const query = await readFile(filename, "utf8");
if (!query.trim().startsWith("begin;") || !query.trim().endsWith(verification ? "rollback;" : "commit;")) throw new Error("A transactional migration or rollback-only verification is required.");
process.stdin.setEncoding("utf8");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("Ready for database configuration JSON on stdin (input is hidden).\n");
const config = await new Promise((resolve, reject) => {
  let input = "";
  const receive = (chunk) => { input += chunk; if (input.includes("\u0003")) process.exit(130); if (!/[\r\n]/.test(input)) return; process.stdin.off("data", receive); if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); try { resolve(JSON.parse(input.trim())); } catch { reject(new Error("Invalid configuration")); } };
  process.stdin.on("data", receive); process.stdin.resume();
});
const url = new URL(config.url);
if (url.protocol !== "https:" || url.username || url.password) throw new Error("HTTPS origin required.");
const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
const curlInput = `header = ${JSON.stringify(`Authorization: ${authorization}`)}\nheader = "Content-Type: application/json"\ndata = ${JSON.stringify(JSON.stringify({ query }))}\n`;
const result = await new Promise((resolve, reject) => {
  const child = spawn("curl.exe", ["--disable", "--config", "-", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "45", "--include", "--request", "POST", "--url", new URL("/api/platform/pg-meta/default/query", url).href], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.resume();
  child.on("error", () => reject(new Error("Cannot run HTTPS migration request"))); child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`Migration transport failed (${code})`))); child.stdin.end(curlInput);
});
const boundary = result.indexOf("\r\n\r\n");
const status = Number(result.split("\r\n")[0].split(" ")[1]);
let data; try { data = JSON.parse(result.slice(boundary + 4)); } catch { data = null; }
if (status < 200 || status >= 300 || data?.error) {
  const message = typeof data?.message === "string" ? data.message.replaceAll(config.password, "[redacted]").slice(0, 800) : "No SQL diagnostic returned";
  throw new Error(`Migration failed (${status}): ${message}`);
}
console.log(JSON.stringify(verification ? { verification: "core", status, passed: true, rolledBack: true } : { migration: relative(migrationRoot, filename), status, applied: true }));
