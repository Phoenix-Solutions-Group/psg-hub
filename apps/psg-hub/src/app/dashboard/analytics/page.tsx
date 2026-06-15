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
import { LinkGoogleButton } from "./link-google-button";
import { LinkGbpButton } from "./link-gbp-button";

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

/** GA4 website-traffic KPIs — Phase 11 / 11-02. */
const GA4_SOURCE = "ga4" as const;
const GA4_KPIS = [
  { key: "sessions", label: "Sessions" },
  { key: "total_users", label: "Users" },
  { key: "key_events", label: "Key events" },
  { key: "engagement_rate", label: "Engagement rate" },
] as const;
/**
 * Aggregate GA4 view DROPS engagement_rate — a summed ratio lies (same reason the
 * organic aggregate drops authority_score and paid drops cpl). Sessions/users/
 * key_events sum honestly; engagement_rate is per-shop only.
 */
const GA4_AGGREGATE_KPIS = [
  { key: "sessions", label: "Sessions" },
  { key: "total_users", label: "Users" },
  { key: "key_events", label: "Key events" },
] as const;

/** GSC search-performance KPIs — Phase 11 / 11-03. */
const GSC_SOURCE = "gsc" as const;
const GSC_KPIS = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr", label: "CTR" },
  { key: "position", label: "Avg. position" },
] as const;
/**
 * Aggregate GSC view DROPS BOTH ctr AND position — both are ratios/averages, and a
 * summed ratio lies (same reason the organic aggregate drops authority_score, paid
 * drops cpl, GA4 drops engagement_rate). clicks/impressions sum honestly; ctr and
 * position are per-shop only.
 */
const GSC_AGGREGATE_KPIS = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
] as const;

/** GBP local-presence KPIs — Phase 13 / 13-02b. */
const GBP_SOURCE = "gbp" as const;
const GBP_KPIS = [
  { key: "call_clicks", label: "Calls" },
  { key: "website_clicks", label: "Website clicks" },
  { key: "direction_requests", label: "Direction requests" },
  { key: "impressions_total", label: "Profile impressions" },
] as const;
/**
 * Aggregate GBP view EXCLUDES NOTHING — unlike organic (authority_score), paid (cpl),
 * GA4 (engagement_rate), and GSC (ctr + position), every GBP metric is a FLOW count
 * that sums honestly across shops. So GBP_AGGREGATE_KPIS == GBP_KPIS by design.
 */
