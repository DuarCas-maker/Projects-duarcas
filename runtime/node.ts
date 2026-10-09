import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { d1Adapter, openSqlite } from "./sqlite.mjs";
import { fileBucket } from "./bucket.mjs";

let database: D1Database | undefined;
let bucket: R2Bucket | undefined;
// This alias is server-only. Read environment at runtime, not at image build.
export const env = new Proxy({} as Cloudflare.Env, {
  get(_target, property: string) {
    const directory = resolve(process.env.PROJECT_OS_DATA_DIR || ".node-runtime");
    if (property === "DB") {
      if (!database) {
        const file = join(directory, "project-os.sqlite");
        if (!existsSync(file)) throw new Error("Initialize the Node runtime before starting the application.");
        database = d1Adapter(openSqlite(file)) as unknown as D1Database;
      }
      return database;
    }
    if (property === "BUCKET") return bucket ??= fileBucket(join(directory, "objects")) as unknown as R2Bucket;
    return process.env[property];
  },
});
