import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { mutationBodySchema } from "@/lib/ads-mutations/validation";
import { validateMutationRequest } from "@/lib/ads-mutations/governance";
import { recordAndRun } from "@/lib/ads-mutations/jobs";
import { SandboxGatedError } from "@/lib/ads-mutations/bridge";
import { assertWithinMutationLimits, MutationRateLimitError } from "@/lib/ads-mutations/rate-limit";
import type { MutationRequest } from "@/lib/ads-mutations/types";

// POST /api/ads-mutations/execute
//
// Run a mutation for real against the target Google Ads customer / GTM container. Mode is
// forced to `execute`. Order of defenses (fail-closed):
//   1. auth gate — the `ads_mutations` capability (psg_superadmin implicit; psg_internal
//      needs the flag granted). App-level defense-in-depth ahead of the in-DB RLS.
//   2. governance — target required; high-risk requires a superadmin/board approvalId
//   3. execute rate-limit (per-target + global, counted in python_worker_jobs)
//   4. bridge.execute — disabled until the Vercel Sandbox gate clears → 503 `gated`
// On success a python_worker_jobs row + an append-only ads_audit_logs row are written.
export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("ads_mutations");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = mutationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const req: MutationRequest = {
    mutationKey: parsed.data.mutationKey,
    mode: "execute",
    targetRef: parsed.data.targetRef,
    params: parsed.data.params,
    shopId: parsed.data.shopId,
    approvalId: parsed.data.approvalId,
  };

  const governance = validateMutationRequest(req);
  if (!governance.ok) {
    return NextResponse.json(
      { error: "Governance failed", errors: governance.errors },
      { status: 422 }
    );
  }

  try {
    await assertWithinMutationLimits({ targetRef: req.targetRef });
  } catch (err) {
    if (err instanceof MutationRateLimitError) {
      return NextResponse.json(
        { error: err.message, scope: err.scope, limit: err.limit },
        { status: 429 }
      );
    }
    console.error("[api/ads-mutations/execute] rate-limit check failed:", err);
    return NextResponse.json({ error: "Execute failed" }, { status: 500 });
  }

  try {
    const result = await recordAndRun(req, { requestedBy: gate.userId });
    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    if (err instanceof SandboxGatedError) {
      return NextResponse.json({ error: err.message, gated: true }, { status: 503 });
    }
    console.error("[api/ads-mutations/execute] failed:", err);
    return NextResponse.json({ error: "Execute failed" }, { status: 500 });
  }
}
