import { createClient } from "@/lib/supabase/server";
import { ReviewsTable } from "@/components/dashboard/reviews-table";
import type { ExistingResponse } from "@/components/dashboard/response-modal";

type ShopRole = "owner" | "manager" | "viewer";

export default async function ReviewsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: reviews }, { data: shops }] = await Promise.all([
    supabase
      .from("reviews")
      .select(
        "id, shop_id, platform, author, rating, body, posted_at, url"
      )
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from("shops").select("id, name").order("name"),
  ]);

  const reviewIds = (reviews ?? []).map((r) => r.id);

  const { data: responses } = reviewIds.length
    ? await supabase
        .from("review_responses")
        .select(
          "id, review_id, body, status, tone_preset, version, safety_flags, safety_overridden, approved_at"
        )
        .in("review_id", reviewIds)
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

  const { data: memberships } = user
    ? await supabase
        .from("shop_members")
        .select("shop_id, role")
        .eq("profile_id", user.id)
    : { data: [] as Array<{ shop_id: string; role: ShopRole }> };

  const rolesByShopId: Record<string, ShopRole> = {};
  for (const m of memberships ?? []) {
    rolesByShopId[m.shop_id] = m.role as ShopRole;
  }

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
