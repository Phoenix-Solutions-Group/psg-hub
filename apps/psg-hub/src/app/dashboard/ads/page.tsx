import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { shopHasTier } from "@/lib/tier/gate";
import { TierGateCard } from "./tier-gate-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    return <TierGateCard />;
  }

  // Shop name for the "coming soon" copy below.
  const service = createServiceClient();
  const { data: shop } = await service
    .from("shops")
    .select("id, name")
    .eq("id", shopId)
    .maybeSingle();

  // Tier passed. Google Ads analytics (accounts, campaigns, metrics) is deferred to
  // v0.3 — the underlying ad-platform tables are not yet provisioned. Guard the surface
  // so a tiered shop sees a clear "coming soon" state instead of a phantom-table error.
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Google Ads</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Google Ads analytics and campaign management arrive in a later
            release for {shop?.name ?? "your shop"}. Your subscription already
            includes this; we will enable it here when it ships.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
