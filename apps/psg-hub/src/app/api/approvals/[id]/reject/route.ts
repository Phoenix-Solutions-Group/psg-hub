// PSG-245 / Wave 2 (G-d) — reject a queued action.
// POST { decidedByName?, notes? }. Role-gated (owner/manager on the action's
// shop). A reject NEVER publishes. The decision is written to the append-only
// access_audit log (action approval.reject). Generic over action_type.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalDecisionError,
  rejectApproval,
  supabaseApprovalQueueStore,
} from "@/lib/ops/approval-queue";

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

  const { data: row, error: loadErr } = await supabase
    .from("approval_queue")
    .select("id, shop_id, action_type, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[approvals/reject] load failed:", loadErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", row.shop_id)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    const final = await rejectApproval(store, {
      id,
      actorProfileId: user.id,
      actorName: parsed.data.decidedByName ?? null,
      notes: parsed.data.notes ?? null,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: user.id,
      targetShopId: row.shop_id,
      action: "approval.reject",
      payload: { approvalId: id, actionType: row.action_type, status: final.status },
    });

    return NextResponse.json({ approval: final }, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[approvals/reject]:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Failed to reject" }, { status: 500 });
  }
}
