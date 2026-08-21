/**
 * Single source of truth for QA credentials: apps/psg-hub/.env.test.local
 *
 * Why this module exists (PSG-2928): the preview checks used to read
 * `.env.test.local` AND `.env.preview.local`, with the latter winning. That
 * second file was cross-wired to the `localreach` Supabase project while the
 * deployed preview authenticates against `psg-hub-qa-demo`, so a QA run could
 * silently exercise the wrong backend. Read one file, and prove the URL and the
 * keys belong to the same project before handing anything back.
 *
 * Targets:
 *   local   — unprefixed keys, pointed at the local `supabase start` stack.
 *             e2e/global.setup.ts refuses to seed anything else, so leave it local.
 *   preview — PREVIEW_* keys, pointed at the hosted psg-hub-qa-demo project that
 *             backs the Vercel preview deployments.
 */
import fs from "node:fs";
import path from "node:path";

export const QA_ENV_FILE = ".env.test.local";

const TARGETS = {
  local: { prefix: "", label: "local Supabase stack" },
  preview: { prefix: "PREVIEW_", label: "hosted psg-hub-qa-demo project" },
};

function appDir() {
  return path.resolve(import.meta.dirname, "..");
}

function parseEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/** Project ref for a Supabase URL: https://<ref>.supabase.co → <ref>. Local stacks have none. */
export function projectRefFromUrl(url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url ?? "");
  return match ? match[1] : null;
}

/** Project ref baked into a Supabase JWT (anon / service_role), or null if unreadable. */
export function projectRefFromKey(key) {
  const segment = (key ?? "").split(".")[1];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, "base64").toString("utf8")).ref ?? null;
  } catch {
    return null;
  }
}

/**
 * Fail loudly when a URL and a key come from different Supabase projects. This is
 * the exact footgun that produced the PSG-2928 false alarm; it must never be
 * something a QA run has to notice by eye.
 */
export function assertSameProject(supabaseUrl, keys) {
  const urlRef = projectRefFromUrl(supabaseUrl);
  if (!urlRef) return; // local stack — nothing to cross-check
  for (const [name, value] of Object.entries(keys)) {
    if (!value) continue;
    const keyRef = projectRefFromKey(value);
    if (keyRef && keyRef !== urlRef) {
      throw new Error(
        `Cross-wired QA settings in ${QA_ENV_FILE}: the Supabase URL is project "${urlRef}" ` +
          `but ${name} belongs to project "${keyRef}". Fix the file so both name the same project.`,
      );
    }
  }
}

/**
 * Load QA settings for one target. Throws with the exact key names to add to
 * `.env.test.local` rather than letting a check fail later as a fake "login broken".
 */
export function loadQaEnv(target = "preview") {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unknown QA target "${target}". Use one of: ${Object.keys(TARGETS).join(", ")}.`);

  const file = path.join(appDir(), QA_ENV_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${QA_ENV_FILE} in apps/psg-hub. Copy the QA target block from .env.example ` +
        `and fill it from the shared PSG credential store — see docs/qa/preview-access.md.`,
    );
  }

  const raw = parseEnvFile(file);
  const { prefix } = spec;
  const pick = (name) => raw[`${prefix}${name}`];

  const settings = {
    target,
    label: spec.label,
    baseUrl: (pick("BASE_URL") ?? "").replace(/\/+$/, ""),
    supabaseUrl: pick("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: pick("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: pick("SUPABASE_SERVICE_ROLE_KEY"),
    shopEmail: pick("DEMO_SHOP_EMAIL"),
    shopPassword: pick("DEMO_SHOP_PASSWORD"),
    operatorEmail: pick("DEMO_OPERATOR_EMAIL"),
    operatorPassword: pick("DEMO_OPERATOR_PASSWORD"),
  };

  const missing = ["BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]
    .filter((name) => !pick(name))
    .map((name) => `${prefix}${name}`);
  if (missing.length) {
    throw new Error(
      `Missing required QA setting(s) in ${QA_ENV_FILE} for target "${target}" (${spec.label}): ` +
        `${missing.join(", ")}. See docs/qa/preview-access.md.`,
    );
  }

  assertSameProject(settings.supabaseUrl, {
    [`${prefix}NEXT_PUBLIC_SUPABASE_ANON_KEY`]: settings.supabaseAnonKey,
    [`${prefix}SUPABASE_SERVICE_ROLE_KEY`]: settings.serviceRoleKey,
  });

  return settings;
}
