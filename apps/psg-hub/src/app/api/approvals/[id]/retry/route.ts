// PSG-768 (B3 / A1) — retry the publish for an approval whose downstream publish
// FAILED (status `publish_failed`). The approval decision was already recorded and
// is preserved; this route only re-attempts the publish so a transient failure can
// be recovered without re-approving. Same auth/role gate as the approve route
// (owner or manager on the action's shop). Publish is attempted ONLY here (and on
// approve), never on reject. The retry is written to the append-only access_audit
// log (action approval.retry_publish).
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  ApprovalDecisionError,
  retryPublish,
  supabaseApprovalQueueStore,
} from "@/lib/ops/approval-queue";
import { buildServerPublishers } from "@/lib/ops/approval-queue/registry.server";
import { serverPublishers } from "@/lib/ops/approval-queue/publishers";

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
    console.error("[approvals/retry] load failed:", loadErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Role gate: only an owner or manager on the action's shop may retry.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", row.shop_id)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const store = supabaseApprovalQueueStore(createServiceClient());
  try {
    const final = await retryPublish(
      store,
      { id, actorProfileId: user.id, now: new Date().toISOString() },
      { publishers: { ...buildServerPublishers(), ...serverPublishers } }
    );

    await recordAuditEvent({
      actorProfileId: user.id,
      targetShopId: row.shop_id,
      action: "approval.retry_publish",
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
    // A non-publish_failed row (e.g. already re-published in another tab) → 409.
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[approvals/retry]:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Failed to retry publish" }, { status: 500 });
  }
}