const GBP_AGGREGATE_KPIS = GBP_KPIS;

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
  // 11-01: the GA4 + GSC link is owner-only (the authorize route also enforces it).
  const activeRole =
    shops.find((s) => s.id === activeShopId)?.role ?? "viewer";

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

  // GA4 website traffic (11-02) — same source-agnostic snapshot read, source='ga4'.
  // Own unlinked state below; the organic + paid blocks above are untouched.
  const gaSnapshots = scopeAll
    ? await getSnapshotsForShops(supabase, {
        shopIds: shops.map((s) => s.id),
        source: GA4_SOURCE,
        period: PERIOD,
        from,
        to,
      })
    : await getSnapshots(supabase, {
        shopId: activeShopId,
        source: GA4_SOURCE,
        period: PERIOD,
        from,
        to,
      });
  const gaRows: DatedMetrics[] = scopeAll
    ? aggregateByDate(gaSnapshots)
    : gaSnapshots;
  const gaLatest = latestSnapshot(gaRows);
  const gaKpis = scopeAll ? GA4_AGGREGATE_KPIS : GA4_KPIS;
  const sessionsSeries = toSeries(gaRows, "sessions").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));
  const keyEventsSeries = toSeries(gaRows, "key_events").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));

  // GSC search performance (11-03) — same source-agnostic snapshot read, source='gsc'.
  // Own unlinked state below; the organic + paid + GA4 blocks above are untouched.
  const gscSnapshots = scopeAll
    ? await getSnapshotsForShops(supabase, {
        shopIds: shops.map((s) => s.id),
        source: GSC_SOURCE,
        period: PERIOD,
        from,
        to,
      })
    : await getSnapshots(supabase, {
        shopId: activeShopId,
        source: GSC_SOURCE,
        period: PERIOD,
        from,
        to,
      });
  const gscRows: DatedMetrics[] = scopeAll
    ? aggregateByDate(gscSnapshots)
    : gscSnapshots;
  const gscLatest = latestSnapshot(gscRows);
  const gscKpis = scopeAll ? GSC_AGGREGATE_KPIS : GSC_KPIS;
  const clicksSeries = toSeries(gscRows, "clicks").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));
  const impressionsSeries = toSeries(gscRows, "impressions").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));

  // GBP local presence (13-02b) — same source-agnostic snapshot read, source='gbp'.
  // Own unlinked state below; the organic + paid + GA4 + GSC blocks above are untouched.
  const gbpSnapshots = scopeAll
    ? await getSnapshotsForShops(supabase, {
        shopIds: shops.map((s) => s.id),
        source: GBP_SOURCE,
        period: PERIOD,
        from,
        to,
      })
    : await getSnapshots(supabase, {
        shopId: activeShopId,
        source: GBP_SOURCE,
        period: PERIOD,
        from,
        to,
      });
  const gbpRows: DatedMetrics[] = scopeAll
    ? aggregateByDate(gbpSnapshots)
    : gbpSnapshots;
  const gbpLatest = latestSnapshot(gbpRows);
  const gbpKpis = scopeAll ? GBP_AGGREGATE_KPIS : GBP_KPIS;
  const callsSeries = toSeries(gbpRows, "call_clicks").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));
  const websiteClicksSeries = toSeries(gbpRows, "website_clicks").map((p) => ({
    date: formatShortDate(p.date),
    value: p.value,
  }));

  // Header status reflects the most recent sync across ALL sources, not just
  // organic. A shop with only GA4/GSC/GBP linked is "Last synced", not "Awaiting".
  const syncedAt = latestSyncedAt([
    ...snapshots,
    ...paidSnapshots,
    ...gaSnapshots,
    ...gscSnapshots,
    ...gbpSnapshots,
  ]);

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
            <CardTitle>No organic search data yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">
              Organic search data syncs automatically. Your first report lands
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

      <section aria-labelledby="traffic-heading" className="space-y-4">
        <h2
          id="traffic-heading"
          className="font-heading text-lg font-semibold tracking-tight"
        >
          Website traffic
        </h2>

        {gaRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Google Analytics property linked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground">
                Connect a Google Analytics property to see sessions, users, key
                events, and engagement alongside your search and paid performance.
              </p>
              <Link
                href="/dashboard/analytics"
                className="inline-block font-heading text-sm font-medium text-primary hover:underline"
              >
                Connect Google Analytics
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {gaKpis.map((kpi) => {
                const raw = gaLatest?.metrics[kpi.key];
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
                          data={toSeries(gaRows, kpi.key)}
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
                title="Sessions"
                caption={`Daily website sessions, trailing ${WINDOW_DAYS} days.`}
                data={sessionsSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Website sessions over the last ${WINDOW_DAYS} days`}
              />
              <BarChartCard
                title="Key events"
                caption="Daily key events (conversions) tracked in Google Analytics."
                data={keyEventsSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Key events over the last ${WINDOW_DAYS} days`}
                color="var(--chart-2)"
              />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="search-heading" className="space-y-4">
        <h2
          id="search-heading"
          className="font-heading text-lg font-semibold tracking-tight"
        >
          Search performance
        </h2>

        {gscRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Google Search Console site linked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground">
                Connect a Google Search Console site to see clicks, impressions,
                click-through rate, and average position from organic search.
              </p>
              <Link
                href="/dashboard/analytics"
                className="inline-block font-heading text-sm font-medium text-primary hover:underline"
              >
                Connect Search Console
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {gscKpis.map((kpi) => {
                const raw = gscLatest?.metrics[kpi.key];
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
                          data={toSeries(gscRows, kpi.key)}
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
                title="Search clicks"
                caption={`Daily clicks from Google organic search, trailing ${WINDOW_DAYS} days.`}
                data={clicksSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Search clicks over the last ${WINDOW_DAYS} days`}
              />
              <BarChartCard
                title="Impressions"
                caption="Daily search impressions in Google organic results."
                data={impressionsSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Search impressions over the last ${WINDOW_DAYS} days`}
                color="var(--chart-2)"
              />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="presence-heading" className="space-y-4">
        <h2
          id="presence-heading"
          className="font-heading text-lg font-semibold tracking-tight"
        >
          Local presence
        </h2>

        {gbpRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Google Business Profile linked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground">
                Connect a Google Business Profile to see calls, direction requests,
                website clicks, and how often your profile appears in Maps and Search.
              </p>
              <Link
                href="/dashboard/analytics"
                className="inline-block font-heading text-sm font-medium text-primary hover:underline"
              >
                Connect Business Profile
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {gbpKpis.map((kpi) => {
                const raw = gbpLatest?.metrics[kpi.key];
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
                          data={toSeries(gbpRows, kpi.key)}
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
                title="Profile calls"
                caption={`Daily calls from your Business Profile, trailing ${WINDOW_DAYS} days.`}
                data={callsSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Profile calls over the last ${WINDOW_DAYS} days`}
              />
              <BarChartCard
                title="Website clicks"
                caption="Daily website clicks from your Business Profile."
                data={websiteClicksSeries}
                dataKey="value"
                xKey="date"
                ariaLabel={`Profile website clicks over the last ${WINDOW_DAYS} days`}
                color="var(--chart-2)"
              />
            </div>
          </>
        )}
      </section>

      {activeRole === "owner" ? (
        <section aria-labelledby="connect-google-heading" className="space-y-4">
          <h2
            id="connect-google-heading"
            className="font-heading text-lg font-semibold tracking-tight"
          >
            Connect more sources
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>Google Analytics &amp; Search Console</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                Link this shop&rsquo;s Google account once to add organic traffic,
                engagement, and search performance to your analytics. One sign-in
                covers both Google Analytics and Search Console.
              </p>
              <LinkGoogleButton shopId={activeShopId} userRole={activeRole} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Google Business Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                Link this shop&rsquo;s Google Business Profile to add presence and
                profile insights (calls, direction requests, website clicks, and
                search visibility) to your analytics.
              </p>
              <LinkGbpButton shopId={activeShopId} userRole={activeRole} />
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
