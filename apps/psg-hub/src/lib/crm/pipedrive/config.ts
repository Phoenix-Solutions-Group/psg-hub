import "server-only";

// PSG-423 — Pipedrive connection (read-only). Typed, env-based config loader.
// Mirrors the env-config style of src/lib/billing/stripe-mirror.ts / src/lib/mail
// (no secrets in code, no logging of secret values, fail-loud on missing env).
//
// Pipedrive personal-token auth: the `api_token` is passed as a QUERY PARAM against
//   https://{companyDomain}.pipedrive.com/api/v1
// so we need both the TOKEN and the COMPANY DOMAIN (subdomain).
//
// ── On the exact Vercel env var names (PSG-423 step 1) ──────────────────────────
// The CEO (Nick) added the Pipedrive credentials to Vercel (project psg-digital/
// psg-hub) but the EXACT var names were not confirmed and must not be assumed. This
// loader therefore reads the FIRST non-empty value from a small candidate list for
// each of token + domain, with the documented canonical name first. The companion
// ping route additionally reports which `PIPEDRIVE_*` keys are actually present in
// the deployed env (NAMES ONLY, never values) so the real names can be confirmed
// at runtime without Vercel CLI access. Once confirmed, the canonical names below
// are authoritative; the aliases are a tolerance band, not a contract.

/** Canonical (documented) env var names — see .env.example / INTEGRATIONS.md. */
export const PIPEDRIVE_TOKEN_ENV = "PIPEDRIVE_API_TOKEN";
export const PIPEDRIVE_DOMAIN_ENV = "PIPEDRIVE_COMPANY_DOMAIN";

/** Accepted aliases, tried in order after the canonical name. */
const TOKEN_ENV_CANDIDATES = [
  PIPEDRIVE_TOKEN_ENV,
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
] as const;

const DOMAIN_ENV_CANDIDATES = [
  PIPEDRIVE_DOMAIN_ENV,
  "PIPEDRIVE_DOMAIN",
  "PIPEDRIVE_COMPANY",
  "PIPEDRIVE_SUBDOMAIN",
] as const;

export type PipedriveConfig = {
  /** Personal API token (secret — never log or echo). */
  apiToken: string;
  /** Normalized company subdomain, e.g. "acme" for acme.pipedrive.com. */
  companyDomain: string;
  /** Fully-qualified API base, e.g. "https://acme.pipedrive.com/api/v1". */
  baseUrl: string;
};

/**
 * Thrown when required config is absent. Carries the candidate names that were
 * checked (NOT any value) so the caller can surface a precise, secret-free message.
 */
export class PipedriveConfigError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `Missing Pipedrive config: set one of [${missing.join(
        ", ",
      )}] (token and/or company domain) in the environment`,
    );
    this.name = "PipedriveConfigError";
    this.missing = missing;
  }
}

/** First non-empty (trimmed) env value among `names`, else null. */
function firstEnv(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): string | null {
  for (const name of names) {
    const raw = env[name];
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  }
  return null;
}

/**
 * Normalize a configured company domain to the bare subdomain. Accepts any of:
 *   "acme", "acme.pipedrive.com", "https://acme.pipedrive.com", "acme.pipedrive.com/"
 * and returns "acme". Returns null if nothing usable remains.
 */
export function normalizeCompanyDomain(value: string): string | null {
  let v = value.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, ""); // strip protocol
  v = v.replace(/\/.*$/, ""); // strip path / trailing slash
  v = v.replace(/\.pipedrive\.com$/, ""); // strip the public host suffix
  v = v.replace(/^\.+|\.+$/g, ""); // strip stray dots
  return v === "" ? null : v;
}

/**
 * Load Pipedrive config from the environment. Pure (env injectable for tests).
 * Throws PipedriveConfigError listing the candidate names when token or domain is
 * absent. Never logs or includes the token value in any message.
 */
export function loadPipedriveConfig(
  env: NodeJS.ProcessEnv = process.env,
): PipedriveConfig {
  const apiToken = firstEnv(TOKEN_ENV_CANDIDATES, env);
  const rawDomain = firstEnv(DOMAIN_ENV_CANDIDATES, env);
  const companyDomain = rawDomain ? normalizeCompanyDomain(rawDomain) : null;

  const missing: string[] = [];
  if (!apiToken) missing.push(...TOKEN_ENV_CANDIDATES);
  if (!companyDomain) missing.push(...DOMAIN_ENV_CANDIDATES);
  if (!apiToken || !companyDomain) {
    throw new PipedriveConfigError(missing);
  }

  return {
    apiToken,
    companyDomain,
    baseUrl: `https://${companyDomain}.pipedrive.com/api/v1`,
  };
}

/**
 * Names of every `PIPEDRIVE_*` env var that is actually present in the deployed
 * environment — NAMES ONLY, never values. Used by the ping route to confirm the
 * exact var name(s) the operator configured, without Vercel CLI access.
 */
export function presentPipedriveEnvKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.keys(env)
    .filter((k) => k.toUpperCase().includes("PIPEDRIVE"))
    .sort();
}
