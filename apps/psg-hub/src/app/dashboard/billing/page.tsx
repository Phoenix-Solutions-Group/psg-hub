import { createClient } from "@/lib/supabase/server";
import { PricingCard } from "@/components/dashboard/pricing-card";
import { Badge } from "@/components/ui/badge";
import { UpgradeBanner } from "./upgrade-banner";

const TIERS = [
  {
    name: "Essentials",
    price: 199,
    tier: "essentials",
    features: [
      "1 location",
      "5 AI marketing agents",
      "Weekly content production",
      "SEO monitoring and audits",
      "Content preview and approval",
      "Basic analytics",
    ],
  },
  {
    name: "Growth",
    price: 499,
    tier: "growth",
    features: [
      "2 locations",
      "5 AI marketing agents",
      "Daily content production",
      "SEO + reputation monitoring",
      "Content preview and approval",
      "Advanced analytics",
      "Priority support",
    ],
  },
  {
    name: "Performance",
    price: 999,
    tier: "performance",
    features: [
      "Everything in Growth",
      "Google Ads campaigns with collision-repair templates",
      "AI review responses with approval gate",
      "Reputation monitoring across Google and Yelp",
      "Priority support",
    ],
  },
];

type Props = {
  searchParams: Promise<{ success?: string }>;
};

export default async function BillingPage({ searchParams }: Props) {
  const supabase = await createClient();
  const params = await searchParams;
  const justReturnedFromStripe = params.success === "true";

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("tier, status, current_period_end")
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription and billing.
        </p>
      </div>

      {justReturnedFromStripe && (
        <UpgradeBanner currentTier={subscription?.tier} />
      )}

      {subscription && (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span className="text-sm font-medium">Current plan:</span>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {subscription.tier}
          </Badge>
          <Badge
            variant="secondary"
            className={
              subscription.status === "active"
                ? "bg-green-100 text-green-800"
                : "bg-yellow-100 text-yellow-800"
            }
          >
            {subscription.status}
          </Badge>
          {subscription.current_period_end && (
            <span className="text-xs text-muted-foreground">
              Renews{" "}
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier.tier} id={tier.tier} className="scroll-mt-20">
            <PricingCard
              {...tier}
              current={subscription?.tier === tier.tier}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
