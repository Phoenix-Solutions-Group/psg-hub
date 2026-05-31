import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { AdsApiError } from "./types";

function overrideAllowlist(): Set<string> {
  const raw = process.env.SHOP_ADS_TIER_OVERRIDE ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

export async function assertAdsTier(shopId: string): Promise<void> {
  const service = createServiceClient();

  const { data: shop, error: shopErr } = await service
    .from("shops")
    .select("id, slug")
    .eq("id", shopId)
    .maybeSingle();

  if (shopErr) {
    throw new AdsApiError("upstream", `shop lookup failed: ${shopErr.message}`);
  }
  if (!shop) {
    throw new AdsApiError("shop_preflight_failed", "shop not found");
  }

  if (shop.slug && overrideAllowlist().has(shop.slug)) {
    return;
  }

  const { data: sub } = await service
    .from("subscriptions")
    .select("tier, status")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (sub && sub.status === "active" && sub.tier === "performance") {
    return;
  }

  throw new AdsApiError(
    "tier_required",
    "Performance tier required for Google Ads"
  );
}
