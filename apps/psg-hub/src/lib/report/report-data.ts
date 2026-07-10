// Phase 12 / 12-01 — Report data assembler.
// Turns daily analytics_snapshots rows into one ReportData per shop per month.
// PURE + testable: the DB read is injected as `deps.readSnapshots` (a pre-bound
// reader the caller wires to getSnapshots(client, ...) in the cron/route layer),
// and the clock is injected as `deps.generatedAt`. This module never imports the
// server-only snapshots module, so it runs under vitest's node env.

import type {
  AnalyticsSnapshot,
  AnalyticsSource,
  Ga4DimensionsMetrics,
  GbpPresenceMetrics,
  MonthlySnapshotRow,
  PerformanceMetrics,
} from "../analytics/types";
import { toSeries } from "../analytics/aggregate";
import type { SeriesPoint } from "../analytics/aggregate";
import { monthWindow, priorMonth, rollupMonth, momDelta } from "../analytics/rollup";
import type {
  ReportData,
  SourceReportBlock,
  Ga4DimensionsReport,
  PerformanceReport,
  GbpPresenceReport,
  SentimentReport,
} from "./types";
import type { LocalFalconReport } from "../local-falcon/types";

/** The live sources, in report display order. */
const SOURCES: AnalyticsSource[] = ["semrush", "google_ads", "ga4", "gsc", "gbp"];

/** Headline metrics charted as a daily trend per source in the report month. */
const TREND_KEYS: Record<AnalyticsSource, string[]> = {
  semrush: ["organic_traffic", "organic_keywords"],
  google_ads: ["spend", "conversions"],
  ga4: ["sessions", "key_events"],
  gsc: ["clicks", "impressions"],
  gbp: ["call_clicks", "website_clicks"],
};

/** A pre-bound snapshot reader: the caller binds the supabase client. */
export type SnapshotReader = (query: {
  shopId: string;
  source: AnalyticsSource;
  period: "daily";
  from: string;
  to: string;
}) => Promise<AnalyticsSnapshot[]>;

/**
 * A pre-bound reader for the ONE monthly ga4_dimensions row (Phase 12 / 12-05a). The
 * caller binds it to getSnapshots(client, { source:'ga4_dimensions', period:'monthly',
 * from/to = first-of-month }) in the cron/route layer. OPTIONAL: when absent (the daily
 * callers and every existing test) ReportData.dimensions stays undefined.
 */
export type MonthlyDimensionsReader = (query: {
  shopId: string;
  month: string; // 'YYYY-MM'
}) => Promise<MonthlySnapshotRow | null>;

/**
 * A pre-bound reader for the ONE monthly performance row (Phase 12 / 12-05b). MIRRORS
 * MonthlyDimensionsReader — the caller binds it to getSnapshots(client, { source:'performance',
 * period:'monthly', ... }). OPTIONAL: absent => ReportData.performance stays undefined.
 */
export type MonthlyPerformanceReader = (query: {
  shopId: string;
  month: string; // 'YYYY-MM'
}) => Promise<MonthlySnapshotRow | null>;

/**
 * A pre-bound reader for the ONE monthly gbp_presence row (Phase 13 / 13-03). MIRRORS
 * MonthlyPerformanceReader — the caller binds it to getMonthlySnapshot(client, { source:'gbp_presence',
 * period:'monthly', ... }). OPTIONAL: absent => ReportData.gbpPresence stays undefined.
 */
export type MonthlyGbpPresenceReader = (query: {
  shopId: string;
  month: string; // 'YYYY-MM'
}) => Promise<MonthlySnapshotRow | null>;

export type AssembleDeps = {
  readSnapshots: SnapshotReader;
  /** ISO timestamp stamped onto the report (injected for purity/determinism). */
  generatedAt: string;
  /** Optional rollup-bypassing reader for the monthly GA4 dimensional row (12-05a). */
  readMonthlyDimensions?: MonthlyDimensionsReader;
  /** Optional rollup-bypassing reader for the monthly performance row (12-05b). */
  readMonthlyPerformance?: MonthlyPerformanceReader;
  /** Optional rollup-bypassing reader for the monthly GBP presence row (13-03). */
  readMonthlyGbpPresence?: MonthlyGbpPresenceReader;
  /** Optional reader for the monthly review-sentiment summary (14-03b); null => block omitted. */
  readReviewSentiment?: (query: {
    shopId: string;
    month: string;
  }) => Promise<SentimentReport | null>;
  /** Optional latest Local Falcon visibility snapshot reader (PSG-1079). */
  readLocalFalconVisibility?: (query: {
    shopId: string;
    month: string;
  }) => Promise<LocalFalconReport | null>;
};

/**
 * Build the additive ReportData.dimensions block from a monthly ga4_dimensions row.
 * bounce_rate is DERIVED (1 - the rolled-up monthly engagement_rate of the assembled
 * ga4 block), null when ga4 is not linked. This NEVER calls rollupMonth on the
 * dimensional arrays — they are not summable metric-class data.
 */
