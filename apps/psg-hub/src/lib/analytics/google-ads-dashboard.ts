import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DatedMetrics, SeriesPoint } from "./aggregate";
import { formatShortDate, latestSyncedAt, toSeries } from "./aggregate";
import { momDelta } from "./rollup";

export type GoogleAdsMetricKey =
  | "spend"
  | "conversions"
  | "cpl"
  | "clicks"
  | "impressions";

export type GoogleAdsTile = {
  key: GoogleAdsMetricKey;
  label: string;
  value: number | null;
  display: string;
  trend: number | null;
  trendLabel: string;
  unconfirmed: boolean;
  note: string | null;
  series: SeriesPoint[];
};

export type GoogleAdsRecentChange = {
  id: string;
  title: string;
  occurredAt: string;
};

export type GoogleAdsDashboard = {
  status: "empty" | "ready";
  lastSyncedAt: string | null;
  conversionTrackingConfirmed: boolean;
  tiles: GoogleAdsTile[];
  spendSeries: Array<{ date: string; value: number }>;
  leadsSeries: Array<{ date: string; value: number }>;
  recentChanges: GoogleAdsRecentChange[];
};

type SnapshotLike = DatedMetrics & { synced_at?: string };

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function num(row: DatedMetrics | null, key: string): number {
  const raw = row?.metrics[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function sum(rows: DatedMetrics[], key: string): number {
  return rows.reduce((total, row) => total + num(row, key), 0);
}

function hasVerifiedConversions(rows: DatedMetrics[]): boolean {
  for (const row of rows) {
    const verified = row.metrics.conversion_tracking_verified;
    if (verified === false) return false;
    if (verified === true) return true;
  }
  return sum(rows, "conversions") > 0;
}

function trendLabel(delta: number | null): string {
  if (delta === null) return "No prior-period comparison";
  const pct = Math.abs(delta * 100).toFixed(0);
  if (delta > 0) return `Up ${pct}% vs prior period`;
  if (delta < 0) return `Down ${pct}% vs prior period`;
  return "Flat vs prior period";
}

function displayValue(key: GoogleAdsMetricKey, value: number | null): string {
  if (value === null) return "Unconfirmed";
  if (key === "spend" || key === "cpl") return MONEY.format(value);
  return NUMBER.format(value);
}

export function buildGoogleAdsDashboard({
  currentRows,
  priorRows,
  recentChanges = [],
}: {
  currentRows: SnapshotLike[];
  priorRows: DatedMetrics[];
  recentChanges?: GoogleAdsRecentChange[];
}): GoogleAdsDashboard {
  const currentSpend = sum(currentRows, "spend");
  const currentLeads = sum(currentRows, "conversions");
  const currentClicks = sum(currentRows, "clicks");
  const currentImpressions = sum(currentRows, "impressions");
  const conversionsConfirmed = hasVerifiedConversions(currentRows);

  const priorSpend = sum(priorRows, "spend");
  const priorLeads = sum(priorRows, "conversions");
  const priorClicks = sum(priorRows, "clicks");
  const priorImpressions = sum(priorRows, "impressions");

  const cpl = conversionsConfirmed && currentLeads > 0 ? currentSpend / currentLeads : null;
  const priorCpl = priorLeads > 0 ? priorSpend / priorLeads : null;

  const baseTiles: Array<{
    key: GoogleAdsMetricKey;
    label: string;
    value: number | null;
    prior: number | null;
    unconfirmed?: boolean;
    note?: string | null;
  }> = [
    { key: "spend", label: "Spend", value: currentSpend, prior: priorSpend },
    {
      key: "conversions",
      label: "Leads",
      value: conversionsConfirmed ? currentLeads : null,
      prior: priorLeads,
      unconfirmed: !conversionsConfirmed,
      note: conversionsConfirmed
        ? null
        : "Conversion tracking is not confirmed yet, so PSG is not showing lead totals as final.",
    },
    {
      key: "cpl",
      label: "Cost per lead",
      value: cpl,
      prior: priorCpl,
      unconfirmed: !conversionsConfirmed,
      note: conversionsConfirmed
        ? null
        : "Cost per lead will appear after conversion tracking is confirmed.",
    },
    { key: "clicks", label: "Clicks", value: currentClicks, prior: priorClicks },
    {
      key: "impressions",
      label: "Impressions",
      value: currentImpressions,
      prior: priorImpressions,
    },
  ];

  const tiles = baseTiles.map((tile) => {
    const trend = tile.unconfirmed ? null : momDelta(tile.value, tile.prior);
    return {
      key: tile.key,
      label: tile.label,
      value: tile.value,
      display: displayValue(tile.key, tile.value),
      trend,
      trendLabel: trendLabel(trend),
      unconfirmed: tile.unconfirmed ?? false,
      note: tile.note ?? null,
      series: toSeries(currentRows, tile.key),
    };
  });

  return {
    status: currentRows.length === 0 ? "empty" : "ready",
    lastSyncedAt: latestSyncedAt(
      currentRows.filter(
        (row): row is SnapshotLike & { synced_at: string } =>
          typeof row.synced_at === "string"
      )
    ),
    conversionTrackingConfirmed: conversionsConfirmed,
    tiles,
    spendSeries: toSeries(currentRows, "spend").map((p) => ({
      date: formatShortDate(p.date),
      value: p.value,
    })),
    leadsSeries: toSeries(currentRows, "conversions").map((p) => ({
      date: formatShortDate(p.date),
      value: conversionsConfirmed ? p.value : 0,
    })),
    recentChanges,
  };
}

export async function getRecentGoogleAdsChanges(
  service: SupabaseClient,
  { authorizedShopIds, limit = 5 }: { authorizedShopIds: string[]; limit?: number }
): Promise<GoogleAdsRecentChange[]> {
  if (authorizedShopIds.length === 0) return [];

  const { data, error } = await service
    .from("ads_audit_logs")
    .select("id, mutation_key, op_name, created_at")
    .eq("platform", "google_ads")
    .eq("mode", "execute")
    .in("shop_id", authorizedShopIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`getRecentGoogleAdsChanges failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.mutation_key ?? row.op_name ?? "Google Ads change"),
    occurredAt: String(row.created_at),
  }));
}
