/**
 * v1.2 Ads Mutation Studio — Python-worker bridge seam.
 *
 * The bridge is the single boundary between the web UI and the shipped
 * `apps/psg-ads-mutations/` Python, executed inside a Vercel Sandbox. That Sandbox is
 * a BOARD-GATED capability (spend + infra enablement, PSG-26 "Gate: Vercel Sandbox",
 * board approval 1528068e). Until the env flag is on, `getBridge()` returns a
 * `DisabledBridge` that fails closed with a clear, attributable error — we never silently
 * fake a mutation.
 *
 * When the gate is on, the real `VercelSandboxBridge` implements this same interface:
 *   provision sandbox (SandboxTransport) → install the Python package → invoke `runner.py`
 *   in `--dry-run`/`--execute` mode → parse the JSON `MutationDiff` → mirror the Python log
 *   JSON to Supabase Storage. Persistence of `python_worker_jobs` + the append-only
 *   `ads_audit_logs` row is done by the caller (`jobs.ts:recordAndRun`), which wraps this
 *   bridge — so the interface and governance above it do not change.
 *
 * The sandbox + storage are injected (SandboxTransport / LogMirror) so the Node
 * orchestration is unit-testable with a mocked transport (no live Sandbox, no network).
 * The default transport dynamically imports `@vercel/sandbox` only when the gate is on,
 * so neither `next build` nor the unit tests need the package installed.
 */
import type { AdsPlatform, DryRunResult, ExecuteResult, MutationMode, MutationRequest } from "./types";
import { getMutation } from "./registry";

export interface PythonWorkerBridge {
  /** Run the mutation in dry-run mode and return the before/after diff. */
  dryRun(req: MutationRequest): Promise<DryRunResult>;
  /** Execute the mutation for real and return the diff + audit references. */
  execute(req: MutationRequest): Promise<ExecuteResult>;
}

/** Thrown by the disabled bridge while the Vercel Sandbox gate is closed. */
export class SandboxGatedError extends Error {
  readonly gated = true;
  constructor() {
    super(
      "Vercel Sandbox is not enabled (PSG-26 board gate). Ads Mutation Studio execution " +
        "is disabled until the Sandbox capability is provisioned. Dry-run and execute are " +
        "both blocked to avoid running Python workers in an unsupported environment."
    );
    this.name = "SandboxGatedError";
  }
}

/** Thrown when the runner harness reports a failure (non-zero exit or ok:false). */
export class RunnerError extends Error {
  /**
   * The sandbox that produced this failure, when the runner actually ran (i.e. the
   * failure is a runner non-zero exit / GoogleAdsException, not a provisioning 400).
   * Surfaced at the top level so `jobs.ts` persists `sandbox_id` on the failed row and
   * the run stays traceable to its sandbox logs (PSG-119/PSG-121).
   */
  readonly sandboxId?: string;
  /**
   * Storage path of the mirrored failure log, surfaced so `jobs.ts` persists
   * `python_worker_jobs.logs_storage_path` on the failure path too (PSG-120 Residual B):
   * a sandbox that produced output should leave an inspectable log regardless of outcome.
   */
  readonly logsStoragePath?: string;
  constructor(
    message: string,
    readonly detail?: {
      errorType?: string;
      stderr?: string;
      exitCode?: number;
      sandboxId?: string;
      logsStoragePath?: string;
    }
  ) {
    super(message);
    this.name = "RunnerError";
    this.sandboxId = detail?.sandboxId;
    this.logsStoragePath = detail?.logsStoragePath;
  }
}

/** Fail-closed bridge used while the Sandbox gate is closed. */
export class DisabledBridge implements PythonWorkerBridge {
  async dryRun(): Promise<DryRunResult> {
    throw new SandboxGatedError();
  }
  async execute(): Promise<ExecuteResult> {
    throw new SandboxGatedError();
  }
}

/** Feature flag: the Vercel Sandbox bridge is only live once the board enables it. */
export function isSandboxEnabled(): boolean {
  return process.env.ADS_MUTATIONS_SANDBOX_ENABLED === "true";
}

/** Default live-run smoke target per platform, keyed by the registry's TargetKind. */
export type SmokeTargetOverrides = {
  google_ads_customer_id?: string;
  gtm_container_id?: string;
};

/**
 * Resolve the operator-configured smoke target(s) for the studio's live-run default.
 *
 * The fixtures bake a DEMO customer id (`412-555-0142`) that Google Ads rejects as
 * `INVALID_CUSTOMER_ID`, so a dry-run seeded from the fixture can never reach
 * `status=succeeded` (PSG-120 Residual A). These env vars let the operator point the
 * studio's default target at a real Google Ads **test account** CID (and GTM container)
 * WITHOUT a code change, so the smoke is valid, repeatable, and side-effect-free. When
 * unset, the studio falls back to the fixture target (today's behaviour).
 */
