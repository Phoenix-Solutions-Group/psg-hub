import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getLatestShopAudit } from "@/lib/seo-audit/run";
import {
  getLatestMonthlySnapshot,
  getSnapshots,
} from "@/lib/analytics/snapshots";
import { readAnalyticsSection } from "@/lib/analytics/safe-read";
import {
  formatNumber,
  formatShortDate,
  trailingWindow,
  type DatedMetrics,
} from "@/lib/analytics/aggregate";
import { LineChartCard } from "@/components/analytics/charts";
import { getLatestLocalFalconSnapshot } from "@/lib/local-falcon/store";
import {
  buildFirstLoginValueState,
  type FirstLoginValueState,
} from "@/lib/bsm/first-login-value";
import { recordBsmPilotEvent } from "@/lib/bsm/pilot-events";
import { getRiversideAnalyticsPreviewShop } from "@/lib/bsm/riverside-analytics-demo";

type DashboardStat = {
  label: string;
  value: number;
  emptyLabel: string;
  helper: string;
};

type VisibilityCard = {
  title: string;
  value: string;
  helper: string;
};

type ConnectionAction = {
  title: string;
  helper: string;
  href: string;
  label: string;
};

type MarketingVisibilitySummary = {
  cards: VisibilityCard[];
  trendSeries: Array<{ date: string; value: number }>;
  trendCaption: string;
  connectionActions: ConnectionAction[];
  previewNotice: string | null;
};

