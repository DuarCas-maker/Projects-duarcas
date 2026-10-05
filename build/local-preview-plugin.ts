import type { Plugin } from "vite";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// This middleware runs only in the Vite development server, never in the
// published Worker. Anonymous preview remains limited to this computer.
export function localPreview(enabled: boolean): Plugin {
  return {
    name: "project-os-local-preview",
    enforce: "pre",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        let origin: URL;
        try {
          origin = new URL(`http://${request.headers.host}`);
        } catch {
          response.statusCode = 403;
          response.end("Local preview only");
          return;
        }
        if (
          !localHosts.has(origin.hostname.replace(/^\[|\]$/g, "")) ||
          !localAddresses.has(request.socket.remoteAddress ?? "") ||
          (request.headers.origin && request.headers.origin !== origin.origin) ||
          request.headers["sec-fetch-site"] === "cross-site"
        ) {
          response.statusCode = 403;
          response.end("Local preview only");
          return;
        }

        next();
      });
    },
  };
}
