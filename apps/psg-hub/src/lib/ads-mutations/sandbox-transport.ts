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
 * LIVE ROUND-TRIP is verified in PSG-26e once the Sandbox infra (PSG-26c) lands; the Node
 * orchestration around this transport is unit-tested today with a mocked transport.
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

function forwardedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of FORWARDED_ENV_KEYS) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
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
    const revision = process.env.ADS_MUTATIONS_REPO_REVISION || "main";
    const appDir = process.env.ADS_MUTATIONS_APP_DIR || "apps/psg-ads-mutations";
    const timeoutMs = Number(process.env.ADS_MUTATIONS_SANDBOX_TIMEOUT_MS || 600_000);

    // Non-literal specifier: keeps `@vercel/sandbox` out of build/typecheck resolution.
    const pkg = "@vercel/sandbox";
    const mod = (await import(/* @vite-ignore */ pkg)) as {
      Sandbox: { create(opts: unknown): Promise<SandboxHandle> };
    };

    const sandbox = await mod.Sandbox.create({
      source: { type: "git", url: repoUrl, revision },
      timeout: timeoutMs,
    });

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
