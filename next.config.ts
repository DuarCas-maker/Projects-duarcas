import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Keep Node production artifacts separate from the existing Vinext preview.
  distDir: process.env.PROJECT_OS_BUILD_TARGET === "node" ? ".next-node" : undefined,
  output: process.env.PROJECT_OS_BUILD_TARGET === "node" ? "standalone" : undefined,
  poweredByHeader: false,
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, (resource: { request: string }) => {
      resource.request = path.resolve(process.cwd(), "runtime/node.ts");
    }));
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};

export default nextConfig;
