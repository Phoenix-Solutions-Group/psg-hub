import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export class RateLimitError extends Error {
  constructor(
    public scope: "per_review_hour" | "per_shop_day",
    public limit: number,
    public windowMinutes: number
  ) {
    super(
      `Rate limit exceeded: ${scope} (${limit} calls per ${windowMinutes} min)`
    );
    this.name = "RateLimitError";
  }
}

const PER_REVIEW_LIMIT = 10;
const PER_REVIEW_WINDOW_MIN = 60;
const PER_SHOP_LIMIT = 100;
const PER_SHOP_WINDOW_MIN = 60 * 24;

export async function assertWithinLimits(input: {
  userId: string;
  shopId: string;
  reviewId: string;
}): Promise<void> {
  const service = createServiceClient();

  const reviewWindowStart = new Date(
    Date.now() - PER_REVIEW_WINDOW_MIN * 60 * 1000
  ).toISOString();

  const { count: reviewCount, error: reviewErr } = await service
    .from("llm_call_log")
    .select("id", { count: "exact", head: true })
    .eq("review_id", input.reviewId)
    .gte("created_at", reviewWindowStart);

  if (reviewErr) {
    throw new Error(`rate-limit check failed: ${reviewErr.message}`);
  }

  if ((reviewCount ?? 0) >= PER_REVIEW_LIMIT) {
    throw new RateLimitError(
      "per_review_hour",
      PER_REVIEW_LIMIT,
      PER_REVIEW_WINDOW_MIN
    );
  }

  const shopWindowStart = new Date(
    Date.now() - PER_SHOP_WINDOW_MIN * 60 * 1000
  ).toISOString();

  const { count: shopCount, error: shopErr } = await service
    .from("llm_call_log")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", input.shopId)
    .gte("created_at", shopWindowStart);

  if (shopErr) {
    throw new Error(`rate-limit check failed: ${shopErr.message}`);
  }

  if ((shopCount ?? 0) >= PER_SHOP_LIMIT) {
    throw new RateLimitError(
      "per_shop_day",
      PER_SHOP_LIMIT,
      PER_SHOP_WINDOW_MIN
    );
  }
}
