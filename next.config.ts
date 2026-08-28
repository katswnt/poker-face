import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This repository sits below another package-lock.json. Pinning the root prevents
  // Turbopack from treating the parent directory as part of this application's graph.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
