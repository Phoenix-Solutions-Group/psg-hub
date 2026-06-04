import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const shop_id = searchParams.get("shop_id");
  const platform = searchParams.get("platform");
  const minRatingRaw = searchParams.get("min_rating");
  const minRating = minRatingRaw ? Number(minRatingRaw) : null;

  // Customer reviews live in review_items (RLS clamps to member shops via user_shop_ids()).
  // Alias text->body, reviewed_at->posted_at; review_items has no external_id/url columns.
  let query = supabase
    .from("review_items")
    .select(
      "id, shop_id, platform, author, rating, body:text, posted_at:reviewed_at"
    )
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (shop_id) query = query.eq("shop_id", shop_id);
  if (platform) query = query.eq("platform", platform);
  if (minRating !== null && !Number.isNaN(minRating)) {
    query = query.gte("rating", minRating);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[reviews/list] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load reviews" }, { status: 500 });
  }

  return NextResponse.json({ reviews: data ?? [] });
}
