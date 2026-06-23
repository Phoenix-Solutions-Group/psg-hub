// PSG-217 / PSG-115b — release an approved template version → eligible for live
// batches. POST { contentHash }. Only an `approved` version (matching the current
// bytes) can be released. Records who/when and writes an audit row. Gated by
// manage_production. No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalTransitionError,
  releaseTemplateVersion,
  supabaseApprovalStore,
} from "@/lib/ops/template-approvals";
import { currentTemplateHash, isTemplateKey } from "@/lib/production/template-gate";

const bodySchema = z.object({
  contentHash: z.string().trim().min(1),
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

  const currentHash = currentTemplateHash(key);
  if (parsed.data.contentHash !== currentHash) {
    return NextResponse.json(
      { error: "Template changed since it was approved — re-proof and re-approve", currentHash },
      { status: 409 }
    );
  }

  const store = supabaseApprovalStore(createServiceClient());
  try {
    const row = await releaseTemplateVersion(store, {
      templateKey: key,
      contentHash: currentHash,
      actorProfileId: gate.userId,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "production.template.release",
      payload: { templateKey: key, contentHash: currentHash },
    });

    return NextResponse.json({ approval: row }, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[ops/production/templates/release]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to release template" }, { status: 500 });
  }
}
