// Phase 9 / 09-02 — pure analytics shaping helpers.
// Everything here is side-effect-free and node-testable: the page stays a thin
// fetch-and-render layer, and the MSO aggregate math is provable in unit tests.

import type { AnalyticsSnapshot } from "./types";

/** A date-keyed row shared by per-shop snapshots and cross-shop aggregates. */
export type DatedMetrics = {
  date: string; // ISO date (YYYY-MM-DD)
  metrics: Record<string, unknown>;
};

/** A chart-ready series point ({ date, value }) for the 09-01 chart primitives. */
export type SeriesPoint = { date: string; value: number };

/**
 * MSO cross-shop aggregate: sum NUMERIC metric keys across shops per date.
 * Non-numeric metric values are dropped (jsonb is open-shaped); a key missing
 * from one shop's row counts as 0 for that shop. Output is sorted ascending by
 * date. NOTE: only meaningful for summable metrics (traffic, keywords,
 * backlinks, cost) — scores like authority_score must NOT be surfaced from an
 * aggregate (a summed 0-100 score is a lie); the page picks summable KPIs only.
 */
export function aggregateByDate(snapshots: DatedMetrics[]): DatedMetrics[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const snap of snapshots) {
    const acc = byDate.get(snap.date) ?? {};
    for (const [key, raw] of Object.entries(snap.metrics)) {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        acc[key] = (acc[key] ?? 0) + raw;
      }
    }
    byDate.set(snap.date, acc);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, metrics]) => ({ date, metrics }));
}

/** Newest row by date (rows may arrive unsorted). null on empty. */
export function latestSnapshot<T extends { date: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((max, row) => (row.date > max.date ? row : max));
}

/**
 * Shape one metric key into a chart series. Non-numeric / missing values
 * become 0 so a partially-shaped jsonb row can never crash a chart.
 */
export function toSeries(rows: DatedMetrics[], key: string): SeriesPoint[] {
  return rows.map((row) => {
    const raw = row.metrics[key];
    return {
      date: row.date,
      value: typeof raw === "number" && Number.isFinite(raw) ? raw : 0,
    };
  });
}

/** "Last synced" display string — fixed locale + UTC for determinism. */
export function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** Short axis label for an ISO date ("Jun 4") — fixed locale + UTC. */
export function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** KPI display formatting — fixed locale, grouped thousands. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Trailing date window as inclusive ISO dates. The impure clock read lives
 * HERE (injectable for tests), not in a component render (react-compiler
 * purity rule) — server pages call this once per request.
 */
export function trailingWindow(
  days: number,
  now: Date = new Date()
): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/** The newest synced_at across snapshot rows (sync may be skewed per shop). */
export function latestSyncedAt(rows: Pick<AnalyticsSnapshot, "synced_at">[]): string | null {
  let max: string | null = null;
  for (const row of rows) {
    if (row.synced_at && (max === null || row.synced_at > max)) max = row.synced_at;
  }
  return max;
}