const WINDOW_DAYS = 30;
const RIVERSIDE_PREVIEW_SYNC_DATE = "2026-08-05";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real content-pipeline counts scoped to the active shop. (The old "Agent Runs"
  // card read a phantom agent_runs table — agents are deferred to v1.6 — and every
  // card was hardcoded 0; both are removed here.) Service-role read scoped by
  // shop_id, mirroring the 07-03 page scoping; activeShopId is already validated
  // against membership by getActiveShopContext.
  let total = 0;
  let pendingReview = 0;
  let published = 0;
  let firstLoginValue: FirstLoginValueState | null = null;
  let marketingVisibility = emptyMarketingVisibilitySummary();

  if (user) {
    const { shops, activeShopId: resolvedActiveShopId } =
      await getActiveShopContext(user.id);
    const activeShopName =
      shops.find((shop) => shop.id === resolvedActiveShopId)?.name ?? null;
    const service = createServiceClient();
    const previewShop = await getRiversideAnalyticsPreviewShop(service, {
      userEmail: user.email,
      activeShopName,
    });
    const activeShopId = previewShop?.id ?? resolvedActiveShopId;
    if (activeShopId) {
      const countFor = (status?: string) => {
        let q = service
          .from("content_items")
          .select("*", { count: "exact", head: true })
          .eq("shop_id", activeShopId);
        if (status) q = q.eq("status", status);
        return q;
      };
      const [all, pend, pub] = await Promise.all([
        countFor(),
        countFor("pending_review"),
        countFor("published"),
      ]);
      total = all.count ?? 0;
      pendingReview = pend.count ?? 0;
      published = pub.count ?? 0;
      const latestAudit = await getLatestShopAudit(service, activeShopId);
      firstLoginValue = buildFirstLoginValueState(latestAudit?.report ?? null);
      marketingVisibility = await getMarketingVisibilitySummary(service, {
        shopId: activeShopId,
        usePreviewDemoMetrics: previewShop !== null,
      });
      await recordBsmPilotEvent(service, {
        eventName: "first_login_card_viewed",
        shopId: activeShopId,
        userId: user.id,
        properties: { state: firstLoginValue.status },
      });
    } else {
      firstLoginValue = buildFirstLoginValueState(null);
    }
  }

  const stats: DashboardStat[] = [
    {
      label: "Content Items",
      value: total,
      emptyLabel: "Not started yet",
      helper:
        "Drafts will appear after BSM has enough shop signals to create them.",
    },
    {
      label: "Pending Review",
      value: pendingReview,
      emptyLabel: "None waiting",
      helper:
        "New content will land here for approval before anything is published.",
    },
    {
      label: "Published",
      value: published,
      emptyLabel: "Nothing live yet",
      helper: "Approved work will show here after it has been published.",
    },
  ];

  const displayName = user?.email?.split("@")[0] ?? "there";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome, {displayName}.</p>
      </div>

      {firstLoginValue && (
        <Card>
          <CardHeader>
            <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
              {firstLoginValue.eyebrow}
            </p>
            <CardTitle>{firstLoginValue.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {firstLoginValue.detail}
            </p>
            <Link
              className={buttonVariants()}
              href={firstLoginValue.nextStepHref}
            >
              {firstLoginValue.nextStepLabel}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s) => {
          const isEmpty = s.value === 0;
          return (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold">
                  {isEmpty ? s.emptyLabel : s.value}
                </p>
                {isEmpty && (
                  <p className="text-sm leading-5 text-muted-foreground">
                    {s.helper}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section
        className="space-y-4"
        aria-labelledby="marketing-visibility-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="marketing-visibility-heading"
              className="font-heading text-lg font-semibold tracking-tight"
            >
              Marketing visibility
            </h2>
            <p className="text-sm text-muted-foreground">
              The core signals a shop owner needs to see whether local marketing
              is working.
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/dashboard/analytics"
          >
            View full analytics
          </Link>
        </div>
        {marketingVisibility.previewNotice ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {marketingVisibility.previewNotice}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {marketingVisibility.cards.map((item) => (
            <Card key={item.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold tracking-tight">
                  {item.value}
                </p>
                <p className="text-sm leading-5 text-muted-foreground">
                  {item.helper}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {marketingVisibility.trendSeries.length > 0 ? (
          <LineChartCard
            title="Website visits trend"
            caption={marketingVisibility.trendCaption}
            data={marketingVisibility.trendSeries}
            dataKey="value"
            xKey="date"
            ariaLabel={`Website visits over the last ${marketingVisibility.trendSeries.length} synced days`}
          />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-4">
          {marketingVisibility.connectionActions.map((action) => (
            <Card key={action.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {action.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-5 text-muted-foreground">
                  {action.helper}
                </p>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={action.href}
                >
                  {action.label}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function emptyMarketingVisibilitySummary(): MarketingVisibilitySummary {
  return {
    cards: [
      {
        title: "Local map visibility",
        value: "Waiting on first scan",
        helper:
          "Map ranking appears after PSG imports a Local Falcon scan for this shop.",
      },
      {
        title: "Local presence",
        value: "Waiting on profile data",
        helper:
          "Google Business Profile health appears after the shop connects its profile.",
      },
      {
        title: "Search performance",
        value: "Waiting on search data",
        helper:
          "Search clicks and impressions appear after Search Console is connected.",
      },
      {
        title: "Google Analytics",
        value: "Not connected yet",
        helper:
          "Website sessions appear after the shop owner connects Google Analytics.",
      },
      {
        title: "Paid advertising",
        value: "Not connected yet",
        helper:
          "Google Ads spend and leads appear after the shop connects its ad account.",
      },
    ],
    trendSeries: [],
    trendCaption:
      "Daily website visits appear here after Google Analytics is connected.",
    connectionActions: [
      {
        title: "Google Ads",
        helper:
          "Owner next step: open the paid advertising workspace and connect the right ad account.",
        href: "/dashboard/ads",
        label: "Open Google Ads connection",
      },
      {
        title: "Google Analytics",
        helper:
          "Owner next step: connect the shop's Google Analytics property to show visits and leads.",
        href: "/dashboard/analytics",
        label: "Open Analytics connection",
      },
      {
        title: "Search Console",
        helper:
          "Owner next step: connect Search Console to show search clicks, impressions, and rankings.",
        href: "/dashboard/analytics",
        label: "Open Search Console connection",
      },
      {
        title: "Business Profile",
        helper:
          "Owner next step: connect the Google Business Profile to show calls, directions, and reviews.",
        href: "/dashboard/analytics",
        label: "Open Business Profile connection",
      },
    ],
    previewNotice: null,
  };
}

async function getMarketingVisibilitySummary(
  service: ReturnType<typeof createServiceClient>,
  {
    shopId,
    usePreviewDemoMetrics,
  }: { shopId: string; usePreviewDemoMetrics: boolean },
): Promise<MarketingVisibilitySummary> {
  const { from, to } = trailingWindow(WINDOW_DAYS);
  const readWarnings: { section: string; message: string }[] = [];

  const [
    localFalconResult,
    presenceRowResult,
    gscRowsResult,
    gaRowsResult,
    paidRowsResult,
  ] = await Promise.all([
    readAnalyticsSection(
      "dashboard Local Falcon",
      () => getLatestLocalFalconSnapshot(service, { shopId }),
      null,
      readWarnings,
    ),
    readAnalyticsSection(
      "dashboard Business Profile status",
      () =>
        getLatestMonthlySnapshot(service, {
          shopId,
          source: "gbp_presence",
        }),
      null,
      readWarnings,
    ),
    readAnalyticsSection(
      "dashboard Search Console",
      () =>
        getSnapshots(service, {
          shopId,
          source: "gsc",
          period: "daily",
          from,
          to,
        }),
      [],
      readWarnings,
    ),
    readAnalyticsSection(
      "dashboard Google Analytics",
      () =>
        getSnapshots(service, {
          shopId,
          source: "ga4",
          period: "daily",
          from,
          to,
        }),
      [],
      readWarnings,
    ),
    readAnalyticsSection(
      "dashboard Google Ads",
      () =>
        getSnapshots(service, {
          shopId,
          source: "google_ads",
          period: "daily",
          from,
          to,
        }),
      [],
      readWarnings,
    ),
  ]);

  const localFalcon =
    localFalconResult ??
    (usePreviewDemoMetrics
      ? {
          capturedAt: RIVERSIDE_PREVIEW_SYNC_DATE,
          sourceFileName: "private-preview-local-falcon.csv",
          campaignName: "Riverside Collision board preview",
          gridSize: "7x7",
          shareOfLocalVoice: 41.8,
          averageRank: 5.4,
          priorityNotes: [
            "Strongest visibility within 3 miles; edge ZIPs need more review velocity.",
          ],
          keywordSummaries: [],
        }
      : null);
  const presenceRow =
    presenceRowResult ??
    (usePreviewDemoMetrics
      ? {
          metrics: {
            average_rating: 4.7,
            total_review_count: 186,
          },
        }
      : null);
  const gscRows =
    gscRowsResult.length > 0
      ? gscRowsResult
      : usePreviewDemoMetrics
        ? previewDashboardRows({
            clicks: 58,
            impressions: 2140,
          })
        : [];
  const gaRows =
    gaRowsResult.length > 0
      ? gaRowsResult
      : usePreviewDemoMetrics
        ? previewDashboardSeries([
            { sessions: 318, total_users: 244 },
            { sessions: 331, total_users: 258 },
            { sessions: 349, total_users: 271 },
            { sessions: 371, total_users: 289 },
            { sessions: 392, total_users: 311 },
          ])
        : [];
  const paidRows =
    paidRowsResult.length > 0
      ? paidRowsResult
      : usePreviewDemoMetrics
        ? previewDashboardRows({
            spend: 1480,
            conversions: 37,
          })
        : [];

  const latestGsc = latestMetrics(gscRows);
  const latestGa = latestMetrics(gaRows);
  const latestPaid = latestMetrics(paidRows);
  const presenceMetrics = presenceRow?.metrics as
    | Record<string, unknown>
    | undefined;

  const localMapValue =
    localFalcon?.shareOfLocalVoice === null || !localFalcon
      ? "Waiting on first scan"
      : `${localFalcon.shareOfLocalVoice.toFixed(1)}%`;
  const localMapHelper = localFalcon
    ? `Share of Local Voice from the ${formatShortDate(
        localFalcon.capturedAt,
      )} map scan.`
    : "Map ranking appears after PSG imports a Local Falcon scan for this shop.";

  const averageRating =
    typeof presenceMetrics?.average_rating === "number"
      ? presenceMetrics.average_rating
      : null;
  const reviewCount =
    typeof presenceMetrics?.total_review_count === "number"
      ? presenceMetrics.total_review_count
      : null;

  const clicks = metricNumber(latestGsc, "clicks");
  const impressions = metricNumber(latestGsc, "impressions");
  const sessions = metricNumber(latestGa, "sessions");
  const users = metricNumber(latestGa, "total_users");
  const spend = metricNumber(latestPaid, "spend");
  const leads = metricNumber(latestPaid, "conversions");

  return {
    cards: [
      {
        title: "Local map visibility",
        value: localMapValue,
        helper: localMapHelper,
      },
      {
        title: "Local presence",
        value:
          averageRating === null
            ? "Waiting on profile data"
            : `${averageRating.toFixed(1)} rating`,
        helper:
          reviewCount === null
            ? "Google Business Profile health appears after the shop connects its profile."
            : `${formatNumber(reviewCount)} Google reviews currently counted.`,
      },
      {
        title: "Search performance",
        value:
          clicks === null
            ? "Waiting on search data"
            : `${formatNumber(clicks)} clicks`,
        helper:
          impressions === null
            ? "Search clicks and impressions appear after Search Console is connected."
            : `${formatNumber(impressions)} search impressions in the latest synced day.`,
      },
      {
        title: "Google Analytics",
        value:
          sessions === null
            ? "Not connected yet"
            : `${formatNumber(sessions)} sessions`,
        helper:
          users === null
            ? "Website sessions appear after the shop owner connects Google Analytics."
            : `${formatNumber(users)} website users in the latest synced day.`,
      },
      {
        title: "Paid advertising",
        value:
          spend === null
            ? "Not connected yet"
            : `$${formatNumber(Math.round(spend))} spend`,
        helper:
          leads === null
            ? "Google Ads spend and leads appear after the shop connects its ad account."
            : `${formatNumber(leads)} paid leads in the latest synced day.`,
      },
    ],
    trendSeries: toDashboardTrendSeries(gaRows, "sessions"),
    trendCaption: usePreviewDemoMetrics
      ? "Private preview demo trend for Riverside Collision until the real Google Analytics property is connected."
      : "Daily website visits from the connected Google Analytics property.",
    connectionActions: emptyMarketingVisibilitySummary().connectionActions,
    previewNotice: usePreviewDemoMetrics
      ? "Private preview note: these Riverside Collision numbers are seeded demo data so Nick can review the working dashboard before live customer accounts are connected."
      : null,
  };
}

function previewDashboardRows(metrics: Record<string, number>): DatedMetrics[] {
  return [{ date: RIVERSIDE_PREVIEW_SYNC_DATE, metrics }];
}

function previewDashboardSeries(
  metricsByDay: Array<Record<string, number>>,
): DatedMetrics[] {
  const dates = [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    RIVERSIDE_PREVIEW_SYNC_DATE,
  ];
  return dates.map((date, index) => ({
    date,
    metrics: metricsByDay[index] ?? {},
  }));
}

function toDashboardTrendSeries(
  rows: DatedMetrics[],
  key: string,
): Array<{ date: string; value: number }> {
  return rows
    .map((row) => {
      const value = metricNumber(row.metrics, key);
      if (value === null) return null;
      return { date: formatShortDate(row.date), value };
    })
    .filter((row): row is { date: string; value: number } => row !== null);
}

function latestMetrics(rows: DatedMetrics[]): Record<string, unknown> | null {
  const latest = rows
    .filter((row) => row.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest?.metrics ?? null;
}

function metricNumber(
  metrics: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
