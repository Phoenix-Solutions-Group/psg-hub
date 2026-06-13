// Phase 12 / 12-01 — Report payload types.
// ReportData is the SINGLE structured object both the multi-LLM narrative (12-02)
// and the branded PDF (12-03) consume. It is assembled per shop per month from the
// four live sources by report-data.ts. Pure data: no clock read, no IO.

import type { SeriesPoint } from "../analytics/aggregate";
import type {
  AnalyticsSource,
  Ga4DimensionRow,
  PsiResult,
  GtmetrixResult,
} from "../analytics/types";

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
  /**
   * GA4 secondary-dimension block (Phase 12 / 12-05a). ADDITIVE + OPTIONAL: present
   * only when a ga4_dimensions monthly row exists for the shop+month, read off a
   * separate monthly path that bypasses rollupMonth entirely (top-N arrays are not
   * FLOW/STOCK/DERIVED and never enter METRIC_REGISTRY). Undefined => the four render
   * sections are omitted. Lives OUTSIDE `sources`, parallel to SourceReportBlock —
   * never threaded through it, never added to the AnalyticsSource union.
   */
  dimensions?: Ga4DimensionsReport;
  /**
   * Website-performance block (Phase 12 / 12-05b). ADDITIVE + OPTIONAL: present only when a
   * `performance` monthly row exists for the shop+month, read off the same rollup-bypassing
   * monthly path as `dimensions`. Undefined => the perf render block is omitted. Point-in-time
   * STOCK, never rolled up, never in the AnalyticsSource union.
   */
  performance?: PerformanceReport;
};

/**
 * The report-layer view of website-performance data — Phase 12 / 12-05b. PSI lab is always
 * present; `psi.field` (CrUX real-user) is null when CrUX has no data (render lab-only with a
 * "Lab data" label); `gtmetrix` is null when its key is unset or the shop is out of GTMetrix scope.
 */
export type PerformanceReport = {
  psi: PsiResult;
  gtmetrix: GtmetrixResult | null;
  strategy: "mobile";
  testedUrl: string;
};

/**
 * The report-layer view of the GA4 dimensional data — Phase 12 / 12-05a. The four
 * top-N tables plus the sessions-weighted averageSessionDuration (seconds) and a
 * derived bounceRate (1 - the monthly engagement_rate from the assembled ga4 block;
 * null when ga4 is not linked, never a fabricated 0).
 */
export type Ga4DimensionsReport = {
  topChannels: Ga4DimensionRow[];
  topLandingPages: Ga4DimensionRow[];
  devices: Ga4DimensionRow[];
  newVsReturning: Ga4DimensionRow[];
  averageSessionDuration: number; // seconds
  bounceRate: number | null; // derived 1 - engagement_rate; null when ga4 absent
};
