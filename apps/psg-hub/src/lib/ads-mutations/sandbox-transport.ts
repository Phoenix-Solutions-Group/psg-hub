import "server-only";
import type { JobSpec, SandboxRunResult, SandboxTransport } from "./bridge";

/**
 * v1.2 Ads Mutation Studio — live Vercel Sandbox transport.
 *
 * Provisions an ephemeral Vercel Sandbox, installs the shipped
 * `apps/psg-ads-mutations/` Python package, and invokes `runner.py` once for the given
 * JobSpec. The runner prints its sentinel-framed JSON result to stdout, which the bridge
 * parses.
 *
 * SECRETS: Google Ads / GTM OAuth credentials are forwarded as sandbox ENV (never argv),
 * read from the deployment's process.env. They are operator-provisioned (PSG-26c infra /
 * PSG-98 live keys) — absent them the runner fails closed with a missing-env error.
 *
 * GATED: this module is only imported by `VercelSandboxBridge.getTransport()` when
 * `isSandboxEnabled()` is true, so `@vercel/sandbox` is a runtime-only dependency. The
 * import specifier is held in a variable so the bundler/typechecker does not try to
 * resolve the (deploy-time-only) package during `next build` or unit tests.
 *
 * PSG-118: `Sandbox.create(...)` failed in prod with the SDK's generic
 * "Status code 400 is not ok" (the real HTTP response body was swallowed). This module
 * now (a) forwards explicit Vercel auth (VERCEL_TOKEN/TEAM/PROJECT) when present so the
 * operator's scoped token actually reaches the SDK rather than relying solely on OIDC,
 * (b) pins the `python3.13` runtime so `pip`/`python` exist (the default `node22` image
 * has neither — a latent next-failure), (c) clamps `timeout` to the SDK's accepted bound,
 * and (d) wraps `create` so the actual 400 response body is surfaced into the thrown
 * error (and thus persisted on `python_worker_jobs.error`) for definitive diagnosis.
 */

/** Env vars forwarded into the sandbox so the Python clients can authenticate. */
const FORWARDED_ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_USE_PROTO_PLUS",
  "GTM_REFRESH_TOKEN",
] as const;

/**
 * @vercel/sandbox accepts a sandbox lifetime up to 45 minutes. A value above that is
 * rejected by the API (a candidate cause of the PSG-118 400). Clamp defensively so a
 * mis-set env var degrades to a valid request instead of a swallowed 400.
 */
const SANDBOX_MAX_TIMEOUT_MS = 45 * 60 * 1000; // 2_700_000
const SANDBOX_MIN_TIMEOUT_MS = 1_000;
const SANDBOX_DEFAULT_TIMEOUT_MS = 600_000; // 10 min — ample for pip install + one runner.

function forwardedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of FORWARDED_ENV_KEYS) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

/** Clamp the configured sandbox timeout to the SDK-accepted window. */
export function resolveSandboxTimeoutMs(
  raw: string | undefined,
  fallback = SANDBOX_DEFAULT_TIMEOUT_MS
): number {
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(SANDBOX_MAX_TIMEOUT_MS, Math.max(SANDBOX_MIN_TIMEOUT_MS, Math.round(base)));
}

/** Options handed to `Sandbox.create`. `unknown`-typed at the call site (no SDK types in tree). */
export interface SandboxCreateOptions {
  source: { type: "git"; url: string; revision: string };
  runtime: string;
  timeout: number;
  token?: string;
  teamId?: string;
  projectId?: string;
}

/**
 * Assemble the `Sandbox.create` payload from env. Auth is forwarded explicitly only when a
 * `VERCEL_TOKEN` is present; otherwise the fields are omitted and the SDK falls back to its
 * OIDC auto-auth. `teamId`/`projectId` ride along when set (VERCEL_PROJECT_ID is auto-set in
 * Vercel deployments) so a token-based request is fully scoped.
 */
export function buildCreateOptions(
  env: Record<string, string | undefined>,
  repoUrl: string
): SandboxCreateOptions {
  const opts: SandboxCreateOptions = {
    source: {
      type: "git",
      url: repoUrl,
      revision: env.ADS_MUTATIONS_REPO_REVISION || "main",
    },
    runtime: env.ADS_MUTATIONS_SANDBOX_RUNTIME || "python3.13",
    timeout: resolveSandboxTimeoutMs(env.ADS_MUTATIONS_SANDBOX_TIMEOUT_MS),
  };
  const token = env.VERCEL_TOKEN;
  if (token) {
    opts.token = token;
    if (env.VERCEL_TEAM_ID) opts.teamId = env.VERCEL_TEAM_ID;
    if (env.VERCEL_PROJECT_ID) opts.projectId = env.VERCEL_PROJECT_ID;
  }
  return opts;
}

/** Which auth path a create attempt used — recorded in the error for operator diagnosis. */
export function describeAuthMode(env: Record<string, string | undefined>): string {
  if (env.VERCEL_TOKEN) {
    const scope = [
      env.VERCEL_TEAM_ID ? "teamId" : null,
      env.VERCEL_PROJECT_ID ? "projectId" : null,
    ]
      .filter(Boolean)
      .join("+");
    return `explicit VERCEL_TOKEN${scope ? ` (${scope})` : " (no teamId/projectId set)"}`;
  }
  return env.VERCEL_OIDC_TOKEN
    ? "OIDC auto-auth (VERCEL_OIDC_TOKEN present)"
    : "OIDC auto-auth (no VERCEL_OIDC_TOKEN — likely unauthenticated)";
}

