import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type Props = {
  searchParams: Promise<{ result?: string }>;
};

type AliasCandidate = {
  source_label_normalized: string;
  source_label_name: string;
  source_shop_count: number;
  repair_orders: number;
  repair_value_cents: number;
  latest_arrival_date: string | null;
};

type ShopCandidate = {
  source_shop_key: string;
  source_shop_name: string;
  repair_orders: number;
  repair_orders_2026: number;
  latest_arrival_date: string | null;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const notices: Record<string, string> = {
  approved: "Insurer alias approved and applied to canonical reporting.",
  rejected: "Insurer alias rejected; the source label remains separate.",
  conflict:
    "This label was reviewed by someone else. The queue has been refreshed.",
  error: "The review could not be saved. No alias decision was changed.",
};

export default async function CollisionDataReviewPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getDashboardAccess(user.id);
  if (access.role !== "psg_superadmin") redirect("/dashboard");

  const service = createServiceClient();
  const [aliasResult, shopResult, params] = await Promise.all([
    service
      .from("v_collision_insurer_alias_review_queue")
      .select(
        "source_label_normalized,source_label_name,source_shop_count,repair_orders,repair_value_cents,latest_arrival_date",
      )
      .eq("review_status", "candidate")
      .order("repair_orders", { ascending: false })
      .limit(20),
    service
      .from("v_collision_filemaker_shop_summary")
      .select(
        "source_shop_key,source_shop_name,repair_orders,repair_orders_2026,latest_arrival_date",
      )
      .is("shop_id", null)
      .order("repair_orders", { ascending: false })
      .limit(8),
    searchParams,
  ]);

  if (aliasResult.error || shopResult.error) {
    throw new Error(
      aliasResult.error?.message ??
        shopResult.error?.message ??
        "Review queue failed",
    );
  }

  const aliases = (aliasResult.data ?? []) as AliasCandidate[];
  const shops = (shopResult.data ?? []) as ShopCandidate[];
  const notice = params.result ? notices[params.result] : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Collision intelligence
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Data review</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Approve carrier aliases only after identity review. Carrier-tagged
          repair volume is not insurer claim volume. Shop mappings are
          evidence-only here because approval changes tenant-visible repair
          history.
        </p>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-md border border-border bg-secondary/40 p-3 text-sm"
        >
          {notice}
        </div>
      ) : null}

      <section aria-labelledby="alias-review-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="alias-review-heading" className="text-lg font-semibold">
              Highest-volume insurer labels
            </h2>
            <p className="text-sm text-muted-foreground">
              A decision applies to the normalized source label across all
              shops.
            </p>
          </div>
          <Badge variant="warning">Manual review required</Badge>
        </div>

        {aliases.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {aliases.map((alias) => (
              <Card key={alias.source_label_normalized}>
                <CardHeader>
                  <CardTitle>{alias.source_label_name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Source key: {alias.source_label_normalized}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <ReviewMetric
                      label="Repair orders"
                      value={alias.repair_orders.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Repair value"
                      value={currency.format(alias.repair_value_cents / 100)}
                    />
                    <ReviewMetric
                      label="Source shops"
                      value={alias.source_shop_count.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Latest arrival"
                      value={alias.latest_arrival_date ?? "Unknown"}
                    />
                  </div>

                  <form
                    action="/api/collision-intelligence/insurer-alias-review"
                    method="post"
                    className="space-y-3"
                  >
                    <input
                      type="hidden"
                      name="source_label_normalized"
                      value={alias.source_label_normalized}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-medium">
                        Canonical key
                        <input
                          name="canonical_insurer_key"
                          required
                          maxLength={200}
                          pattern="[a-z0-9]+( [a-z0-9]+)*"
                          placeholder="state farm"
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                        />
                      </label>
                      <label className="text-sm font-medium">
                        Canonical name
                        <input
                          name="canonical_insurer_name"
                          required
                          maxLength={200}
                          placeholder="State Farm"
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                        />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">
                      Review notes
                      <textarea
                        name="review_notes"
                        maxLength={1000}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        name="action"
                        value="approve"
                        className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground"
                      >
                        Approve alias
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value="reject"
                        formNoValidate
                        className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium"
                      >
                        Keep separate
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent>No candidate insurer labels remain.</CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="shop-review-heading" className="space-y-3">
        <div>
          <h2 id="shop-review-heading" className="text-lg font-semibold">
            Unmapped source shops
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only evidence. Confirm legal and operating identity before any
            mapping.
          </p>
        </div>
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-3 pr-4">
                      Source shop
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Repair orders
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      2026 repairs
                    </th>
                    <th scope="col" className="pb-3">
                      Latest arrival
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shops.map((shop) => (
                    <tr key={shop.source_shop_key}>
                      <td className="py-3 pr-4">
                        <p className="font-medium">{shop.source_shop_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {shop.source_shop_key}
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        {shop.repair_orders.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        {shop.repair_orders_2026.toLocaleString()}
                      </td>
                      <td className="py-3">
                        {shop.latest_arrival_date ?? "Unknown"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading font-semibold">{value}</p>
    </div>
  );
}
