import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMissingReviewView } from "./source-health";

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

type ApprovedInsurer = {
  canonical_insurer_key: string | null;
  canonical_insurer_name: string | null;
};

type InsuranceCompany = {
  id: string;
  name: string;
};

type InsurerOption = {
  label: string;
  value: string;
};

type ShopCandidate = {
  source_shop_key: string;
  source_shop_name: string;
  repair_orders: number;
  repair_orders_2026: number;
  latest_arrival_date: string | null;
};

type HubShop = {
  id: string;
  name: string | null;
  slug: string | null;
};

type RepairSourceHealth = {
  row_count: number;
  accepted_count: number;
  rejected_count: number;
  arrival_max: string | null;
};

type RepairFeedHealth = {
  is_stale: boolean;
};

type StormSourceHealth = {
  event_rows: number | null;
  is_reconciled: boolean;
};

type CrashSourceHealth = {
  min_source_year: number;
  max_source_year: number;
  imported_row_count: number;
  zip_matched_row_count: number;
  last_sync_status: string;
};

type ForecastHealth = {
  is_ready: boolean;
  readiness_status: string;
  generated_at: string | null;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const notices: Record<string, string> = {
  approved:
    "Insurer matched. Reports will now group this imported label under the selected standard name.",
  rejected:
    "Imported label left ungrouped. Reports will continue to show it separately.",
  conflict:
    "This label was reviewed by someone else. The queue has been refreshed.",
  error: "The review could not be saved. No alias decision was changed.",
  target_missing:
    "That standard insurer is no longer available. Choose another match.",
  mapping_approved:
    "Shop mapping approved. Its repair history is now available to authorized members of that PSG Hub shop.",
  mapping_conflict:
    "The source or target shop was mapped by someone else. The queue has been refreshed.",
  mapping_error: "The shop mapping could not be saved. No mapping was changed.",
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
  const [
    aliasResult,
    approvedInsurerResult,
    insuranceCompanyResult,
    shopResult,
    hubShopResult,
    mappedShopResult,
    repairSourceResult,
    repairFeedResult,
    stormSourceResult,
    crashSourceResult,
    forecastResult,
    params,
  ] = await Promise.all([
    service
      .from("v_collision_insurer_alias_review_queue")
      .select(
        "source_label_normalized,source_label_name,source_shop_count,repair_orders,repair_value_cents,latest_arrival_date",
      )
      .eq("review_status", "candidate")
      .order("repair_orders", { ascending: false })
      .limit(20),
    service
      .from("collision_insurer_alias_reviews")
      .select("canonical_insurer_key,canonical_insurer_name")
      .eq("review_status", "approved")
      .order("canonical_insurer_name", { ascending: true }),
    service.from("insurance_companies").select("id,name").order("name"),
    service
      .from("v_collision_filemaker_shop_summary")
      .select(
        "source_shop_key,source_shop_name,repair_orders,repair_orders_2026,latest_arrival_date",
      )
      .is("shop_id", null)
      .order("repair_orders_2026", { ascending: false })
      .order("latest_arrival_date", { ascending: false })
      .order("repair_orders", { ascending: false }),
    service
      .from("shops")
      .select("id,name,slug")
      .order("name", { ascending: true }),
    service
      .from("collision_shop_mappings")
      .select("shop_id")
      .eq("mapping_status", "mapped"),
    service
      .from("collision_repair_sources")
      .select("row_count,accepted_count,rejected_count,arrival_max")
      .eq("status", "loaded")
      .order("imported_at", { ascending: false })
      .limit(1),
    service.from("v_collision_repair_feed_status").select("is_stale"),
    service
      .from("v_collision_storm_source_reconciliation")
      .select("event_rows,is_reconciled"),
    service
      .from("ksdot_crash_sources")
      .select(
        "min_source_year,max_source_year,imported_row_count,zip_matched_row_count,last_sync_status",
      )
      .order("imported_at", { ascending: false })
      .limit(1),
    service
      .from("v_collision_forecast_readiness")
      .select("is_ready,readiness_status,generated_at")
      .order("generated_at", { ascending: false, nullsFirst: false }),
    searchParams,
  ]);

  const stormHealthUnavailable = isMissingReviewView(
    stormSourceResult.error,
    "v_collision_storm_source_reconciliation",
  );
  const forecastHealthUnavailable = isMissingReviewView(
    forecastResult.error,
    "v_collision_forecast_readiness",
  );

  if (
    aliasResult.error ||
    approvedInsurerResult.error ||
    insuranceCompanyResult.error ||
    shopResult.error ||
    hubShopResult.error ||
    mappedShopResult.error ||
    repairSourceResult.error ||
    repairFeedResult.error ||
    (stormSourceResult.error && !stormHealthUnavailable) ||
    crashSourceResult.error ||
    (forecastResult.error && !forecastHealthUnavailable)
  ) {
    throw new Error(
      aliasResult.error?.message ??
        approvedInsurerResult.error?.message ??
        insuranceCompanyResult.error?.message ??
        shopResult.error?.message ??
        hubShopResult.error?.message ??
        mappedShopResult.error?.message ??
        repairSourceResult.error?.message ??
        repairFeedResult.error?.message ??
        stormSourceResult.error?.message ??
        crashSourceResult.error?.message ??
        forecastResult.error?.message ??
        "Review queue failed",
    );
  }

  const aliases = (aliasResult.data ?? []) as AliasCandidate[];
  const insurerOptionsByName = new Map<string, InsurerOption>();
  for (const insurer of (insuranceCompanyResult.data ??
    []) as InsuranceCompany[]) {
    insurerOptionsByName.set(insurer.name.trim().toLocaleLowerCase(), {
      label: insurer.name.trim(),
      value: `master:${insurer.id}`,
    });
  }
  for (const insurer of (approvedInsurerResult.data ??
    []) as ApprovedInsurer[]) {
    const key = insurer.canonical_insurer_key?.trim();
    const name = insurer.canonical_insurer_name?.trim();
    if (!key || !name) continue;
    const normalizedName = name.toLocaleLowerCase();
    if (!insurerOptionsByName.has(normalizedName)) {
      insurerOptionsByName.set(normalizedName, {
        label: name,
        value: `approved:${key}`,
      });
    }
  }
  const insurerOptions = [...insurerOptionsByName.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const shops = (shopResult.data ?? []) as ShopCandidate[];
  const featuredShops = shops.slice(0, 8);
  const mappedShopIds = new Set(
    (mappedShopResult.data ?? []).map((row) => row.shop_id as string),
  );
  const availableHubShops = ((hubShopResult.data ?? []) as HubShop[]).filter(
    (shop) => !mappedShopIds.has(shop.id),
  );
  const repairSource = (repairSourceResult.data?.[0] ??
    null) as RepairSourceHealth | null;
  const repairFeeds = (repairFeedResult.data ?? []) as RepairFeedHealth[];
  const stormSources = (stormSourceResult.data ?? []) as StormSourceHealth[];
  const crashSource = (crashSourceResult.data?.[0] ??
    null) as CrashSourceHealth | null;
  const forecasts = (forecastResult.data ?? []) as ForecastHealth[];
  const staleRepairFeeds = repairFeeds.filter((feed) => feed.is_stale).length;
  const unreconciledStormSources = stormSources.filter(
    (source) => !source.is_reconciled,
  ).length;
  const stormEvents = stormSources.reduce(
    (total, source) => total + (source.event_rows ?? 0),
    0,
  );
  const readyForecasts = forecasts.filter(
    (forecast) => forecast.is_ready,
  ).length;
  const forecastGateStates = [
    ...new Set(
      forecasts
        .filter((forecast) => !forecast.is_ready)
        .map((forecast) => forecast.readiness_status.replaceAll("_", " ")),
    ),
  ].join(", ");
  const latestForecast = forecasts.find((forecast) => forecast.generated_at);
  const crashZipMatchPct =
    crashSource && crashSource.imported_row_count
      ? (crashSource.zip_matched_row_count / crashSource.imported_row_count) *
        100
      : null;
  const notice = params.result ? notices[params.result] : null;

  return (
    <div className="space-y-6">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Data quality &amp; matching
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Prepare imported collision data before it appears in shop reports.
          Match FileMaker insurer labels to a standard insurer name, connect
          imported shops to PSG Hub, and check whether each data feed is ready.
          Nothing is merged automatically, and every saved decision is audited.
        </p>
        <div className="mt-4 rounded-lg bg-secondary/50 p-4 text-sm leading-6">
          <p className="font-heading font-semibold">What changes here</p>
          <p className="mt-1 text-muted-foreground">
            Insurer matches change how carrier-tagged repair orders are grouped
            in reports. Shop matches change which authorized users can see the
            imported repair history. These are repair records—not insurer claim
            counts.
          </p>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-md border border-border bg-secondary/40 p-3 text-sm"
        >
          {notice}
        </div>
      ) : null}

      <section aria-labelledby="source-health-heading" className="space-y-3">
        <div>
          <h2 id="source-health-heading" className="text-lg font-semibold">
            Data feed status
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only checks showing whether repair, crash, weather, and
            forecast data are current and traceable.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SourceHealthCard
            title="Repair source"
            status={
              !repairSource
                ? "Not loaded"
                : !repairFeeds.length
                  ? "No mapped feed"
                  : staleRepairFeeds
                    ? "Stale"
                    : "Current"
            }
            healthy={Boolean(
              repairSource && repairFeeds.length && !staleRepairFeeds,
            )}
          >
            <ReviewMetric
              label="Accepted / source rows"
              value={
                repairSource
                  ? `${repairSource.accepted_count.toLocaleString()} / ${repairSource.row_count.toLocaleString()}`
                  : "—"
              }
            />
            <ReviewMetric
              label="Rejected"
              value={repairSource?.rejected_count.toLocaleString() ?? "—"}
            />
            <ReviewMetric
              label="Latest arrival"
              value={repairSource?.arrival_max ?? "—"}
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="Storm provenance"
            status={
              stormHealthUnavailable
                ? "Release pending"
                : !stormSources.length
                  ? "No batches"
                  : unreconciledStormSources
                    ? "Unreconciled"
                    : "Reconciled"
            }
            healthy={Boolean(stormSources.length && !unreconciledStormSources)}
          >
            <ReviewMetric
              label="Event rows"
              value={
                stormHealthUnavailable ? "—" : stormEvents.toLocaleString()
              }
            />
            <ReviewMetric
              label="Source batches"
              value={
                stormHealthUnavailable
                  ? "—"
                  : stormSources.length.toLocaleString()
              }
            />
            <ReviewMetric
              label="Unreconciled"
              value={
                stormHealthUnavailable
                  ? "—"
                  : unreconciledStormSources.toLocaleString()
              }
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="KDOT crashes"
            status={crashSource?.last_sync_status ?? "Not loaded"}
            healthy={crashSource?.last_sync_status === "loaded"}
          >
            <ReviewMetric
              label="Imported rows"
              value={crashSource?.imported_row_count.toLocaleString() ?? "—"}
            />
            <ReviewMetric
              label="ZIP matched"
              value={
                crashZipMatchPct === null
                  ? "—"
                  : `${crashZipMatchPct.toFixed(2)}%`
              }
            />
            <ReviewMetric
              label="Coverage"
              value={
                crashSource
                  ? `${crashSource.min_source_year}–${crashSource.max_source_year}`
                  : "—"
              }
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="Forecast readiness"
            status={
              forecastHealthUnavailable
                ? "Release pending"
                : !forecasts.length
                  ? "No mapped shops"
                  : readyForecasts === forecasts.length
                    ? "Ready"
                    : "Gated"
            }
            healthy={Boolean(
              forecasts.length && readyForecasts === forecasts.length,
            )}
          >
            <ReviewMetric
              label="Shop / horizon policies"
              value={
                forecastHealthUnavailable
                  ? "—"
                  : forecasts.length.toLocaleString()
              }
            />
            <ReviewMetric
              label="Ready"
              value={
                forecastHealthUnavailable
                  ? "—"
                  : readyForecasts.toLocaleString()
              }
            />
            <ReviewMetric
              label="Gate states"
              value={
                forecastHealthUnavailable
                  ? "Release migration not applied"
                  : forecastGateStates || "None"
              }
            />
            <ReviewMetric
              label="Last generated"
              value={
                latestForecast?.generated_at
                  ? dateTime.format(new Date(latestForecast.generated_at))
                  : "—"
              }
            />
          </SourceHealthCard>
        </div>
      </section>

      <section aria-labelledby="alias-review-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="alias-review-heading" className="text-lg font-semibold">
              Match imported insurer names
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              FileMaker may use several names for the same insurer. For each
              imported label, choose an existing standard name or establish the
              exact displayed name as a new standard. The decision applies to
              this label across every source shop.
            </p>
          </div>
          <Badge variant="warning">Decision required</Badge>
        </div>

        {aliases.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {aliases.map((alias) => (
              <Card key={alias.source_label_normalized}>
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="text-lg">
                    {alias.source_label_name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Imported label used on repair orders. Review it before
                    grouping it with another insurer.
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
                    <label className="block text-sm font-medium">
                      How should reports name this insurer?
                      <select
                        name="canonical_target"
                        required
                        defaultValue=""
                        aria-describedby={`insurer-match-help-${alias.source_label_normalized}`}
                        className="mt-1 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 font-normal"
                      >
                        <option value="" disabled>
                          Select a verified reporting name
                        </option>
                        <optgroup label="Start a new standard name">
                          <option value="source">
                            Use “{alias.source_label_name}” as the standard
                          </option>
                        </optgroup>
                        {insurerOptions.length ? (
                          <optgroup label="Match an existing standard name">
                            {insurerOptions.map((insurer) => (
                              <option key={insurer.value} value={insurer.value}>
                                {insurer.label}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    </label>
                    <p
                      id={`insurer-match-help-${alias.source_label_normalized}`}
                      className="text-xs leading-5 text-muted-foreground"
                    >
                      Choose an existing name whenever it is the same legal
                      insurer. Start a new standard only when the imported name
                      above is the complete name reports should use.
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Can’t find the right insurer? Add it to the{" "}
                      <Link
                        href="/ops/sys-config/insurance-companies"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        insurer master list
                      </Link>{" "}
                      first, then return here.
                    </p>
                    <label className="block text-sm font-medium">
                      Decision notes{" "}
                      <span className="font-normal">(optional)</span>
                      <textarea
                        name="review_notes"
                        maxLength={1000}
                        rows={2}
                        placeholder="Record the evidence used to confirm this match."
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
                        Save insurer match
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value="reject"
                        formNoValidate
                        className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium"
                      >
                        Leave ungrouped
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground">
              Every imported insurer label has a saved decision.
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="shop-review-heading" className="space-y-3">
        <div>
          <h2 id="shop-review-heading" className="text-lg font-semibold">
            Connect imported shops
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Match a FileMaker shop to its existing PSG Hub account. The eight
            highest-current-volume candidates are shown below; every unmatched
            shop remains available in the selector. Confirm the exact legal and
            operating identity before connecting repair history.
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
                  {featuredShops.map((shop) => (
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
            <form
              action="/api/collision-intelligence/shop-mapping-review"
              method="post"
              className="mt-6 space-y-4 border-t border-border pt-5"
            >
              <div>
                <h3 className="font-heading font-semibold">Connect one shop</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This makes the imported repair history visible to authorized
                  members of the selected PSG Hub shop. Each PSG Hub shop can
                  have only one active FileMaker connection.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium">
                  Imported FileMaker shop
                  <select
                    name="source_shop_key"
                    required
                    defaultValue=""
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                  >
                    <option value="" disabled>
                      Select a verified source shop
                    </option>
                    {shops.map((shop) => (
                      <option
                        key={shop.source_shop_key}
                        value={shop.source_shop_key}
                      >
                        {shop.source_shop_name} ({shop.source_shop_key})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Existing PSG Hub shop
                  <select
                    name="shop_id"
                    required
                    defaultValue=""
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                  >
                    <option value="" disabled>
                      Select the confirmed target shop
                    </option>
                    {availableHubShops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.name ?? shop.slug ?? shop.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium">
                Identity evidence
                <textarea
                  name="review_notes"
                  required
                  minLength={20}
                  maxLength={1000}
                  rows={3}
                  placeholder="Describe the signed agreement, customer confirmation, or other evidence used to verify this identity."
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="identity_confirmed"
                  value="confirmed"
                  required
                  className="mt-1"
                />
                <span>
                  I confirmed that these records belong to this exact legal and
                  operating shop—not a name-similar business.
                </span>
              </label>
              <button
                type="submit"
                disabled={!shops.length || !availableHubShops.length}
                className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Connect shop and repair history
              </button>
            </form>
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

function SourceHealthCard({
  title,
  status,
  healthy,
  children,
}: {
  title: string;
  status: string;
  healthy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant={healthy ? "success" : "warning"}>{status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
