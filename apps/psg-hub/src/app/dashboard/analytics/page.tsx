import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import {
  getSnapshots,
  getSnapshotsForShops,
} from "@/lib/analytics/snapshots";
import {
  aggregateByDate,
  latestSnapshot,
  latestSyncedAt,
  toSeries,
  formatShortDate,
  formatSyncedAt,
  formatNumber,
  trailingWindow,
  type DatedMetrics,
} from "@/lib/analytics/aggregate";
import {
  LineChartCard,
  BarChartCard,
  Sparkline,
} from "@/components/analytics/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// 09-02: the v0.3 analytics surface. Source-agnostic shell — SEMrush (09-03) is
// the first source; Google Ads / GA4 / GSC panels plug into the same snapshot
// model in Phases 10/11. UNGATED by tier (intentional — unlike ads' performance
// gate): all tiers see the surface; per-source gating is decided when each
// source lands. Cached snapshots only, no real-time — "Last synced" tells the
// story (ads-dashboard canon).

const WINDOW_DAYS = 30;
const SOURCE = "semrush" as const;
const PAID_SOURCE = "google_ads" as const;
const PERIOD = "daily" as const;

/** KPI definitions. Aggregate view drops authority_score — a summed score lies. */
const PER_SHOP_KPIS = [
  { key: "organic_traffic", label: "Organic traffic" },
  { key: "organic_keywords", label: "Keywords ranked" },
  { key: "authority_score", label: "Authority score" },
  { key: "backlinks", label: "Backlinks" },
] as const;
const AGGREGATE_KPIS = [
  { key: "organic_traffic", label: "Organic traffic" },
  { key: "organic_keywords", label: "Keywords ranked" },
  { key: "organic_traffic_cost", label: "Traffic value (USD)" },
  { key: "backlinks", label: "Backlinks" },
] as const;

/** Paid (Google Ads) KPIs — Phase 10 / 10-02. */
const PAID_KPIS = [
  { key: "spend", label: "Spend (USD)" },
  { key: "clicks", label: "Clicks" },
  { key: "conversions", label: "Conversions" },
  { key: "cpl", label: "Cost per lead (USD)" },
] as const;
/**
 * Aggregate paid view DROPS cpl — a summed ratio lies (same reason the organic
 * aggregate drops authority_score). Spend/clicks/conversions sum honestly; CPL
 * is per-shop only.
 */
const PAID_AGGREGATE_KPIS = [
  { key: "spend", label: "Spend (USD)" },
  { key: "clicks", label: "Clicks" },
  { key: "conversions", label: "Conversions" },
] as const;

type Props = {
  searchParams: Promise<{ scope?: string }>;
};

