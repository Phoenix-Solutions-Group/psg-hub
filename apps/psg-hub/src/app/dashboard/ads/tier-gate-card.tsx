import Link from "next/link";

type Props = {
  shopId: string;
};

export function TierGateCard({ shopId }: Props) {
  return (
    <div className="rounded-md border bg-card p-6">
      <h2 className="text-lg font-semibold">Performance tier required</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Google Ads campaigns are part of the Performance plan. Upgrade to run
        collision-repair campaigns with templates, budgets, and a human
        approval gate.
      </p>
      <Link
        href={`/dashboard/billing?shop_id=${encodeURIComponent(shopId)}#performance`}
        className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Upgrade to Performance
      </Link>
    </div>
  );
}
