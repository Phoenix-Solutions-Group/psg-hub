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
  // Phase 11 (GA4 + GSC): the Google client libs are Node-only — @google-analytics/*
  // pull google-gax -> @grpc/grpc-js (native HTTP/2), and googleapis is REST-but-Node.
  // Keep them OUT of the bundler so it never tries to bundle the native packages
  // (missing-.node / http2 / dns errors otherwise). Routes that construct these
  // clients also declare `export const runtime = "nodejs"`.
  serverExternalPackages: [
    "@google-analytics/data",
    "@google-analytics/admin",
    "google-gax",
    "@grpc/grpc-js",
    "googleapis",
  ],
};

export default nextConfig;