export default async function AnalyticsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) {
    // Layout's 06-03 gate already routes no-shop users to onboarding; this is a
    // staff-without-membership edge — keep them on the dashboard home.
    redirect("/dashboard");
  }

  // The scope toggle exists ONLY for multi-shop (MSO) users.
  const scopeAll = params.scope === "all" && shops.length > 1;
  const activeShopName =
    shops.find((s) => s.id === activeShopId)?.name || "Your shop";

  // Date window: trailing 30 days. Clock read lives in trailingWindow (server
  // helper) — client islands receive plain props so hydration stays deterministic.
  const { from, to } = trailingWindow(WINDOW_DAYS);

  const snapshots = scopeAll
    ? await getSnapshotsForShops(supabase, {
        shopIds: shops.map((s) => s.id),
        source: SOURCE,
        period: PERIOD,
        from,
        to,
      })
    : await getSnapshots(supabase, {
        shopId: activeShopId,
        source: SOURCE,
        period: PERIOD,
        from,
        to,
      });

  // Per-shop rows pass through; the MSO view sums numeric metrics per date.
  const rows: DatedMetrics[] = scopeAll ? aggregateByDate(snapshots) : snapshots;
  const latest = latestSnapshot(rows);
  const syncedAt = latestSyncedAt(snapshots);
  const kpis = scopeAll ? AGGREGATE_KPIS : PER_SHOP_KPIS;

  const trafficSeries = toSeries(rows, "organic_traffic").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));
  const costSeries = toSeries(rows, "organic_traffic_cost").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));

  // Paid (Google Ads) — same source-agnostic snapshot read, source='google_ads'.
  // Its own empty/unlinked state below; the organic blocks above are untouched.
  const paidSnapshots = scopeAll
    ? await getSnapshotsForShops(supabase, {
        shopIds: shops.map((s) => s.id),
        source: PAID_SOURCE,
        period: PERIOD,
        from,
        to,
      })
    : await getSnapshots(supabase, {
        shopId: activeShopId,
        source: PAID_SOURCE,
        period: PERIOD,
        from,
        to,
      });
  const paidRows: DatedMetrics[] = scopeAll
    ? aggregateByDate(paidSnapshots)
    : paidSnapshots;
  const paidLatest = latestSnapshot(paidRows);
  const paidKpis = scopeAll ? PAID_AGGREGATE_KPIS : PAID_KPIS;
  const spendSeries = toSeries(paidRows, "spend").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));
  const conversionsSeries = toSeries(paidRows, "conversions").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Marketing analytics
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {scopeAll ? "All shops" : activeShopName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {syncedAt
              ? `Last synced ${formatSyncedAt(syncedAt)}`
              : "Awaiting first sync"}
          </p>
        </div>

        {shops.length > 1 ? (
          <nav
            aria-label="Analytics scope"
            className="flex rounded-md border border-border p-0.5"
          >
            <Link
              href="/dashboard/analytics"
              aria-current={!scopeAll ? "page" : undefined}
              className={`rounded px-3 py-1.5 font-heading text-sm font-medium transition-colors ${
                !scopeAll
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              This shop
            </Link>
            <Link
              href="/dashboard/analytics?scope=all"
              aria-current={scopeAll ? "page" : undefined}
              className={`rounded px-3 py-1.5 font-heading text-sm font-medium transition-colors ${
                scopeAll
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All shops
            </Link>
          </nav>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No analytics data yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">
              Analytics data syncs automatically — your first report lands
              after the next sync. Nothing to set up on your end.
            </p>
            <p className="text-sm text-muted-foreground">
              Organic search performance arrives first; paid and traffic
              sources follow as they are connected for your shop.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi) => {
              const raw = latest?.metrics[kpi.key];
              const value =
                typeof raw === "number" && Number.isFinite(raw) ? raw : null;
              return (
                <Card key={kpi.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {kpi.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tracking-tight">
                      {value === null ? "—" : formatNumber(value)}
                    </p>
                    <div className="mt-2">
                      <Sparkline
                        data={toSeries(rows, kpi.key)}
                        dataKey="value"
                        ariaLabel={`${kpi.label}, last ${WINDOW_DAYS} days`}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <LineChartCard
              title="Organic traffic"
              caption={`Estimated monthly visits from organic search, trailing ${WINDOW_DAYS} days.`}
              data={trafficSeries}
              dataKey="value"
              xKey="date"
              ariaLabel={`Organic traffic over the last ${WINDOW_DAYS} days`}
            />
            <BarChartCard
              title="Traffic value"
              caption="What this organic traffic would cost as paid clicks (USD)."
              data={costSeries}
              dataKey="value"
              xKey="date"
              ariaLabel={`Organic traffic value in USD over the last ${WINDOW_DAYS} days`}
              color="var(--chart-2)"
            />
          </div>
        </>
      )}

      <section aria-labelledby="paid-heading" className="space-y-4">
        <h2
          id="paid-heading"
          className="font-heading text-lg font-semibold tracking-tight"
        >
          Paid advertising
        </h2>

        {paidRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Google Ads account linked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground">
                Connect a Google Ads account to see spend, clicks, conversions,
                and cost per lead alongside your organic performance.
              </p>
              <Link
                href="/dashboard/ads"
                className="inline-block font-heading text-sm font-medium text-primary hover:underline"
              >
                Link Google Ads
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {paidKpis.map((kpi) => {
                const raw = paidLatest?.metrics[kpi.key];
                const value =
                  typeof raw === "number" && Number.isFinite(raw) ? raw : null;
                return (
                  <Card key={kpi.key}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {kpi.label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold tracking-tight">
                        {value === null ? "—" : formatNumber(value)}
                      </p>
                      <div className="mt-2">
                        <Sparkline
                          data={toSeries(paidRows, kpi.key)}
                          dataKey="value"
                          ariaLabel={`${kpi.label}, last ${WINDOW_DAYS} days`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <LineChartCard
                title="Ad spend"
                caption={`Daily Google Ads spend (USD), trailing ${WINDOW_DAYS} days.`}
                data={spendSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Google Ads spend over the last ${WINDOW_DAYS} days`}
              />
              <BarChartCard
                title="Conversions"
                caption="Tracked conversions from paid clicks."
                data={conversionsSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Google Ads conversions over the last ${WINDOW_DAYS} days`}
                color="var(--chart-2)"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
