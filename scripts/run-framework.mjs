import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [requestedCommand, ...args] = process.argv.slice(2);
if (!["dev", "build", "preview"].includes(requestedCommand)) throw new Error("Expected dev, build or preview.");
const localPreview = requestedCommand === "preview";
const command = localPreview ? "dev" : requestedCommand;
const managedLinux = readExecutionProfile() === "managed-linux";
if (localPreview) {
  if (managedLinux) throw new Error("Local preview is only available on a local portable checkout.");
  process.env.PROJECT_OS_LOCAL_PREVIEW = "1";
  process.env.PROJECT_OS_BACKEND = "d1";
  process.env.PROJECT_OS_WORKSPACE_ID = "local_seedy";
}

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
if (localPreview) process.argv.push("--hostname", "127.0.0.1");
await import(cli.href);
