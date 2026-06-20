import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no new dependency). The returned values are injected into
 * the webServer process so BOTH `next build` (which inlines NEXT_PUBLIC_* into
 * the client bundle) and `next start` point at the LOCAL Supabase stack. Next's
 * @next/env never overrides a variable already present in process.env, so the
 * prod `.env.local` can never leak into the E2E build — the target is local-only.
 */
function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const testEnv = loadEnv(path.join(__dirname, ".env.test.local"));

// Also expose the local target to the Playwright runner process itself, so
// global.setup.ts (service-role seed) and the local-only guard see the same
// LOCAL stack. Local values win — this is the zero-PII guarantee.
Object.assign(process.env, testEnv);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // shared local DB — keep deterministic
  // In CI add the github reporter so test failures emit ::error:: annotations
  // visible via the public check-runs API (agents have no raw-log access).
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // Port 3100 (not the Next default 3000) to avoid a local squatter on 3000.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    // Seeds fixtures (service role) + produces a storageState per role via real
    // UI login. The chromium project depends on it.
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /global\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Build + start with the LOCAL env injected. reuseExistingServer is false so a
  // stray prod-pointed dev server can never be the E2E target (zero-PII guarantee).
  webServer: {
    command: "pnpm build && pnpm start -p 3100",
    url: "http://localhost:3100/login",
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...process.env, ...testEnv } as Record<string, string>,
  },
});
