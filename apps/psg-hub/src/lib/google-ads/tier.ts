import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { shopHasTier } from "@/lib/tier/gate";
import { AdsApiError } from "./types";

export async function assertAdsTier(shopId: string): Promise<void> {
  const service = createServiceClient();

  // Preflight the shop for the two distinct error codes the ads routes map.
  const { data: shop, error: shopErr } = await service
    .from("shops")
    .select("id")
    .eq("id", shopId)
    .maybeSingle();

  if (shopErr) {
    throw new AdsApiError("upstream", `shop lookup failed: ${shopErr.message}`);
  }
  if (!shop) {
    throw new AdsApiError("shop_preflight_failed", "shop not found");
  }

  // Gate logic is shared; ads hard-gates on Performance.
  if (!(await shopHasTier(shopId, "performance"))) {
    throw new AdsApiError(
      "tier_required",
      "Performance tier required for Google Ads"
    );
  }
}
