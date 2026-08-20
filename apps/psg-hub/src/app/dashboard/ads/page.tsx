import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSnapshots } from "@/lib/analytics/snapshots";
import { formatSyncedAt, trailingWindow, type DatedMetrics } from "@/lib/analytics/aggregate";
import { buildGoogleAdsDashboard, getRecentGoogleAdsChanges } from "@/lib/analytics/google-ads-dashboard";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  isRiversideDemoUser,
  shouldUseRiversideAnalyticsPreviewFallback,
} from "@/lib/bsm/riverside-analytics-demo";
import { getActiveShopContext } from "@/lib/shop/context";
import { shopHasTier } from "@/lib/tier/gate";
import { formatMicrosAsUsd, readMetrics } from "@/lib/ads/campaigns-client";
import { TierGateCard } from "./tier-gate-card";
import { AccountsTable } from "./accounts-table";
import type { ShopRole } from "@/lib/ads/view-state";
import { CustomerReplyForm, CustomerRequestActions } from "./customer-request-actions";

type Props = {
  searchParams: Promise<{ shop_id?: string }>;
};

type RequestRow = {
  id: string;
  request_type: string;
  campaign_name: string | null;
  title: string;
  details: string;
  status: string;
  psg_response: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignRow = {
  id: string;
  name: string;
  status: "paused" | "enabled" | "removed";
  daily_budget_micros: number;
  metrics?: unknown;
  metrics_synced_at?: string | null;
};

type ReportRow = {
  id: string;
  title: string;
  period_month: string | null;
  published_at: string;
  byte_size: number;
};

const WINDOW_DAYS = 30;
const RIVERSIDE_PREVIEW_SYNCED_AT = "2026-08-05T14:00:00.000Z";
type PreviewMetricsRow = DatedMetrics & { synced_at: string };

const RIVERSIDE_PREVIEW_CURRENT_ROWS: PreviewMetricsRow[] = [
  { date: "2026-08-01", metrics: { spend: 260, conversions: 6, clicks: 118, impressions: 4200, conversion_tracking_verified: true }, synced_at: RIVERSIDE_PREVIEW_SYNCED_AT },
  { date: "2026-08-02", metrics: { spend: 278, conversions: 7, clicks: 126, impressions: 4380, conversion_tracking_verified: true }, synced_at: RIVERSIDE_PREVIEW_SYNCED_AT },
  { date: "2026-08-03", metrics: { spend: 291, conversions: 7, clicks: 131, impressions: 4510, conversion_tracking_verified: true }, synced_at: RIVERSIDE_PREVIEW_SYNCED_AT },
  { date: "2026-08-04", metrics: { spend: 312, conversions: 8, clicks: 139, impressions: 4680, conversion_tracking_verified: true }, synced_at: RIVERSIDE_PREVIEW_SYNCED_AT },
  { date: "2026-08-05", metrics: { spend: 339, conversions: 9, clicks: 147, impressions: 4890, conversion_tracking_verified: true }, synced_at: RIVERSIDE_PREVIEW_SYNCED_AT },
];

const RIVERSIDE_PREVIEW_PRIOR_ROWS: DatedMetrics[] = [
  { date: "2026-07-27", metrics: { spend: 240, conversions: 5, clicks: 105, impressions: 3900 } },
  { date: "2026-07-28", metrics: { spend: 251, conversions: 6, clicks: 111, impressions: 4020 } },
  { date: "2026-07-29", metrics: { spend: 259, conversions: 6, clicks: 116, impressions: 4140 } },
  { date: "2026-07-30", metrics: { spend: 267, conversions: 6, clicks: 119, impressions: 4260 } },
  { date: "2026-07-31", metrics: { spend: 274, conversions: 7, clicks: 122, impressions: 4320 } },
];

const RIVERSIDE_PREVIEW_CAMPAIGNS: CampaignRow[] = [
  { id: "riverside-search", name: "Collision Repair Search", status: "enabled", daily_budget_micros: 18_000_000, metrics: { conversions: 15, clicks: 224, cost_micros: 486_000_000 } },
  { id: "riverside-local", name: "Riverside Local Services", status: "enabled", daily_budget_micros: 12_000_000, metrics: { conversions: 12, clicks: 183, cost_micros: 392_000_000 } },
  { id: "riverside-brand", name: "Riverside Brand Search", status: "enabled", daily_budget_micros: 8_000_000, metrics: { conversions: 10, clicks: 154, cost_micros: 302_000_000 } },
];

function priorWindow(from: string, days: number): { from: string; to: string } {
  const priorTo = new Date(`${from}T00:00:00Z`);
  priorTo.setUTCDate(priorTo.getUTCDate() - 1);
  const priorFrom = new Date(priorTo);
  priorFrom.setUTCDate(priorFrom.getUTCDate() - days);
  return {
    from: priorFrom.toISOString().slice(0, 10),
    to: priorTo.toISOString().slice(0, 10),
  };
}

export function friendlyStatus(status: string, requestType: string): string {
  const labels: Record<string, string> = {
    submitted: "Received",
    psg_reviewing: "PSG is working on it",
    in_progress: "PSG is working on it",
    needs_more_info: "We need one detail from you",
    done: requestType === "performance_review" || requestType === "problem_report"
      ? "Answered"
      : "Done – the change is live",
    declined: "Could not do this",
  };
  return labels[status] ?? "Received";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPeriod(periodMonth: string | null): string {
  if (!periodMonth) return "Recent report";
  return new Date(`${periodMonth}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function bestCampaigns(campaigns: CampaignRow[]): CampaignRow[] {
  return [...campaigns]
    .filter((campaign) => campaign.status !== "removed")
    .sort((a, b) => {
      const am = readMetrics(a);
      const bm = readMetrics(b);
      return bm.conversions - am.conversions || bm.clicks - am.clicks;
    })
    .slice(0, 3);
}

export default async function AdsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const service = createServiceClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const shopId = params.shop_id;
  if (!shopId) {
    const { activeShopId } = await getActiveShopContext(
      user.id,
      isRiversideDemoUser(user.email) ? RIVERSIDE_ANALYTICS_DEMO_SHOP.name : null,
    );
    if (!activeShopId) {
      redirect("/dashboard");
    }
    redirect(`/dashboard/ads?shop_id=${activeShopId}`);
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    redirect("/dashboard");
  }

  if (!(await shopHasTier(shopId, "performance"))) {
    return <TierGateCard shopId={shopId} />;
  }

  const { data: shop } = await service
    .from("shops")
    .select("id, name")
    .eq("id", shopId)
    .maybeSingle();
  const shopName = (shop as { name?: string } | null)?.name ?? "your shop";
  const requestHost = (await headers()).get("host");
  const useRiversidePreview =
    shopName === RIVERSIDE_ANALYTICS_DEMO_SHOP.name &&
    shouldUseRiversideAnalyticsPreviewFallback({
      userEmail: user.email,
      requestHost,
    });

  const { data: accounts } = await supabase
    .from("google_ads_accounts")
    .select("id, customer_id, status, linked_at, last_error")
    .eq("shop_id", shopId)
    .order("linked_at", { ascending: false });

  if (!useRiversidePreview && (accounts?.length ?? 0) === 0) {
    return (
      <AccountsTable
        accounts={[]}
        shopId={shopId}
        userRole={membership.role as ShopRole}
      />
    );
  }

  const { from, to } = trailingWindow(WINDOW_DAYS);
  const prior = priorWindow(from, WINDOW_DAYS);

  const [currentRows, priorRows, recentChanges, campaignsResult, requestsResult, reportsResult] =
    await Promise.all([
      getSnapshots(supabase, { shopId, source: "google_ads", period: "daily", from, to }),
      getSnapshots(supabase, { shopId, source: "google_ads", period: "daily", from: prior.from, to: prior.to }),
      getRecentGoogleAdsChanges(service, { authorizedShopIds: [shopId], limit: 5 }).catch(() => []),
      supabase
        .from("google_ads_campaigns")
        .select("id, name, status, daily_budget_micros, metrics, metrics_synced_at")
        .eq("shop_id", shopId)
        .order("metrics_synced_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("google_ads_customer_requests")
        .select(
          "id, request_type, campaign_name, title, details, status, psg_response, decline_reason, created_at, updated_at",
        )
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false }),
      supabase
        .from("google_ads_optimization_audit_reports")
        .select("id, title, period_month, published_at, byte_size")
        .eq("shop_id", shopId)
        .order("published_at", { ascending: false }),
    ]);

  const dashboard = buildGoogleAdsDashboard({
    currentRows: useRiversidePreview && currentRows.length === 0
      ? RIVERSIDE_PREVIEW_CURRENT_ROWS
      : currentRows as DatedMetrics[],
    priorRows: useRiversidePreview && priorRows.length === 0
      ? RIVERSIDE_PREVIEW_PRIOR_ROWS
      : priorRows as DatedMetrics[],
    recentChanges: useRiversidePreview && recentChanges.length === 0
      ? [{ id: "riverside-preview-change", title: "Added collision repair search terms", occurredAt: RIVERSIDE_PREVIEW_SYNCED_AT }]
      : recentChanges,
  });
  const loadedCampaigns = (campaignsResult.data ?? []) as CampaignRow[];
  const campaigns = useRiversidePreview && loadedCampaigns.length === 0
    ? RIVERSIDE_PREVIEW_CAMPAIGNS
    : loadedCampaigns;
  const requests = (requestsResult.data ?? []) as RequestRow[];
  const reports = (reportsResult.data ?? []) as ReportRow[];
  const topCampaigns = bestCampaigns(campaigns);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Google Ads
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Your Google Ads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One place for {shopName} to review ad performance, ask PSG for help, and download reviewed reports.
          </p>
        </div>
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
          Numbers current as of{" "}
          {dashboard.lastSyncedAt ? formatSyncedAt(dashboard.lastSyncedAt) : "the next Google Ads sync"}
        </p>
      </div>

      {useRiversidePreview ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Private preview note: these Google Ads numbers are seeded demo data so the dashboard can be reviewed before a real customer account is connected.
        </p>
      ) : null}

      <section aria-labelledby="ads-performance-heading" className="space-y-4">
        <div>
          <h2 id="ads-performance-heading" className="text-lg font-semibold">
            How your ads are doing
          </h2>
          <p className="text-sm text-muted-foreground">
            Spend, leads, cost per lead, and trend text are based on the latest synced Google Ads snapshots.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {dashboard.tiles.map((tile) => (
            <Card key={tile.key}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {tile.label}
                  </CardTitle>
                  {tile.unconfirmed ? <Badge variant="warning">Unconfirmed</Badge> : null}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tracking-tight">{tile.display}</p>
                <p className="mt-1 min-h-5 text-xs text-muted-foreground">
                  {tile.note ?? tile.trendLabel}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="best-ads-heading" className="space-y-4">
          <h2 id="best-ads-heading" className="text-lg font-semibold">
            Best-performing ads
          </h2>
          <div className="rounded-md border border-border">
            {topCampaigns.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                PSG will show best-performing campaigns here after the first campaign sync.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topCampaigns.map((campaign) => {
                  const metrics = readMetrics(campaign);
                  return (
                    <li key={campaign.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div>
                        <p className="font-medium">{campaign.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {metrics.conversions.toLocaleString()} leads · {metrics.clicks.toLocaleString()} clicks ·{" "}
                          {formatMicrosAsUsd(metrics.cost_micros)} spend
                        </p>
                      </div>
                      <Badge variant={campaign.status === "enabled" ? "success" : "secondary"}>
                        {campaign.status === "enabled" ? "Running" : "Paused"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="recent-changes-heading" className="space-y-4">
          <h2 id="recent-changes-heading" className="text-lg font-semibold">
            Recent changes
          </h2>
          <Card>
            <CardContent className="py-4">
              {dashboard.recentChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  PSG changes will appear here after a reviewed update goes live.
                </p>
              ) : (
                <ul className="space-y-3">
                  {dashboard.recentChanges.map((change) => (
                    <li key={change.id} className="text-sm">
                      <p className="font-medium">{change.title}</p>
                      <p className="text-muted-foreground">{formatSyncedAt(change.occurredAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <section aria-labelledby="request-heading" className="space-y-4">
        <h2 id="request-heading" className="text-lg font-semibold">
          Ask PSG for help
        </h2>
        <Card>
          <CardContent className="py-4">
            <CustomerRequestActions
              shopId={shopId}
              canSubmit={membership.role === "owner" || membership.role === "manager"}
              campaigns={campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name }))}
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="requests-heading" className="space-y-4">
        <h2 id="requests-heading" className="text-lg font-semibold">
          Your requests
        </h2>
        <div className="rounded-md border border-border">
          {requests.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No Google Ads requests yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((request) => (
                <li key={request.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{request.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.campaign_name ?? "General request"} · sent {formatDate(request.created_at)}
                      </p>
                    </div>
                    <Badge variant={request.status === "declined" ? "destructive" : "secondary"}>
                      {friendlyStatus(request.status, request.request_type)}
                    </Badge>
                  </div>
                  {request.psg_response ? (
                    <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">{request.psg_response}</p>
                  ) : null}
                  {request.decline_reason ? (
                    <p className="mt-3 text-sm text-destructive">{request.decline_reason}</p>
                  ) : null}
                  {request.status === "needs_more_info" ? (
                    <CustomerReplyForm shopId={shopId} requestId={request.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="reports-heading" className="space-y-4">
        <h2 id="reports-heading" className="text-lg font-semibold">
          Your reports
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Next report</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {"Your next report is with PSG for review. We'll post it here as soon as it's approved."}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ready reports</CardTitle>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reports yet. Your first reviewed report will appear here.
                </p>
              ) : (
                <ul className="space-y-3">
                  {reports.map((report) => (
                    <li key={report.id} className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{report.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatPeriod(report.period_month)} · published {formatDate(report.published_at)}
                        </p>
                      </div>
                      <Link
                        href={`/api/google-ads/audit-reports/${report.id}/download`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground"
                      >
                        <Download aria-hidden="true" className="size-4" />
                        Download report (PDF)
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
