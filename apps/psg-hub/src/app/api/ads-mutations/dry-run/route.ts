import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { mutationBodySchema } from "@/lib/ads-mutations/validation";
import { validateMutationRequest } from "@/lib/ads-mutations/governance";
import { recordAndRun } from "@/lib/ads-mutations/jobs";
import { SandboxGatedError } from "@/lib/ads-mutations/bridge";
import type { MutationRequest } from "@/lib/ads-mutations/types";

// POST /api/ads-mutations/dry-run
//
// Preview a mutation's before/after diff WITHOUT changing anything. Mode is forced to
// `dry_run` by the route. Governance still runs (target + required params) so the preview
// reflects a real request. No rate-limit (dry-runs are free + non-mutating). Returns 503
// `gated` while the Vercel Sandbox bridge is disabled — never a fabricated diff.
//
// GATE (PSG-26d): the `ads_mutations` capability (psg_superadmin implicit; psg_internal
// needs the flag). App-level defense-in-depth ahead of the in-DB RLS.
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
    mode: "dry_run",
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
    const result = await recordAndRun(req, { requestedBy: gate.userId });
    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    if (err instanceof SandboxGatedError) {
      return NextResponse.json({ error: err.message, gated: true }, { status: 503 });
    }
    console.error("[api/ads-mutations/dry-run] failed:", err);
    return NextResponse.json({ error: "Dry-run failed" }, { status: 500 });
  }
}