function buildDimensions(
  row: MonthlySnapshotRow,
  ga4Block: SourceReportBlock | undefined
): Ga4DimensionsReport {
  const m = row.metrics as unknown as Partial<Ga4DimensionsMetrics>;
  const engagementRate = ga4Block?.current.engagement_rate;
  const bounceRate =
    typeof engagementRate === "number" ? 1 - engagementRate : null;
  return {
    topChannels: m.topChannels ?? [],
    topLandingPages: m.topLandingPages ?? [],
    devices: m.devices ?? [],
    newVsReturning: m.newVsReturning ?? [],
    averageSessionDuration: m.averageSessionDuration ?? 0,
    bounceRate,
  };
}

/**
 * Build the additive ReportData.performance block from a monthly performance row. NEVER calls
 * rollupMonth — perf is point-in-time STOCK. Returns null when the row has no PSI payload.
 */
function buildPerformance(row: MonthlySnapshotRow): PerformanceReport | null {
  const m = row.metrics as unknown as Partial<PerformanceMetrics>;
  if (!m.psi) return null;
  return {
    psi: m.psi,
    gtmetrix: m.gtmetrix ?? null,
    strategy: "mobile",
    testedUrl: typeof m.tested_url === "string" ? m.tested_url : "",
  };
}

/**
 * Build the additive ReportData.gbpPresence block from a monthly gbp_presence row (Phase 13 /
 * 13-03). NEVER calls rollupMonth — presence is point-in-time STOCK. Maps the snake_case jsonb
 * (GbpPresenceMetrics) to the camelCase report shape; the rating pair stays nullable.
 */
function buildGbpPresence(row: MonthlySnapshotRow): GbpPresenceReport {
  const m = row.metrics as unknown as Partial<GbpPresenceMetrics>;
  return {
    openStatus: typeof m.open_status === "string" ? m.open_status : "",
    primaryCategory: m.primary_category ?? null,
    categories: Array.isArray(m.categories) ? m.categories : [],
    hasHours: m.has_hours === true,
    websiteUri: m.website_uri ?? null,
    hasDescription: m.has_description === true,
    phonePresent: m.phone_present === true,
    ...(typeof m.completeness_score === "number"
      ? { completenessScore: m.completeness_score }
      : {}),
    averageRating: typeof m.average_rating === "number" ? m.average_rating : null,
    totalReviewCount:
      typeof m.total_review_count === "number" ? m.total_review_count : null,
  };
}

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

  // Additive monthly dimensional block (12-05a). Read off a SEPARATE path that
  // bypasses the daily SOURCES rollup loop entirely; omitted when no reader is wired
  // or no monthly row exists (graceful omission — the daily assembly above is unchanged).
  let dimensions: Ga4DimensionsReport | undefined;
  if (deps.readMonthlyDimensions) {
    const row = await deps.readMonthlyDimensions({ shopId, month: periodMonth });
    if (row) dimensions = buildDimensions(row, sources.ga4);
  }

  // Additive monthly performance block (12-05b) — same separate, rollup-bypassing path.
  let performance: PerformanceReport | undefined;
  if (deps.readMonthlyPerformance) {
    const row = await deps.readMonthlyPerformance({ shopId, month: periodMonth });
    if (row) performance = buildPerformance(row) ?? undefined;
  }

  // Additive monthly GBP presence + rating block (13-03) — same separate, rollup-bypassing path.
  let gbpPresence: GbpPresenceReport | undefined;
  if (deps.readMonthlyGbpPresence) {
    const row = await deps.readMonthlyGbpPresence({ shopId, month: periodMonth });
    if (row) gbpPresence = buildGbpPresence(row);
  }

  // Additive review-sentiment block (14-03b) — read off review_sentiment (NOT snapshots); the
  // reader returns null when the shop has no classified reviews in the month -> block omitted.
  let sentiment: SentimentReport | undefined;
  if (deps.readReviewSentiment) {
    const s = await deps.readReviewSentiment({ shopId, month: periodMonth });
    if (s) sentiment = s;
  }

  let localFalcon: LocalFalconReport | undefined;
  if (deps.readLocalFalconVisibility) {
    const lf = await deps.readLocalFalconVisibility({ shopId, month: periodMonth });
    if (lf) localFalcon = lf;
  }

  return {
    shopId,
    periodMonth,
    window: cur,
    sources,
    linkedSources,
    sourcesWithPriorMonth,
    generatedAt: deps.generatedAt,
    ...(dimensions ? { dimensions } : {}),
    ...(performance ? { performance } : {}),
    ...(gbpPresence ? { gbpPresence } : {}),
    ...(sentiment ? { sentiment } : {}),
    ...(localFalcon ? { localFalcon } : {}),
  };
}

// re-export the SeriesPoint type users of trend will reference
export type { SeriesPoint } from "../analytics/aggregate";
