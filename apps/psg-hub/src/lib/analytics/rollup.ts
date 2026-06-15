// Phase 12 / 12-01 — Monthly rollup engine for the PSG report.
// Pure + side-effect-free + node-testable. The four ingest sources write ONLY
// `period:'daily'` rows (sync paths never write monthly), so the monthly report
// derives its numbers at report time from daily rows. The hard part is that a
// naive sum corrupts two of the three metric classes:
//
//   FLOW    — sum across the month (sessions, clicks, spend, ...).
//   STOCK   — take the latest-dated row's value, NEVER a sum. SEMrush metrics are
//             point-in-time snapshots re-recorded daily (organic_traffic is itself
//             an "estimated monthly visits" value — summing it ~30x overcounts).
//   DERIVED — a ratio/average that MUST be recomputed from summed components, NEVER
//             averaged across days (cpl, ctr, position, engagement_rate). A mean of
//             daily ratios is a different, wrong number.
//
// An empty month yields null (no data), distinct from a zero-filled object.

import type { DatedMetrics } from "./aggregate";
import { latestSnapshot } from "./aggregate";
import type { AnalyticsSource } from "./types";

export type MetricClass = "flow" | "stock" | "derived";

/** Per-source metric-class registry. Keys mirror the metric shapes in types.ts. */
export const METRIC_REGISTRY: Record<
  AnalyticsSource,
  { flow: string[]; stock: string[]; derived: string[] }
> = {
  // SEMrush rows are point-in-time snapshots: every metric is STOCK (latest).
  // organic_traffic is an estimated-monthly value re-snapshotted daily — summing
  // it overcounts, so it is latest-not-sum like the rest.
  semrush: {
    flow: [],
    stock: [
      "organic_keywords",
      "organic_traffic",
      "organic_traffic_cost",
      "backlinks",
      "authority_score",
    ],
    derived: [],
  },
  // Google Ads daily totals sum honestly; cpl is a recomputed ratio.
  google_ads: {
    flow: ["spend", "clicks", "impressions", "conversions", "cost_micros"],
    stock: [],
    derived: ["cpl"], // sum(spend) / sum(conversions)
  },
  // GA4: counts sum. total_users/active_users are summed but APPROXIMATE — a daily
  // sum overcounts monthly unique users; true monthly uniques need a monthly
  // runReport (deferred). engagement_rate is recomputed from summed components.
  ga4: {
    flow: [
      "sessions",
      "total_users", // approximate: daily sum overcounts monthly uniques (deferred)
      "active_users", // approximate: daily sum overcounts monthly uniques (deferred)
      "new_users",
      "engaged_sessions",
      "key_events",
    ],
    stock: [],
    derived: ["engagement_rate"], // sum(engaged_sessions) / sum(sessions)
  },
  // GSC: clicks/impressions sum; ctr and (impression-weighted) position recompute.
  gsc: {
    flow: ["clicks", "impressions"],
    stock: [],
    derived: ["ctr", "position"], // ctr = clicks/impr; position = impression-weighted
  },
  // GBP: every Performance API daily action/impression count is FLOW and sums honestly
  // (impressions_total is the per-day sum of the four splits, itself summable). There is
  // NO ratio here, so NOTHING is stock or derived — no deriveMetric branch, nothing
  // aggregate-excluded (unlike ga4/gsc/ads).
  gbp: {
    flow: [
      "impressions_desktop_maps",
      "impressions_desktop_search",
      "impressions_mobile_maps",
      "impressions_mobile_search",
      "impressions_total",
      "website_clicks",
      "call_clicks",
      "direction_requests",
      "conversations",
    ],
    stock: [],
    derived: [],
  },
};

/** Numeric metric value or null (non-number / missing -> null). */
function numOrNull(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Sum a metric key across rows; non-numeric / missing values count as 0. */
function sumKey(rows: DatedMetrics[], key: string): number {
  let total = 0;
  for (const row of rows) {
    const raw = row.metrics[key];
    if (typeof raw === "number" && Number.isFinite(raw)) total += raw;
  }
  return total;
}

/** Sum of (value_i * weight_i) over rows where BOTH are finite numbers. */
function weightedSum(
  rows: DatedMetrics[],
  valueKey: string,
  weightKey: string
): number {
  let total = 0;
  for (const row of rows) {
    const v = row.metrics[valueKey];
    const w = row.metrics[weightKey];
    if (
      typeof v === "number" &&
      Number.isFinite(v) &&
      typeof w === "number" &&
      Number.isFinite(w)
    ) {
      total += v * w;
    }
  }
  return total;
}

/** Recompute one DERIVED metric from summed components (never averaged). */
function deriveMetric(
  source: AnalyticsSource,
  key: string,
  sums: Record<string, number>,
  rows: DatedMetrics[]
): number | null {
  if (source === "google_ads" && key === "cpl") {
    return sums.conversions === 0 ? null : sums.spend / sums.conversions;
  }
  if (source === "ga4" && key === "engagement_rate") {
    return sums.sessions === 0 ? null : sums.engaged_sessions / sums.sessions;
  }
  if (source === "gsc" && key === "ctr") {
    return sums.impressions === 0 ? null : sums.clicks / sums.impressions;
  }
  if (source === "gsc" && key === "position") {
    // Impression-weighted average rank: sum(position_i * impressions_i) / sum(impressions_i).
    return sums.impressions === 0
      ? null
      : weightedSum(rows, "position", "impressions") / sums.impressions;
  }
  return null;
}

/**
 * Roll a single source's daily rows (already filtered to one calendar month) into
 * one monthly value per metric key, by class. Returns null for an empty month.
 */
export function rollupMonth(
  source: AnalyticsSource,
  rows: DatedMetrics[]
): Record<string, number | null> | null {
  if (rows.length === 0) return null;

  const reg = METRIC_REGISTRY[source];
  const out: Record<string, number | null> = {};

  // FLOW: sum. Capture sums for DERIVED recomputation.
  const sums: Record<string, number> = {};
  for (const key of reg.flow) {
    sums[key] = sumKey(rows, key);
    out[key] = sums[key];
  }

  // STOCK: latest-dated row's value (never a sum).
  const latest = latestSnapshot(rows);
  for (const key of reg.stock) {
    out[key] = numOrNull(latest?.metrics[key]);
  }

  // DERIVED: recompute from summed components.
  for (const key of reg.derived) {
    out[key] = deriveMetric(source, key, sums, rows);
  }

  return out;
}

/** Inclusive ISO date bounds [first..last] of a 'YYYY-MM' calendar month (UTC). */
export function monthWindow(periodMonth: string): { start: string; end: string } {
  const [y, m] = periodMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based; day 0 = last of prev
  const mm = String(m).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** The calendar month before a 'YYYY-MM' (handles Jan -> prior Dec). */
export function priorMonth(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/**
 * Month-over-month change as a signed ratio ((current - prior) / prior).
 * null when either side is null or prior is 0 (no meaningful delta).
 */
export function momDelta(
  current: number | null,
  prior: number | null
): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return (current - prior) / prior;
}
