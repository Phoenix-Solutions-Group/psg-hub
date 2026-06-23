// PSG-217 / PSG-115b — template gate index. GET the proof/approval status of
// every mail template: current content hash, missing-token count (from the merge
// engine), the current approval record (who/when), and whether it is eligible for
// a live batch. Gated by manage_production; RLS backstops. No vendor spend.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseApprovalStore } from "@/lib/ops/template-approvals";
import {
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  buildTemplateProof,
  isTemplateEligibleForLiveBatch,
} from "@/lib/production/template-gate";

export async function GET() {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const store = supabaseApprovalStore(createServiceClient());
  const approvals = await store.listByKeys([...TEMPLATE_KEYS]);

  const templates = TEMPLATE_KEYS.map((key) => {
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
      contentHash: proof.contentHash,
      missingTokens: proof.content.missing,
      approval: approval
        ? {
            status: approval.status,
            approvedByName: approval.approved_by_name,
            approvedAt: approval.approved_at,
            releasedAt: approval.released_at,
          }
        : null,
      eligibleForLiveBatch: isTemplateEligibleForLiveBatch(state, proof.contentHash),
    };
  });

  return NextResponse.json({ templates });
}
