import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getBridge, normalizeTargetRef, SandboxGatedError } from "./bridge";
import { getMutation } from "./registry";
import type { DryRunResult, ExecuteResult, MutationRequest } from "./types";

/**
 * v1.2 Ads Mutation Studio — bridge invocation + persistence.
 *
 * Records one `python_worker_jobs` row per bridge invocation, runs the request's mode
 * through the (gated) bridge, and persists the outcome. For `execute`, appends an
 * `ads_audit_logs` row on success (mirroring the Python write_audit before/after).
 *
 * Governance and the execute rate-limit are enforced by the caller (the route) BEFORE
 * this runs. The bridge fails closed (SandboxGatedError) until the board enables the
 * Vercel Sandbox; in that case the job is recorded `cancelled` and the error rethrown so
 * the route returns 503 — we never persist a fake success.
 */
export interface RunContext {
  /** profiles.id of the authenticated operator (from requireOpsFn). */
  requestedBy: string;
}

export async function recordAndRun(
  req: MutationRequest,
  ctx: RunContext
): Promise<DryRunResult | ExecuteResult> {
  const def = getMutation(req.mutationKey);
  if (!def) {
    throw new Error(`Unknown mutation key: ${req.mutationKey}`);
  }

  // Normalize the target to the platform's API form BEFORE persisting or running — Google
  // Ads rejects the dashed customer-id display form, so a dashed CID never reaches the API
  // (PSG-120 Residual A). Persist the normalized value so target_ref matches what ran.
  const targetRef = normalizeTargetRef(req.targetRef, def.platform);
  const normalizedReq: MutationRequest = { ...req, targetRef };

  const service = createServiceClient();
  const startedAt = new Date().toISOString();

  const { data: job, error: insErr } = await service
    .from("python_worker_jobs")
    .insert({
      mutation_key: def.key,
      platform: def.platform,
      mode: normalizedReq.mode,
      target_ref: targetRef,
      shop_id: normalizedReq.shopId ?? null,
      status: "running",
      params_jsonb: normalizedReq.params ?? {},
      requested_by: ctx.requestedBy,
      approval_id: normalizedReq.approvalId ?? null,
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (insErr || !job) {
    throw new Error(`Failed to record python_worker_job: ${insErr?.message ?? "no row returned"}`);
  }

  const jobId: string = job.id;
  const bridge = getBridge();
  const enriched: MutationRequest = { ...normalizedReq, requestedBy: ctx.requestedBy };

  try {
    const result =
      normalizedReq.mode === "execute"
        ? await bridge.execute(enriched)
        : await bridge.dryRun(enriched);

    await service
      .from("python_worker_jobs")
      .update({
        status: "succeeded",
        result_jsonb: result as unknown as Record<string, unknown>,
        sandbox_id: (result as { sandboxId?: string }).sandboxId ?? null,
        logs_storage_path: result.logsStoragePath ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Audit only real executions; dry-runs are observable via python_worker_jobs.
    if (normalizedReq.mode === "execute") {
      await service.from("ads_audit_logs").insert({
        job_id: jobId,
        op_name: def.applyFn,
        mutation_key: def.key,
        platform: def.platform,
        target_ref: targetRef,
        shop_id: normalizedReq.shopId ?? null,
        mode: "execute",
        before_jsonb: result.before ?? null,
        requested_changes_jsonb: result.requestedChanges ?? null,
        after_jsonb: result.after ?? null,
        logs_storage_path: result.logsStoragePath ?? null,
        actor: ctx.requestedBy,
        approval_id: normalizedReq.approvalId ?? null,
      });
    }

    // The job row we created is the authoritative job id for this invocation.
    return { ...result, jobId };
  } catch (err) {
    const gated = err instanceof SandboxGatedError;
    // The transport/bridge attach sandboxId (and the mirrored logs path) to errors thrown
    // after the sandbox ran, so a failed job still points at the sandbox + logs that explain
    // it (PSG-119 sandbox_id; PSG-120 Residual B logs_storage_path — both were null before).
    const sandboxId = (err as { sandboxId?: string } | null)?.sandboxId;
    const logsStoragePath = (err as { logsStoragePath?: string } | null)?.logsStoragePath;
    await service
      .from("python_worker_jobs")
      .update({
        status: gated ? "cancelled" : "failed",
        error: err instanceof Error ? err.message : String(err),
        sandbox_id: sandboxId ?? null,
        logs_storage_path: logsStoragePath ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    throw err;
  }
}
