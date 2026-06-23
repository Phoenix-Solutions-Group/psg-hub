// PSG-245 / Wave 2 (G-d) — queue an agent-proposed action for human review.
// POST { shopId, actionType, title, summary?, payload?, proposedBy? } → a new
// `pending` approval_queue row. Role-gated: the caller must be an owner or
// manager on the target shop (per-shop isolation). The autonomy layer (G-a/b/c)
// may also enqueue server-side by calling enqueueApproval() directly via the
// service client; this route is the HTTP surface for the same operation.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ApprovalDecisionError,
  enqueueApproval,
  supabaseApprovalQueueStore,
} from "@/lib/ops/approval-queue";

const bodySchema = z.object({
  shopId: z.string().uuid(),
  actionType: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(4000).nullish(),
  payload: z.record(z.string(), z.unknown()).optional(),
  proposedBy: z.string().trim().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // Role gate: only an owner/manager on the target shop may queue an action there.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", parsed.data.shopId)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const store = supabaseApprovalQueueStore(createServiceClient());
  try {
    const row = await enqueueApproval(store, {
      shopId: parsed.data.shopId,
      actionType: parsed.data.actionType,
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      payload: parsed.data.payload ?? {},
      proposedBy: parsed.data.proposedBy ?? null,
    });
    return NextResponse.json({ approval: row }, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("[approvals/enqueue]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to queue action" }, { status: 500 });
  }
}
