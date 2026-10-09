import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// Explicit portable target; Sites builds do not generate a second Node bundle.
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "build", "--webpack"], {
  stdio: "inherit", env: { ...process.env, PROJECT_OS_BUILD_TARGET: "node", NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
