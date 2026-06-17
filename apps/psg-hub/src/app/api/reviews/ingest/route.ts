import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGbpReviewsForShop } from "@/lib/google-oauth/gbp-reviews-sync";

type IngestBody = { shop_id?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestBody;
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

  // 14-01: ingest this shop's GBP reviews under the membership gate above. The upsert is
  // a service-role write (review_items RLS bypass), so build a SERVICE client AFTER the
  // user-scoped membership check — the gate decides access, the service client does the
  // write. Shares the orchestrator's per-shop core with the cron (one code path).
  const service = createServiceClient();
  const { inserted, skipped, errors } = await syncGbpReviewsForShop(
    service,
    shop_id
  );
  return NextResponse.json({ inserted, skipped, errors });
}
