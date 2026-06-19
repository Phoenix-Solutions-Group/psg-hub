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
import type { DryRunResult, ExecuteResult, MutationMode, MutationRequest } from "./types";
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
   * the run stays traceable to its sandbox logs (PSG-121, extends PSG-119).
   */
  readonly sandboxId?: string;
  constructor(
    message: string,
    readonly detail?: {
      errorType?: string;
      stderr?: string;
      exitCode?: number;
      sandboxId?: string;
    }
  ) {
    super(message);
    this.name = "RunnerError";
    this.sandboxId = detail?.sandboxId;
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

    let parsed: RunnerOutput;
    try {
      parsed = JSON.parse(extractRunnerJson(res.stdout)) as RunnerOutput;
    } catch {
      const tail = (res.stderr || res.stdout || "").slice(-600);
      throw new RunnerError(
        `Ads mutation runner produced unparseable output (exit ${res.exitCode}). Tail: ${tail}`,
        { exitCode: res.exitCode, stderr: res.stderr, sandboxId: res.sandboxId }
      );
    }

    if (res.exitCode !== 0 || !parsed.ok) {
      throw new RunnerError(
        `Ads mutation runner failed [${parsed.errorType ?? "error"}]: ${
          parsed.error ?? res.stderr ?? "unknown error"
        }`,
        {
          errorType: parsed.errorType,
          stderr: res.stderr,
          exitCode: res.exitCode,
          sandboxId: res.sandboxId,
        }
      );
    }

    let logsStoragePath: string | undefined;
    if (parsed.log !== undefined && parsed.log !== null) {
      const mirror = await this.getMirror();
      logsStoragePath = await mirror.store({
        targetRef: req.targetRef,
        sandboxId: res.sandboxId,
        mode,
        log: parsed.log,
      });
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
