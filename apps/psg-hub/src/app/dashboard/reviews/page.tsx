import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext, type UserShop } from "@/lib/shop/context";
import { getLatestMonthlySnapshot } from "@/lib/analytics/snapshots";
import { ReviewsTable } from "@/components/dashboard/reviews-table";
import type { ExistingResponse } from "@/components/dashboard/response-modal";

type ShopRole = "owner" | "manager" | "viewer";

export default async function ReviewsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Scope reviews to the ACTIVE shop (switcher), not every member shop mixed.
  const { shops: userShops, activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { shops: [] as UserShop[], activeShopId: null };

  // Customer reviews live in review_items (not the content-suggestion `reviews` table).
  // RLS clamps to the member's shops via user_shop_ids(); the active-shop filter narrows
  // within that set. Alias text->body, reviewed_at->posted_at. No active shop -> empty.
  const { data: reviewItems } = activeShopId
    ? await supabase
        .from("review_items")
        .select("id, shop_id, platform, author, rating, body:text, posted_at:reviewed_at")
        .eq("shop_id", activeShopId)
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(100)
    : { data: [] };

  // review_items has no per-review URL (Google's v4 API returns none), so the Source
  // link is the shop's Google Maps listing — metadata.mapsUri, captured on the monthly
  // gbp_presence snapshot (13-03b). Same link for every row of a shop; null until the
  // first gbp-presence-sync run populates it.
  const presenceRow = activeShopId
    ? await getLatestMonthlySnapshot(supabase, {
        shopId: activeShopId,
        source: "gbp_presence",
      })
    : null;
  const mapsUri =
    presenceRow &&
    typeof (presenceRow.metrics as Record<string, unknown>).maps_uri === "string"
      ? ((presenceRow.metrics as Record<string, unknown>).maps_uri as string)
      : null;

  const reviews = (reviewItems ?? []).map((r) => ({
    ...r,
    url: mapsUri,
  }));

  const reviewIds = reviews.map((r) => r.id);

  const { data: responses } = reviewIds.length
    ? await supabase
        .from("review_responses")
        .select(
          "id, review_id:review_item_id, body:draft_text, status, tone_preset, version, safety_flags, safety_overridden, approved_at"
        )
        .in("review_item_id", reviewIds)
    : { data: [] as Array<{
        id: string;
        review_id: string;
        body: string;
        status: "draft" | "approved" | "rejected";
        tone_preset: "default" | "warm" | "concise" | "apologetic";
        version: number;
        safety_flags: string[];
        safety_overridden: boolean;
        approved_at: string | null;
      }> };

  const responsesByReviewId: Record<string, ExistingResponse> = {};
  for (const r of responses ?? []) {
    responsesByReviewId[r.review_id] = {
      id: r.id,
      body: r.body,
      status: r.status,
      tone_preset: r.tone_preset,
      version: r.version,
      safety_flags: r.safety_flags ?? [],
      safety_overridden: r.safety_overridden,
      approved_at: r.approved_at,
    };
  }

  // Switcher governs shop scope: pass ONLY the active shop to the table (its
  // in-page shop filter hides at <=1 shop) and derive roles from the membership list.
  const rolesByShopId: Record<string, ShopRole> = {};
  for (const s of userShops) {
    rolesByShopId[s.id] = s.role as ShopRole;
  }
  const activeShop = userShops.find((s) => s.id === activeShopId);
  const shops = activeShop
    ? [{ id: activeShop.id, name: activeShop.name }]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground">
          Customer reviews from Google and Yelp across your shops. Draft
          AI responses in the shop&rsquo;s voice, then approve before posting.
        </p>
      </div>
      <ReviewsTable
        reviews={reviews || []}
        shops={shops || []}
        responsesByReviewId={responsesByReviewId}
        rolesByShopId={rolesByShopId}
      />
    </div>
  );
}
