// Invoiced.app connection config — PSG-422 (read-only connection test only).
// Spun out of planning PSG-420. This is NOT the mirror/webhook build: PLANNING.md
// anticipates an `invoices` mirror table + `/api/webhooks/invoiced`, but neither is
// implemented here. This module only resolves credentials + base URL so a read-only
// `pingInvoiced()` can prove we can reach the account.
//
// SECURITY:
//   * The API key is a secret. It is read from env at call time only — never
//     hard-coded, never logged, never returned to a client. `keySource` exposes the
//     env var *name* that the key resolved from, never the value.
//   * Invoiced REST auth is HTTP Basic with the API key as the USERNAME and an empty
//     password (handled in client.ts).
//   * We start in SANDBOX. The live base URL is only selected when INVOICED_ENV=live
//     is explicitly set in the deployed env (operator decision), mirroring the
//     test-vs-live posture of LOB_API_KEY.

export type InvoicedEnvironment = "sandbox" | "live";

// Invoiced REST base URLs. Sandbox is isolated test data with no billing side effects.
const BASE_URLS: Record<InvoicedEnvironment, string> = {
  sandbox: "https://api.sandbox.invoiced.com",
  live: "https://api.invoiced.com",
};

// The exact Vercel env var name Nick set is not yet confirmed (PSG-422 step 1 —
// the `vercel` CLI is unavailable in the agent env). We resolve the key from an
// ordered list of plausible names so the connection test works regardless of which
// the operator chose, and surface the resolved NAME (never the value) so the
// deployed ping itself confirms the real var name. Update this list / collapse to
// the single confirmed name once `vercel env ls` (or Ada) reports it.
export const KEY_ENV_CANDIDATES = [
  "INVOICED_API_KEY",
  "INVOICED_SANDBOX_API_KEY",
  "INVOICED_SECRET_KEY",
  "INVOICED_KEY",
] as const;

// Opt into live by setting INVOICED_ENV=live in the deployed env. Anything else
// (including unset) stays in sandbox — fail-safe toward the no-spend environment.
const ENV_NAME = "INVOICED_ENV";

export class InvoicedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicedConfigError";
  }
}

export interface InvoicedConfig {
  /** The Invoiced API key (secret — never log or serialize this field). */
  apiKey: string;
  /** REST base URL for the selected environment. */
  baseUrl: string;
  environment: InvoicedEnvironment;
  /** Env var NAME the key resolved from — safe to log/surface; never the value. */
  keySource: string;
}

type EnvLike = Record<string, string | undefined>;

function resolveEnvironment(env: EnvLike): InvoicedEnvironment {
  return (env[ENV_NAME] ?? "").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/**
 * Resolve Invoiced config from the environment.
 * Throws {@link InvoicedConfigError} when no candidate key var is set, so callers
 * (the ping route) can return a clean red result naming the vars they checked
 * rather than leaking an undefined key into an outbound request.
 */
export function loadInvoicedConfig(env: EnvLike = process.env): InvoicedConfig {
  let apiKey: string | undefined;
  let keySource = "";
  for (const name of KEY_ENV_CANDIDATES) {
    const value = env[name]?.trim();
    if (value) {
      apiKey = value;
      keySource = name;
      break;
    }
  }

  if (!apiKey) {
    throw new InvoicedConfigError(
      `No Invoiced API key set. Checked (in order): ${KEY_ENV_CANDIDATES.join(", ")}.`,
    );
  }

  const environment = resolveEnvironment(env);
  return { apiKey, baseUrl: BASE_URLS[environment], environment, keySource };
}
