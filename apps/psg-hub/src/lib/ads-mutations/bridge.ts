/**
 * v1.2 Ads Mutation Studio — Python-worker bridge seam.
 *
 * The bridge is the single boundary between the web UI and the shipped
 * `apps/psg-ads-mutations/` Python, executed inside a Vercel Sandbox. That Sandbox is
 * a BOARD-GATED capability (spend + infra enablement, PSG-26 "Gate: Vercel Sandbox").
 * Until the gate clears, `getBridge()` returns a `DisabledBridge` that fails closed with
 * a clear, attributable error — we never silently fake a mutation.
 *
 * When the gate clears, the real `VercelSandboxBridge` (B2-activation) implements this
 * same interface: provision sandbox → install the Python package → invoke the registered
 * module with `--dry-run`/`--execute` → mirror logs to Supabase Storage → write
 * python_worker_jobs + ads_audit_logs rows. The interface and governance above it do not
 * change, so the UI and routes can be built and tested against this seam today.
 */
import type { DryRunResult, ExecuteResult, MutationRequest } from "./types";

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

/**
 * Resolve the active bridge. Returns the fail-closed `DisabledBridge` until the gate
 * clears; the real `VercelSandboxBridge` is wired in here during B2-activation.
 */
export function getBridge(): PythonWorkerBridge {
  if (!isSandboxEnabled()) {
    return new DisabledBridge();
  }
  // B2-activation: return new VercelSandboxBridge() once the Sandbox capability lands.
  // Until then, even with the flag on we fail closed rather than pretend.
  return new DisabledBridge();
}
