import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkResponseSafety } from "@/lib/reviews/safety";

type ApproveAction =
  | "approve"
  | "reject"
  | "update"
  | "unapprove"
  | "override_safety";

type ApproveBody = {
  action?: ApproveAction;
  body?: string;
  expectedVersion?: number;
};

const ACTIONS: ApproveAction[] = [
  "approve",
  "reject",
  "update",
  "unapprove",
  "override_safety",
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ApproveBody;
  try {
    body = (await request.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }

  if (typeof body.expectedVersion !== "number") {
    return NextResponse.json(
      { error: "expectedVersion (number) required" },
      { status: 400 }
    );
  }

  // Load review for tenancy check
  const { data: review, error: revErr } = await supabase
    .from("review_items")
    .select("id, shop_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (revErr) {
    return NextResponse.json({ error: revErr.message }, { status: 500 });
  }
  if (!review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", review.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = membership.role as "owner" | "manager" | "viewer";

  // Role gating
  if (
    (action === "approve" && role !== "owner" && role !== "manager") ||
    (action === "override_safety" && role !== "owner")
  ) {
    return NextResponse.json(
      { error: `role '${role}' not permitted for action '${action}'` },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  const { data: existing, error: exErr } = await service
    .from("review_responses")
    .select(
      "id, review_id:review_item_id, shop_id, body:draft_text, status, tone_preset, model_id, prompt_version, version, safety_flags, safety_overridden, approved_by, approved_at"
    )
    .eq("review_item_id", reviewId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "No draft exists" }, { status: 404 });
  }

  // State-machine enforcement
  const currentStatus = existing.status as "draft" | "approved" | "rejected";
  const flagsNonEmpty =
    Array.isArray(existing.safety_flags) &&
    (existing.safety_flags as unknown[]).length > 0;

  switch (action) {
    case "approve": {
      if (currentStatus !== "draft") {
        return NextResponse.json(
          { error: `cannot approve from status '${currentStatus}'` },
          { status: 409 }
        );
      }
      if (flagsNonEmpty && !existing.safety_overridden) {
        return NextResponse.json(
          {
            error:
              "safety flags present; use 'override_safety' first (owner only)",
            flags: existing.safety_flags,
          },
          { status: 409 }
        );
      }
      break;
    }
    case "reject":
      if (currentStatus !== "draft") {
        return NextResponse.json(
          { error: `cannot reject from status '${currentStatus}'` },
          { status: 409 }
        );
      }
      break;
    case "update":
      if (currentStatus !== "draft") {
        return NextResponse.json(
          { error: `cannot edit from status '${currentStatus}'` },
          { status: 409 }
        );
      }
      if (typeof body.body !== "string" || body.body.trim().length === 0) {
        return NextResponse.json(
          { error: "body required for update" },
          { status: 400 }
        );
      }
      break;
    case "unapprove":
      if (currentStatus !== "approved") {
        return NextResponse.json(
          { error: `cannot unapprove from status '${currentStatus}'` },
          { status: 409 }
        );
      }
      break;
    case "override_safety":
      if (currentStatus !== "draft") {
        return NextResponse.json(
          { error: "override only valid on drafts" },
          { status: 409 }
        );
      }
      if (!flagsNonEmpty) {
        return NextResponse.json(
          { error: "no safety flags to override" },
          { status: 409 }
        );
      }
      break;
  }

  // Build update payload
  type Patch = Record<string, unknown>;
  const patch: Patch = { updated_at: new Date().toISOString() };
  let newVersion = existing.version;

  if (action === "approve") {
    patch.status = "approved";
    patch.approved_by = user.id;
    patch.approved_at = new Date().toISOString();
  } else if (action === "reject") {
    patch.status = "rejected";
  } else if (action === "unapprove") {
    patch.status = "draft";
    patch.approved_by = null;
    patch.approved_at = null;
  } else if (action === "override_safety") {
    patch.safety_overridden = true;
    patch.safety_overridden_by = user.id;
  } else if (action === "update") {
    const newBody = body.body as string;
    const safety = checkResponseSafety(newBody);
    patch.draft_text = newBody;
    patch.safety_flags = safety.flags;
    patch.safety_overridden = false;
    patch.safety_overridden_by = null;
    newVersion = existing.version + 1;
    patch.version = newVersion;
  }

  // Optimistic concurrency: only apply if version matches expected
  const { data: updated, error: upErr } = await service
    .from("review_responses")
    .update(patch)
    .eq("id", existing.id)
    .eq("version", body.expectedVersion)
    .select(
      "id, review_id:review_item_id, shop_id, body:draft_text, status, tone_preset, model_id, prompt_version, version, safety_flags, safety_overridden, approved_by, approved_at, created_at, updated_at"
    )
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      {
        error:
          "Response was modified by another user. Reload and try again.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ response: updated });
}
