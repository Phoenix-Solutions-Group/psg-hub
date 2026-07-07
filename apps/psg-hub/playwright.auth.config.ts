import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Isolated E2E config for the BSM sign-up / login happy-path suite (PSG-791).
 *
 * This runs ONLY e2e/auth-happy-paths.spec.ts and is intentionally separate from
 * the main playwright.config.ts so it:
 *   - does NOT pull in the heavy global.setup.ts fixture seed (mega shops,
 *     analytics snapshots, production ladder) — the auth spec seeds the one
 *     account it needs itself, via the service-role client,
 *   - does NOT depend on the Lob TEST key that the production happy path needs,
 *   - can be driven in BOTH e-mail-confirmation modes by the CI matrix via the
 *     E2E_CONFIRM_MODE env var (the workflow toggles enable_confirmations in
 *     supabase/config.toml before `supabase start` and passes the mode here).
 *
 * Same LOCAL-only env loading + zero-PII guarantee as the main config: values in
 * .env.test.local point BOTH `next build` (which inlines NEXT_PUBLIC_*) and
 * `next start` at the throwaway local Supabase stack. Next's @next/env never
 * overrides an already-present process.env var, so prod .env.local can't leak in.
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
Object.assign(process.env, testEnv);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /auth-happy-paths\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // shared local DB — keep deterministic
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    // Every test here drives auth from a clean, unauthenticated context.
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start -p 3100",
    url: "http://localhost:3100/login",
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...process.env, ...testEnv } as Record<string, string>,
  },
});
