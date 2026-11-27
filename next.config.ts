import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Package the standalone runtime on Linux for the final VPS deployment.
  output: process.platform === "linux" ? "standalone" : undefined,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