/**
 * Deep-serialize an error thrown by `Sandbox.create`. The SDK throws a generic
 * "Status code 400 is not ok" and hides the HTTP response body on a nested `response`.
 * Pull out the status + body + cause chain so the real reason lands on the job row.
 */
export async function describeSandboxCreateError(err: unknown): Promise<string> {
  const parts: string[] = [];
  const e = err as Record<string, unknown> | null | undefined;

  const name = (e?.name as string) || (err instanceof Error ? "Error" : typeof err);
  const message = (e?.message as string) ?? String(err);
  parts.push(`${name}: ${message}`);

  const status = e?.status ?? e?.statusCode ?? e?.code;
  if (status !== undefined) parts.push(`status=${String(status)}`);

  // The SDK commonly attaches a fetch Response (or a pre-read body) under `response`.
  const response = e?.response as
    | { status?: number; statusText?: string; text?: () => Promise<string> }
    | string
    | undefined;
  if (typeof response === "string") {
    parts.push(`body=${response.slice(0, 1000)}`);
  } else if (response && typeof response === "object") {
    if (response.status !== undefined)
      parts.push(`response.status=${response.status} ${response.statusText ?? ""}`.trim());
    if (typeof response.text === "function") {
      try {
        const body = await response.text();
        if (body) parts.push(`body=${body.slice(0, 1000)}`);
      } catch {
        /* body already consumed or unreadable — fall through to other fields */
      }
    }
  }

  // Some SDK errors carry the parsed payload directly.
  for (const key of ["body", "error", "errors", "data"] as const) {
    const v = e?.[key];
    if (v !== undefined && v !== response) {
      parts.push(`${key}=${safeJson(v)}`);
    }
  }

  if (e?.cause !== undefined) parts.push(`cause=${safeJson(e.cause)}`);

  return parts.join(" | ");
}

function safeJson(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 1000);
  try {
    return JSON.stringify(v, errorReplacer).slice(0, 1000);
  } catch {
    return String(v);
  }
}

/** JSON.stringify replacer that unwraps Error instances (otherwise serialized as `{}`). */
function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

interface SandboxCommandResult {
  exitCode: number;
  stdout(): Promise<string> | string;
  stderr(): Promise<string> | string;
}

interface SandboxHandle {
  sandboxId: string;
  runCommand(opts: {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<SandboxCommandResult>;
  stop(): Promise<void>;
}

async function readStream(v: Promise<string> | string): Promise<string> {
  return typeof v === "string" ? v : await v;
}

export class VercelSandboxTransport implements SandboxTransport {
  async run(spec: JobSpec): Promise<SandboxRunResult> {
    const repoUrl = process.env.ADS_MUTATIONS_REPO_URL;
    if (!repoUrl) {
      throw new Error(
        "ADS_MUTATIONS_REPO_URL is required to provision the ads-mutations sandbox " +
          "(the git URL the Sandbox clones the Python package from)."
      );
    }
    const appDir = process.env.ADS_MUTATIONS_APP_DIR || "apps/psg-ads-mutations";
    const createOpts = buildCreateOptions(process.env, repoUrl);

    // Non-literal specifier: keeps `@vercel/sandbox` out of build/typecheck resolution.
    const pkg = "@vercel/sandbox";
    const mod = (await import(/* @vite-ignore */ pkg)) as {
      Sandbox: { create(opts: unknown): Promise<SandboxHandle> };
    };

    let sandbox: SandboxHandle;
    try {
      sandbox = await mod.Sandbox.create(createOpts);
    } catch (err) {
      // The SDK swallows the HTTP body behind "Status code NNN is not ok". Surface it,
      // plus the auth path + create payload shape, so the failure is self-diagnosing on
      // python_worker_jobs.error (PSG-118).
      const detail = await describeSandboxCreateError(err);
      throw new Error(
        `Vercel Sandbox.create failed [auth: ${describeAuthMode(process.env)}] ` +
          `[runtime=${createOpts.runtime} timeout=${createOpts.timeout}ms ` +
          `revision=${createOpts.source.revision}]: ${detail}`,
        { cause: err }
      );
    }

    try {
      // 1. Install the Python package (editable) so googleads_psg / gtm_psg import.
      const install = await sandbox.runCommand({
        cmd: "pip",
        args: ["install", "-e", appDir],
      });
      if (install.exitCode !== 0) {
        const err = await readStream(install.stderr());
        throw new Error(`pip install failed (exit ${install.exitCode}): ${err.slice(-600)}`);
      }

      // 2. Invoke the runner harness with the JobSpec (creds via env, not argv).
      const cmd = await sandbox.runCommand({
        cmd: "python",
        args: ["runner.py", "--job", JSON.stringify(spec)],
        cwd: appDir,
        env: forwardedEnv(),
      });

      const [stdout, stderr] = await Promise.all([
        readStream(cmd.stdout()),
        readStream(cmd.stderr()),
      ]);

      return {
        stdout,
        stderr,
        exitCode: cmd.exitCode,
        sandboxId: sandbox.sandboxId,
      };
    } finally {
      // Always tear the sandbox down; never leave a billed sandbox running.
      await sandbox.stop().catch(() => {});
    }
  }
}
