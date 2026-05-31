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

  let query = supabase
    .from("reviews")
    .select(
      "id, shop_id, platform, external_id, author, rating, body, posted_at, url"
    )
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (shop_id) query = query.eq("shop_id", shop_id);
  if (platform) query = query.eq("platform", platform);
  if (minRating !== null && !Number.isNaN(minRating)) {
    query = query.gte("rating", minRating);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reviews: data ?? [] });
}
