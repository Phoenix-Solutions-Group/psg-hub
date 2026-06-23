// PSG-217 / PSG-115b — approve (named sign-off) a template version.
// POST { approverName, contentHash, notes? }. The contentHash MUST match the
// current template bytes, so a sign-off is always against exactly what was
// proofed (a template edited mid-review is rejected → re-proof). Records the
// attributable approval (who/when) and writes an audit row. Gated by
// manage_production. No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalTransitionError,
  approveTemplateVersion,
  supabaseApprovalStore,
} from "@/lib/ops/template-approvals";
import { currentTemplateHash, isTemplateKey } from "@/lib/production/template-gate";

const bodySchema = z.object({
  approverName: z.string().trim().min(1, "approverName is required").max(200),
  contentHash: z.string().trim().min(1),
  notes: z.string().trim().max(2000).nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "Unknown template key" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Sign off only on the current bytes — reject a stale proof.
  const currentHash = currentTemplateHash(key);
  if (parsed.data.contentHash !== currentHash) {
    return NextResponse.json(
      { error: "Template changed since it was proofed — re-proof and try again", currentHash },
      { status: 409 }
    );
  }

  const store = supabaseApprovalStore(createServiceClient());
  try {
    const row = await approveTemplateVersion(store, {
      templateKey: key,
      contentHash: currentHash,
      actorProfileId: gate.userId,
      approverName: parsed.data.approverName,
      notes: parsed.data.notes ?? null,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "production.template.approve",
      payload: {
        templateKey: key,
        contentHash: currentHash,
        approverName: parsed.data.approverName,
      },
    });

    return NextResponse.json({ approval: row }, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[ops/production/templates/approve]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to approve template" }, { status: 500 });
  }
}
