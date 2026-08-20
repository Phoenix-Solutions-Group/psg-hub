import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { shopHasTier } from "@/lib/tier/gate";
import { TierGateCard } from "./tier-gate-card";
import { AccountsTable } from "./accounts-table";
import { CustomerRequestActions } from "./customer-request-actions";
import type { ShopRole } from "@/lib/ads/view-state";

type Props = {
  searchParams: Promise<{ shop_id?: string }>;
};

type CampaignRow = {
  id: string;
  name: string;
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

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  const shopId = params.shop_id;
  if (!shopId) {
    if (!activeShopId) {
      redirect("/dashboard");
    }
    redirect(`/dashboard/ads?shop_id=${activeShopId}`);
  }

  // getActiveShopContext enumerates memberships with the service client, then
  // constrains selection to those memberships. shop_users is RLS default-deny,
  // so querying it again with the user client incorrectly rejects valid owners.
  const membership = shops.find((shop) => shop.id === shopId);

  if (!membership) {
    redirect("/dashboard");
  }

  if (!(await shopHasTier(shopId, "performance"))) {
    return <TierGateCard shopId={shopId} />;
  }

  const [{ data: accounts }, { data: campaigns }] = await Promise.all([
    supabase
      .from("google_ads_accounts")
      .select("id, customer_id, status, linked_at, last_error")
      .eq("shop_id", shopId)
      .order("linked_at", { ascending: false }),
    supabase
      .from("google_ads_campaigns")
      .select("id, name")
      .eq("shop_id", shopId)
      .neq("status", "removed")
      .order("name"),
  ]);

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
      {(accounts?.length ?? 0) > 0 ? (
        <section aria-labelledby="request-heading" className="space-y-4">
          <h2 id="request-heading" className="text-lg font-semibold">
            Ask PSG for help
          </h2>
          <div className="rounded-md border border-border p-4">
            <CustomerRequestActions
              shopId={shopId}
              campaigns={((campaigns ?? []) as CampaignRow[]).map((campaign) => ({
                id: campaign.id,
                name: campaign.name,
              }))}
              canSubmit={["owner", "manager"].includes(membership.role)}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
