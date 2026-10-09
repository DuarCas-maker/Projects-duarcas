import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// Private fallback for local D1 originals, not a publicly served directory.
// Production originals stay in the existing private Supabase Storage bucket.
export function fileBucket(directory) {
  const paths = key => {
    if (typeof key !== "string" || !key || key.length > 4096) throw new Error("Invalid object key");
    const hash = createHash("sha256").update(key).digest("hex");
    return { body: join(directory, hash), meta: join(directory, `${hash}.json`) };
  };
  return {
    async get(key) {
      const path = paths(key);
      let bytes, metadata;
      try { [bytes, metadata] = await Promise.all([readFile(path.body), readFile(path.meta, "utf8")]); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const saved = JSON.parse(metadata);
      return { size: bytes.byteLength, body: new Response(bytes).body, httpMetadata: saved.httpMetadata, customMetadata: saved.customMetadata, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
    },
    async put(key, input, metadata = {}) {
      const path = paths(key);
      await mkdir(directory, { recursive: true });
      const bytes = new Uint8Array(await new Response(input).arrayBuffer());
      if (bytes.byteLength > 26 * 1024 * 1024) throw new Error("Object exceeds the local storage limit");
      const temp = `${path.body}.${randomUUID()}.tmp`;
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path.body);
      await writeFile(path.meta, JSON.stringify(metadata), { mode: 0o600 });
    },
    async delete(key) { const path = paths(key); await Promise.all([rm(path.body, { force: true }), rm(path.meta, { force: true })]); },
  };
}
