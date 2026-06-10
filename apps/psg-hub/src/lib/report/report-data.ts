// Phase 12 / 12-01 — Report data assembler.
// Turns daily analytics_snapshots rows into one ReportData per shop per month.
// PURE + testable: the DB read is injected as `deps.readSnapshots` (a pre-bound
// reader the caller wires to getSnapshots(client, ...) in the cron/route layer),
// and the clock is injected as `deps.generatedAt`. This module never imports the
// server-only snapshots module, so it runs under vitest's node env.

import type { AnalyticsSnapshot, AnalyticsSource } from "../analytics/types";
import { toSeries } from "../analytics/aggregate";
import type { SeriesPoint } from "../analytics/aggregate";
import { monthWindow, priorMonth, rollupMonth, momDelta } from "../analytics/rollup";
import type { ReportData, SourceReportBlock } from "./types";

/** The four live sources, in report display order. */
const SOURCES: AnalyticsSource[] = ["semrush", "google_ads", "ga4", "gsc"];

/** Headline metrics charted as a daily trend per source in the report month. */
const TREND_KEYS: Record<AnalyticsSource, string[]> = {
  semrush: ["organic_traffic", "organic_keywords"],
  google_ads: ["spend", "conversions"],
  ga4: ["sessions", "key_events"],
  gsc: ["clicks", "impressions"],
};

/** A pre-bound snapshot reader: the caller binds the supabase client. */
export type SnapshotReader = (query: {
  shopId: string;
  source: AnalyticsSource;
  period: "daily";
  from: string;
  to: string;
}) => Promise<AnalyticsSnapshot[]>;

export type AssembleDeps = {
  readSnapshots: SnapshotReader;
  /** ISO timestamp stamped onto the report (injected for purity/determinism). */
  generatedAt: string;
};

/** Inclusive ISO-date filter for rows within [start, end]. */
function within(rows: AnalyticsSnapshot[], start: string, end: string): AnalyticsSnapshot[] {
  return rows.filter((r) => r.date >= start && r.date <= end);
}

/**
 * Assemble the report payload for one shop and one 'YYYY-MM' month.
 * For each source it makes ONE read spanning the prior month start through the
 * report month end (covers current + prior in a single query), rolls each month
 * up by metric class, computes MoM deltas, and builds trend series. A source with
 * no current-month data is OMITTED (graceful degradation); a source with a current
 * but no prior month sets prior=null / momDelta=null (cold start).
 */
export async function assembleReportData(
  shopId: string,
  periodMonth: string,
  deps: AssembleDeps
): Promise<ReportData> {
  const cur = monthWindow(periodMonth);
  const prev = monthWindow(priorMonth(periodMonth));

  const blocks = await Promise.all(
    SOURCES.map(async (source): Promise<SourceReportBlock | null> => {
      const rows = await deps.readSnapshots({
        shopId,
        source,
        period: "daily",
        from: prev.start,
        to: cur.end,
      });

      const currentRows = within(rows, cur.start, cur.end);
      const current = rollupMonth(source, currentRows);
      if (current === null) return null; // no current data -> omit this source

      const priorRows = within(rows, prev.start, prev.end);
      const prior = rollupMonth(source, priorRows);

      const delta: Record<string, number | null> = {};
      for (const key of Object.keys(current)) {
        delta[key] = momDelta(current[key], prior === null ? null : prior[key] ?? null);
      }

      const trend: Record<string, SeriesPoint[]> = {};
      for (const key of TREND_KEYS[source]) {
        trend[key] = toSeries(currentRows, key);
      }

      return { source, current, prior, momDelta: delta, trend };
    })
  );

  const sources: Partial<Record<AnalyticsSource, SourceReportBlock>> = {};
  const linkedSources: AnalyticsSource[] = [];
  const sourcesWithPriorMonth: AnalyticsSource[] = [];

  for (const block of blocks) {
    if (block === null) continue;
    sources[block.source] = block;
    linkedSources.push(block.source);
    if (block.prior !== null) sourcesWithPriorMonth.push(block.source);
  }

  return {
    shopId,
    periodMonth,
    window: cur,
    sources,
    linkedSources,
    sourcesWithPriorMonth,
    generatedAt: deps.generatedAt,
  };
}

// re-export the SeriesPoint type users of trend will reference
export type { SeriesPoint } from "../analytics/aggregate";
