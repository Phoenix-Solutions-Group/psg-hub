// Phase 12 / 12-01 — Report payload types.
// ReportData is the SINGLE structured object both the multi-LLM narrative (12-02)
// and the branded PDF (12-03) consume. It is assembled per shop per month from the
// four live sources by report-data.ts. Pure data: no clock read, no IO.

import type { SeriesPoint } from "../analytics/aggregate";
import type { AnalyticsSource } from "../analytics/types";

/**
 * One source's monthly block. `current`/`prior` are the rolled-up monthly values
 * (FLOW summed, STOCK latest, DERIVED recomputed — see analytics/rollup.ts), keyed
 * by metric. `prior` is null when the shop has no clean prior month (cold start).
 * `momDelta` is the per-metric month-over-month signed ratio (null where undefined).
 * `trend` is the daily series for the source's headline metrics over the report month.
 */
export type SourceReportBlock = {
  source: AnalyticsSource;
  current: Record<string, number | null>;
  prior: Record<string, number | null> | null;
  momDelta: Record<string, number | null>;
  trend: Record<string, SeriesPoint[]>;
};

/**
 * The full report input for one shop and one month. Sources the shop is not linked
 * to (or that returned no data for the month) are OMITTED from `sources` — never
 * present-with-zeros. `linkedSources` lists the sources that produced a current
 * block; `sourcesWithPriorMonth` lists those with a usable prior month (the rest
 * fall back to within-period framing). `generatedAt` is supplied by the caller so
 * assembly stays pure and deterministic.
 */
export type ReportData = {
  shopId: string;
  periodMonth: string; // 'YYYY-MM'
  window: { start: string; end: string };
  sources: Partial<Record<AnalyticsSource, SourceReportBlock>>;
  linkedSources: AnalyticsSource[];
  sourcesWithPriorMonth: AnalyticsSource[];
  generatedAt: string; // ISO timestamp, injected by the caller
};
