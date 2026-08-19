import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  isRiversideDemoUser,
  shouldShowRiversideAnalyticsPreviewMetrics,
} from "@/lib/bsm/riverside-analytics-demo";
import { getActiveShopContext } from "@/lib/shop/context";
import { shopHasTier } from "@/lib/tier/gate";
import { TierGateCard } from "./tier-gate-card";
import { AccountsTable } from "./accounts-table";
import type { ShopRole } from "@/lib/ads/view-state";

type Props = {
  searchParams: Promise<{ shop_id?: string }>;
};

function RiversideGoogleAdsDemo() {
  return (
    <div className="space-y-6" data-testid="riverside-google-ads-demo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Riverside Collision Google Ads</h2>
          <p className="text-sm text-muted-foreground">Private review data for the approved Riverside demo.</p>
        </div>
        <Badge className="bg-green-100 text-green-800">Connected</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm">30-day spend</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">$4,860</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Leads</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">54</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Cost per lead</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">$90</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Collision Repair Search — Riverside</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Enabled · 1,284 clicks · 54 leads</p></CardContent>
      </Card>
    </div>
  );
}

export default async function AdsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Resolve shop_id: an explicit param wins (and is membership-validated below);
  // otherwise default to the active-shop context (07-03) so a switched shop is
  // honored here instead of reverting to owner-first. The cookie only SELECTS
  // among authorized shops — it never authorizes.
  const shopId = params.shop_id;
  if (!shopId) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (!activeShopId) {
      redirect("/dashboard");
    }
    redirect(`/dashboard/ads?shop_id=${activeShopId}`);
  }

  // Load role for this shop
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    redirect("/dashboard");
  }

  // Tier check: shared gate (Performance subscription OR override allowlist).
  if (!(await shopHasTier(shopId, "performance"))) {
    return <TierGateCard shopId={shopId} />;
  }

  const requestHost = (await headers()).get("host");
  const useRiversideDemo = shouldShowRiversideAnalyticsPreviewMetrics({
    userEmail: user.email,
    requestHost,
  });
  if (useRiversideDemo) {
    const service = createServiceClient();
    const { data: riversideShop } = await service
      .from("shops")
      .select("id")
      .eq("slug", RIVERSIDE_ANALYTICS_DEMO_SHOP.slug)
      .maybeSingle();

    if ((riversideShop as { id?: string } | null)?.id === shopId) {
      return <RiversideGoogleAdsDemo />;
    }
  }

  // Phase 10 / 10-01: the Google Ads tables are now provisioned (migration
  // 20260608000000), so surface the real accounts state. Read via the
  // user-session client — RLS (google_ads_accounts_select: shop_id IN
  // user_shop_ids()) clamps tenancy. An unlinked shop gets the empty state +
  // "Link Google Ads" CTA from <AccountsTable>. Campaign metrics ingest + the
  // campaign management view land in 10-02; campaign MUTATION stays out of scope
  // (v1.2 Ads Mutation Studio, D52/D66 — Python on Vercel Sandbox).
  const { data: accounts } = await supabase
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
        userRole={membership.role as ShopRole}
      />
    </div>
  );
}
