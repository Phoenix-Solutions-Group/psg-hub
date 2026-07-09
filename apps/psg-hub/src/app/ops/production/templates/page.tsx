import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { supabaseApprovalStore } from "@/lib/ops/template-approvals";
import {
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  buildTemplateProof,
  isTemplateEligibleForLiveBatch,
} from "@/lib/production/template-gate";
import { TemplateGateCard, type TemplateGateRow } from "@/components/ops/template-gate-actions";

// PSG-217 / PSG-115b — proof / approve / release gate. Server-rendered status of
// every mail template (current content hash, missing-token report, approval
// record, live-batch eligibility); the per-template card drives the gated
// approve/release/revoke + seed-test routes. Gated by manage_production.

export default async function TemplateGatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_production")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Mail templates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_production</code> capability.
        </p>
      </div>
    );
  }

  const store = supabaseApprovalStore(createServiceClient());
  const approvals = await store.listByKeys([...TEMPLATE_KEYS]);

  const rows: TemplateGateRow[] = TEMPLATE_KEYS.map((key) => {
    const proof = buildTemplateProof(key);
    const approval =
      approvals.find((a) => a.template_key === key && a.content_hash === proof.contentHash) ?? null;
    const state = approval
      ? { templateKey: key, contentHash: approval.content_hash, status: approval.status }
      : null;
    return {
      key,
      label: TEMPLATE_LABELS[key],
      pieceType: proof.pieceType,
      templateSize: proof.templateSize,
      contentHash: proof.contentHash,
      missingTokens: proof.content.missing,
      status: approval?.status ?? null,
      approvedByName: approval?.approved_by_name ?? null,
      approvedAt: approval?.approved_at ?? null,
      releasedAt: approval?.released_at ?? null,
      eligibleForLiveBatch: isTemplateEligibleForLiveBatch(state, proof.contentHash),
    };
  });

  const eligibleCount = rows.filter((r) => r.eligibleForLiveBatch).length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Mail templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Proof, approve, and release templates before they can be mailed. {eligibleCount} of{" "}
          {rows.length} eligible for live batches. Live mailing stays behind gate G4; seed tests
          run in Lob test mode only.
        </p>
      </div>

      <div className="space-y-5">
        {rows.map((row) => (
          <TemplateGateCard key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
