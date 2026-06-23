// PSG-245 / Wave 2 (G-d) — approve a queued action.
// POST { decidedByName?, notes? }. Role-gated: the caller must be an owner or
// manager on the queued action's shop (per-shop tenant isolation enforced by RLS
// on the load + the membership check here). On approve the action publishes via
// the registered publisher for its action_type (publish is attempted ONLY here,
// never on reject). The decision is written to the append-only access_audit log
// (action approval.approve). Generic over action_type.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalDecisionError,
  approveApproval,
  supabaseApprovalQueueStore,
} from "@/lib/ops/approval-queue";
// Server publisher registries (action_type → publisher). The pure gate keeps an
// empty default; the route injects the real publishers so an approved action
// publishes to its downstream. Two capability registries are merged here:
//  - buildServerPublishers() (PSG-248): gate defaults + review_solicitation
//    (lazy — builds the service client only when a publish runs).
//  - serverPublishers (PSG-247): gbp_post → GBP local post.
// They cover disjoint action_types; merged so every Wave-2 capability publishes
// through the one approve gate.
import { buildServerPublishers } from "@/lib/ops/approval-queue/registry.server";
import { serverPublishers } from "@/lib/ops/approval-queue/publishers";

const bodySchema = z.object({
  decidedByName: z.string().trim().min(1).max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load via the RLS-respecting server client: a user can only SELECT rows for
  // shops they belong to, so a cross-tenant id resolves to null → 404.
  const { data: row, error: loadErr } = await supabase
    .from("approval_queue")
    .select("id, shop_id, action_type, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[approvals/approve] load failed:", loadErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Role gate: only an owner or manager on the action's shop may decide.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", row.shop_id)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Body is optional; tolerate an empty/absent body like the content gate.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const store = supabaseApprovalQueueStore(createServiceClient());
  try {
    const final = await approveApproval(
      store,
      {
        id,
        actorProfileId: user.id,
        actorName: parsed.data.decidedByName ?? null,
        notes: parsed.data.notes ?? null,
        now: new Date().toISOString(),
      },
      { publishers: { ...buildServerPublishers(), ...serverPublishers } }
    );

    await recordAuditEvent({
      actorProfileId: user.id,
      targetShopId: row.shop_id,
      action: "approval.approve",
      payload: {
        approvalId: id,
        actionType: row.action_type,
        status: final.status,
        published: final.status === "published",
        ...(final.publish_error ? { publishError: final.publish_error } : {}),
      },
    });

    return NextResponse.json({ approval: final }, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[approvals/approve]:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
  }
}
