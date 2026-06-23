// PSG-217 / PSG-115b — revoke an approved/released template version. POST
// { contentHash }. Pulls a template back out of live eligibility (e.g. a problem
// found post-release). Records who/when and writes an audit row. Gated by
// manage_production. No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalTransitionError,
  revokeTemplateVersion,
  supabaseApprovalStore,
} from "@/lib/ops/template-approvals";
import { isTemplateKey } from "@/lib/production/template-gate";

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

  const store = supabaseApprovalStore(createServiceClient());
  try {
    const row = await revokeTemplateVersion(store, {
      templateKey: key,
      contentHash: parsed.data.contentHash,
      actorProfileId: gate.userId,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "production.template.revoke",
      payload: { templateKey: key, contentHash: parsed.data.contentHash },
    });

    return NextResponse.json({ approval: row }, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[ops/production/templates/revoke]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to revoke template" }, { status: 500 });
  }
}
