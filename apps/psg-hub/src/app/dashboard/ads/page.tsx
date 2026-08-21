import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  getRiversideAnalyticsPreviewShop,
  isRiversideDemoUser,
  shouldUseRiversideQaRoutingFallback,
  type SupabaseShopLookup,
} from "@/lib/bsm/riverside-analytics-demo";
import { getActiveShopContext } from "@/lib/shop/context";
import { shopHasTier } from "@/lib/tier/gate";
import { TierGateCard } from "./tier-gate-card";
import { AccountsTable } from "./accounts-table";
import type { ShopRole } from "@/lib/ads/view-state";

type Props = {
  searchParams: Promise<{ shop_id?: string }>;
};

export default async function AdsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let shopId = params.shop_id;
  let previewShopId: string | null = null;
  if (!shopId) {
    const { activeShopId } = await getActiveShopContext(
      user.id,
      isRiversideDemoUser(user.email) ? RIVERSIDE_ANALYTICS_DEMO_SHOP.name : null,
    );
    shopId = activeShopId ?? undefined;
    if (!shopId) {
      const requestHost = (await headers()).get("host");
      if (
        !shouldUseRiversideQaRoutingFallback({
          userEmail: user.email,
          requestHost,
        })
      ) {
        redirect("/dashboard");
      }
      const service = createServiceClient() as unknown as SupabaseShopLookup;
      const previewShop = await getRiversideAnalyticsPreviewShop(service, {
        userEmail: user.email,
        activeShopName: null,
        requestHost,
      });
      shopId = previewShop?.id;
      previewShopId = previewShop?.id ?? null;
    }
    if (!shopId) {
      redirect("/dashboard");
    }
    redirect(`/dashboard/ads?shop_id=${shopId}`);
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  let resolvedMembership = membership;
  let adsReader = supabase;
  if (!resolvedMembership) {
    const requestHost = (await headers()).get("host");
    if (
      !shouldUseRiversideQaRoutingFallback({
        userEmail: user.email,
        requestHost,
      })
    ) {
      redirect("/dashboard");
    }
    const service = createServiceClient();
    const previewShop = await getRiversideAnalyticsPreviewShop(
      service as unknown as SupabaseShopLookup,
      {
        userEmail: user.email,
        activeShopName: null,
        requestHost,
      },
    );
    previewShopId = previewShop?.id ?? previewShopId;
    if (previewShopId !== shopId) {
      redirect("/dashboard");
    }
    resolvedMembership = { role: "owner" };
    adsReader = service;
  }

  // Tier check: shared gate (Performance subscription OR override allowlist).
  if (!(await shopHasTier(shopId, "performance"))) {
    return <TierGateCard shopId={shopId} />;
  }

  // Phase 10 / 10-01: the Google Ads tables are now provisioned (migration
  // 20260608000000), so surface the real accounts state. Read via the
  // user-session client — RLS (google_ads_accounts_select: shop_id IN
  // user_shop_ids()) clamps tenancy. An unlinked shop gets the empty state +
  // "Link Google Ads" CTA from <AccountsTable>. Campaign metrics ingest + the
  // campaign management view land in 10-02; campaign MUTATION stays out of scope
  // (v1.2 Ads Mutation Studio, D52/D66 — Python on Vercel Sandbox).
  const { data: accounts } = await adsReader
    .from("google_ads_accounts")
    .select("id, customer_id, status, linked_at, last_error")
    .eq("shop_id", shopId)
    .order("linked_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Google Ads</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Google Ads account to bring paid performance into your
          analytics.
        </p>
      </div>
      <AccountsTable
        accounts={accounts ?? []}
        shopId={shopId}
        userRole={resolvedMembership.role as ShopRole}
      />
    </div>
  );
}
