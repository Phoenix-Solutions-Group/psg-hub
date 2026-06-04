import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Pin the Turbopack/workspace root to the monorepo root (apps/psg/) so Next
// stops inferring it from the stray ~/package-lock.json. Resolved relative to
// this file: apps/psg/apps/psg-hub/ -> ../../ -> apps/psg/.
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