export function getSmokeTargetOverrides(
  env: Record<string, string | undefined> = process.env
): SmokeTargetOverrides {
  const overrides: SmokeTargetOverrides = {};
  const cid = env.ADS_MUTATIONS_SMOKE_CUSTOMER_ID?.trim();
  const gtm = env.ADS_MUTATIONS_SMOKE_GTM_CONTAINER_ID?.trim();
  if (cid) overrides.google_ads_customer_id = cid;
  if (gtm) overrides.gtm_container_id = gtm;
  return overrides;
}

/**
 * Normalize a target ref to the form the platform's API accepts. Google Ads customer ids
 * are **digits-only** at the API; the studio/fixtures carry a dashed display form (e.g.
 * `906-312-6657`) that the API rejects as `INVALID_CUSTOMER_ID` (PSG-120 Residual A — proven
 * live: dashed ❌, digits-only `9063126657` ✅). Strip non-digits for `google_ads`; GTM
 * container ids (`GTM-XXXXXXX`) are an opaque public id and pass through untouched.
 */
export function normalizeTargetRef(targetRef: string, platform: AdsPlatform): string {
  if (platform === "google_ads") return targetRef.replace(/\D/g, "");
  return targetRef;
}

// ── Sandbox transport seam ────────────────────────────────────────────────────
// The JobSpec is the serialized contract handed to runner.py inside the sandbox.
// It is intentionally minimal + non-secret (creds travel as sandbox env, not argv).
export interface JobSpec {
  mutationKey: string;
  mode: MutationMode;
  targetRef: string;
  params: Record<string, unknown>;
}

/** Raw result of running the Python harness once inside a sandbox. */
export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** The provisioned sandbox's id, recorded on python_worker_jobs for traceability. */
  sandboxId: string;
}

/**
 * The provision→install→invoke transport. The default implementation
 * (`VercelSandboxTransport`) talks to `@vercel/sandbox`; tests inject a fake so the
 * Node orchestration (serialization, parsing, log-mirror, error paths) is verified
 * without any live infrastructure.
 */
export interface SandboxTransport {
  run(spec: JobSpec): Promise<SandboxRunResult>;
}

/** Mirrors the runner's structured log JSON to durable storage; returns the path. */
export interface LogMirror {
  store(input: {
    targetRef: string;
    sandboxId: string;
    mode: MutationMode;
    log: unknown;
  }): Promise<string | undefined>;
}

/** Shape runner.py emits between the result sentinels (see runner.py). */
interface RunnerOutput {
  ok: boolean;
  mutationKey?: string;
  mode?: string;
  before?: unknown;
  requestedChanges?: unknown;
  after?: unknown;
  /** Audit record mirrored to storage (the Python write_audit payload). */
  log?: unknown;
  error?: string;
  errorType?: string;
}

// Sentinels framing the single JSON result line in runner stdout. Keeps result
// extraction robust even if pip/import emits incidental stdout noise.
export const RESULT_BEGIN = "__PSG_ADS_RESULT_BEGIN__";
export const RESULT_END = "__PSG_ADS_RESULT_END__";

