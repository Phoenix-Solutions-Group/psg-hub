import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TierGateCard } from "./tier-gate-card";
import { AccountsTable } from "./accounts-table";
import { CampaignsSection } from "./campaigns-section";
import type { ShopRole } from "@/lib/ads/view-state";

const DEFAULT_MAX_MICROS = 500_000_000;

function envMaxMicros(): number {
  const v = process.env.ADS_MAX_DAILY_MICROS;
  if (!v) return DEFAULT_MAX_MICROS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MICROS;
}

function overrideAllowlist(): Set<string> {
  const raw = process.env.SHOP_ADS_TIER_OVERRIDE ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

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

  // Resolve shop_id: explicit param, else pick best membership (owner first).
  let shopId = params.shop_id;
  if (!shopId) {
    const { data: memberships } = await supabase
      .from("shop_members")
      .select("shop_id, role")
      .eq("profile_id", user.id);
    if (!memberships || memberships.length === 0) {
      redirect("/dashboard");
    }
    const owner = memberships.find((m) => m.role === "owner");
    shopId = (owner ?? memberships[0]).shop_id as string;
    redirect(`/ads?shop_id=${shopId}`);
  }

  // Load role for this shop
  const { data: membership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("profile_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    redirect("/dashboard");
  }

  const role = membership.role as ShopRole;

  // Tier check: Performance subscription OR SHOP_ADS_TIER_OVERRIDE allowlist
  const service = createServiceClient();
  const { data: shop } = await service
    .from("shops")
    .select("id, slug, name, max_daily_ad_budget_micros")
    .eq("id", shopId)
    .maybeSingle();

  const overrideTiered = shop?.slug
    ? overrideAllowlist().has(shop.slug)
    : false;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tier, status")
    .eq("shop_id", shopId)
    .maybeSingle();

  const tiered =
    overrideTiered ||
    (sub?.tier === "performance" && sub?.status === "active");

  if (!tiered) {
    return <TierGateCard />;
  }

  // Tier passed: load accounts + campaigns
  const accountsP = supabase
    .from("google_ads_accounts")
    .select("id, customer_id, status, linked_at, last_error")
    .eq("shop_id", shopId)
    .order("linked_at", { ascending: false });
  const campaignsP = supabase
    .from("google_ads_campaigns")
    .select(
      "id, external_resource_name, external_id, name, template_id, status, daily_budget_micros, metrics, metrics_synced_at, updated_at"
    )
    .eq("shop_id", shopId)
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(50);

  const [{ data: accounts }, { data: campaigns }] = await Promise.all([
    accountsP,
    campaignsP,
  ]);

  const maxDailyMicros =
    (shop?.max_daily_ad_budget_micros as number | null | undefined) ??
    envMaxMicros();

  const hasLinkedAccount = (accounts ?? []).some(
    (a) => a.status === "linked"
  );

  return (
    <div className="space-y-8">
      <AccountsTable
        accounts={accounts ?? []}
        shopId={shopId}
        userRole={role}
      />
      {hasLinkedAccount && (
        <CampaignsSection
          shopId={shopId}
          shopName={shop?.name ?? "Your shop"}
          userRole={role}
          campaigns={
            (campaigns ?? []) as unknown as Parameters<
              typeof CampaignsSection
            >[0]["campaigns"]
          }
          maxDailyMicros={maxDailyMicros}
        />
      )}
    </div>
  );
}
