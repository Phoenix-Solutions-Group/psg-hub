import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type RestoreRequestBody = {
  version?: number;
  reason?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reviewId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RestoreRequestBody;
  try {
    body = (await request.json()) as RestoreRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Number.isInteger(body.version) || Number(body.version) < 1) {
    return NextResponse.json({ error: "version (positive integer) required" }, { status: 400 });
  }

  const { data: review, error: revErr } = await supabase
    .from("review_items")
    .select("id, shop_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", review.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: version, error: versionErr } = await service
    .from("review_response_versions")
    .select("review_response_id, review_item_id, shop_id, version")
    .eq("review_item_id", reviewId)
    .eq("version", body.version)
    .maybeSingle();

  if (versionErr) {
    return NextResponse.json({ error: versionErr.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : null;

  const { data: restoreRequest, error: insertErr } = await service
    .from("review_response_restore_requests")
    .insert({
      review_response_id: version.review_response_id,
      review_item_id: version.review_item_id,
      shop_id: version.shop_id,
      requested_version: version.version,
      reason,
      requested_by: user.id,
      status: "pending",
    })
    .select(
      "id, review_response_id, review_item_id, shop_id, requested_version, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note",
    )
    .single();

  if (insertErr) {
    const status = insertErr.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? "A pending restore request already exists for this version."
            : insertErr.message,
      },
      { status },
    );
  }

  return NextResponse.json({ request: restoreRequest }, { status: 201 });
}