/** Pull the sentinel-framed JSON payload out of runner stdout (last occurrence wins). */
export function extractRunnerJson(stdout: string): string {
  const start = stdout.lastIndexOf(RESULT_BEGIN);
  const end = stdout.lastIndexOf(RESULT_END);
  if (start !== -1 && end !== -1 && end > start) {
    return stdout.slice(start + RESULT_BEGIN.length, end).trim();
  }
  // Fallback: the last non-empty line, for runs without sentinels.
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

export interface VercelSandboxBridgeDeps {
  transport?: SandboxTransport;
  mirror?: LogMirror;
}

/**
 * The live bridge. Each call provisions one sandbox run via the transport, parses the
 * harness output, and (best-effort) mirrors the structured log to storage. It does NOT
 * write python_worker_jobs / ads_audit_logs itself — `jobs.ts:recordAndRun` owns that,
 * using `sandboxId` + `logsStoragePath` returned here.
 */
export class VercelSandboxBridge implements PythonWorkerBridge {
  private transport?: SandboxTransport;
  private mirror?: LogMirror;

  constructor(deps: VercelSandboxBridgeDeps = {}) {
    this.transport = deps.transport;
    this.mirror = deps.mirror;
  }

  async dryRun(req: MutationRequest): Promise<DryRunResult> {
    return this.run(req, "dry_run");
  }

  async execute(req: MutationRequest): Promise<ExecuteResult> {
    return this.run(req, "execute");
  }

  private async getTransport(): Promise<SandboxTransport> {
    if (this.transport) return this.transport;
    // Resolve the real transport lazily so importing this module (and the unit tests,
    // which inject a fake) never pulls in `@vercel/sandbox`.
    const { VercelSandboxTransport } = await import("./sandbox-transport");
    this.transport = new VercelSandboxTransport();
    return this.transport;
  }

  private async getMirror(): Promise<LogMirror> {
    if (this.mirror) return this.mirror;
    const { StorageLogMirror } = await import("./log-storage");
    this.mirror = new StorageLogMirror();
    return this.mirror;
  }

  /**
   * Mirror a runner log/error payload to durable storage and return its path. Best-effort:
   * a mirror failure (or a missing mirror module) must never mask the real run outcome, so
   * any error degrades to `undefined` (a null logs path) rather than throwing. Used on both
   * the success path and the failure paths (PSG-120 Residual B).
   */
  private async mirrorLog(
    targetRef: string,
    sandboxId: string,
    mode: MutationMode,
    log: unknown
  ): Promise<string | undefined> {
    try {
      const mirror = await this.getMirror();
      return await mirror.store({ targetRef, sandboxId, mode, log });
    } catch {
      return undefined;
    }
  }

  private async run(
    req: MutationRequest,
    mode: MutationMode
  ): Promise<DryRunResult & ExecuteResult & { sandboxId: string }> {
    const def = getMutation(req.mutationKey);
    if (!def) {
      throw new Error(`Unknown mutation key: ${req.mutationKey}`);
    }

    const spec: JobSpec = {
      mutationKey: req.mutationKey,
      mode,
      targetRef: req.targetRef,
      params: req.params ?? {},
    };

    const transport = await this.getTransport();
    const res = await transport.run(spec);

    // The transport only returns (vs. throws) once a sandbox was provisioned AND the runner
    // ran end-to-end, so `res.sandboxId` is populated and the stdout/stderr are worth
    // persisting on EVERY branch below — including the failure ones. Mirror a log and carry
    // `sandboxId` + `logsStoragePath` onto any thrown RunnerError so the failed job row is
    // self-diagnosing (PSG-120 Residual B: failures were saved with both columns null).
    let parsed: RunnerOutput;
    try {
      parsed = JSON.parse(extractRunnerJson(res.stdout)) as RunnerOutput;
    } catch {
      const logsStoragePath = await this.mirrorLog(req.targetRef, res.sandboxId, mode, {
        kind: "unparseable_runner_output",
        exitCode: res.exitCode,
        stdoutTail: res.stdout.slice(-2000),
        stderrTail: res.stderr.slice(-2000),
      });
      const tail = (res.stderr || res.stdout || "").slice(-600);
      throw new RunnerError(
        `Ads mutation runner produced unparseable output (exit ${res.exitCode}). Tail: ${tail}`,
        { exitCode: res.exitCode, stderr: res.stderr, sandboxId: res.sandboxId, logsStoragePath }
      );
    }

    if (res.exitCode !== 0 || !parsed.ok) {
      // On the runner-structured-error path (e.g. a GoogleAdsException) the runner emits no
      // audit `log`, so mirror the error payload itself — operators still get a durable,
      // inspectable record of the failed sandbox run.
      const logsStoragePath = await this.mirrorLog(
        req.targetRef,
        res.sandboxId,
        mode,
        parsed.log ?? {
          kind: "runner_error",
          ok: parsed.ok,
          errorType: parsed.errorType,
          error: parsed.error,
          exitCode: res.exitCode,
          stderrTail: res.stderr.slice(-2000),
        }
      );
      throw new RunnerError(
        `Ads mutation runner failed [${parsed.errorType ?? "error"}]: ${
          parsed.error ?? res.stderr ?? "unknown error"
        }`,
        {
          errorType: parsed.errorType,
          stderr: res.stderr,
          exitCode: res.exitCode,
          sandboxId: res.sandboxId,
          logsStoragePath,
        }
      );
    }

    let logsStoragePath: string | undefined;
    if (parsed.log !== undefined && parsed.log !== null) {
      logsStoragePath = await this.mirrorLog(req.targetRef, res.sandboxId, mode, parsed.log);
    }

    // jobId is overwritten by jobs.ts with the python_worker_jobs row id; sandboxId is
    // the durable handle to the sandbox run.
    return {
      jobId: res.sandboxId,
      sandboxId: res.sandboxId,
      before: parsed.before ?? null,
      requestedChanges: parsed.requestedChanges ?? null,
      after: parsed.after ?? null,
      logsStoragePath,
    };
  }
}

/**
 * Resolve the active bridge. Returns the fail-closed `DisabledBridge` until the env flag
 * is set; the real `VercelSandboxBridge` only when the Sandbox gate is on. Even with the
 * flag mis-set we prefer failing closed over pretending.
 */
export function getBridge(): PythonWorkerBridge {
  if (!isSandboxEnabled()) {
    return new DisabledBridge();
  }
  return new VercelSandboxBridge();
}
