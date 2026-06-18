import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { classifyPendingSentiment } from "@/lib/reviews/review-sentiment-sync";

type ClassifyBody = { shop_id?: string };

// Phase 14 / 14-03b — on-demand "Classify now" trigger. Mirrors api/reviews/ingest: the
// membership gate (user-session client) decides access, then a SERVICE client runs the
// classify (review_sentiment is a service-role write). Scoped to the one shop via the
// 14-03b shopId option; the daily gbp-reviews-sync cron remains the fleet-wide backfill.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ClassifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shop_id = body.shop_id;
  if (!shop_id) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { classified, skipped, failed } = await classifyPendingSentiment(service, {
    shopId: shop_id,
  });
  return NextResponse.json({ classified, skipped, failed });
}
