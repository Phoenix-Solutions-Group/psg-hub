import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type VersionRow = {
  id: string;
  version: number;
  body: string | null;
  status: string;
  tone_preset: string | null;
  model_id: string | null;
  prompt_version: string | null;
  safety_flags: string[] | null;
  safety_overridden: boolean;
  approved_by: string | null;
  approved_at: string | null;
  restored_from_request_id: string | null;
  restored_from_version: number | null;
  restored_by: string | null;
  restored_at: string | null;
  recorded_at: string;
};

export async function GET(
  _request: Request,
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
  const { data: versions, error } = await service
    .from("review_response_versions")
    .select(
      "id, version, body:draft_text, status, tone_preset, model_id, prompt_version, safety_flags, safety_overridden, approved_by, approved_at, restored_from_request_id, restored_from_version, restored_by, restored_at, recorded_at",
    )
    .eq("review_item_id", reviewId)
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ versions: (versions ?? []) as VersionRow[] });
}
