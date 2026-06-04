import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Subscription tiers (BSM Stripe enum — no migration). Ranked low → high.
 */
export type Tier = "essentials" | "growth" | "performance";

export const TIER_RANK: Record<Tier, number> = {
  essentials: 1,
  growth: 2,
  performance: 3,
};

/**
 * True iff `current` is a known tier whose rank meets or exceeds `min`.
 * A null/undefined/unknown current tier never meets any minimum.
 */
export function tierMeets(
  current: Tier | null | undefined,
  min: Tier
): boolean {
  if (!current) return false;
  const currentRank = TIER_RANK[current];
  if (currentRank === undefined) return false; // DB value outside the union
  return currentRank >= TIER_RANK[min];
}

/**
 * Single source of the tier override allowlist (a CSV of shop slugs in
 * SHOP_ADS_TIER_OVERRIDE). An override-listed shop is treated as top tier
 * for any gate. Env name kept for backward compatibility with operator config.
 */
function overrideAllowlist(): Set<string> {
  const raw = process.env.SHOP_ADS_TIER_OVERRIDE ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

/**
 * Resolve a shop's effective tier state via the service client (RLS-bypass —
 * gating must not depend on a caller's RLS visibility). Does not throw on a
 * missing shop; returns a non-meeting state and lets callers decide.
 */
export async function getShopTier(
  shopId: string
): Promise<{ tier: Tier | null; active: boolean; overridden: boolean }> {
  const service = createServiceClient();

  const { data: shop } = await service
    .from("shops")
    .select("id, slug")
    .eq("id", shopId)
    .maybeSingle();

  if (!shop) {
    return { tier: null, active: false, overridden: false };
  }

  const overridden = !!shop.slug && overrideAllowlist().has(shop.slug);

  const { data: sub } = await service
    .from("subscriptions")
    .select("tier, status")
    .eq("shop_id", shopId)
    .maybeSingle();

  return {
    tier: (sub?.tier as Tier | undefined) ?? null,
    active: sub?.status === "active",
    overridden,
  };
}

/**
 * Boolean gate for a shop: passes if overridden, or if the subscription is
 * active and its tier meets `min`. Use in server components / pages.
 */
export async function shopHasTier(shopId: string, min: Tier): Promise<boolean> {
  const s = await getShopTier(shopId);
  return s.overridden || (s.active && tierMeets(s.tier, min));
}

/**
 * Assert a shop meets `min`, throwing on failure. Pass `makeError` to control
 * the thrown error type/message (e.g. an API error a route maps to an HTTP
 * status); defaults to a plain Error.
 */
export async function assertShopTier(
  shopId: string,
  min: Tier,
  makeError?: (message: string) => Error
): Promise<void> {
  if (!(await shopHasTier(shopId, min))) {
    const message = `${min} tier required`;
    throw makeError ? makeError(message) : new Error(message);
  }
}
