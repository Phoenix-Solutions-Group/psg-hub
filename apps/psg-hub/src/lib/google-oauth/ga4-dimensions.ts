import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type {
  Ga4DimensionRow,
  Ga4DimensionsMetrics,
} from "@/lib/analytics/types";
import { mapGoogleApiError } from "./client";
import { getGa4DataClient } from "./ga4-client";
import { isRetryableGa4Error } from "./ga4-metrics";

/**
 * GA4 secondary-dimension monthly fetch (Phase 12 / 12-05a). Structural mirror of
 * ga4-metrics.ts (CircuitBreaker + withRetry, getGa4DataClient, header-indexed parse,
 * all metricValues are STRINGS -> Number, returnPropertyQuota logging) with a DIFFERENT
 * request shape:
 *
 *  - ONE monthly-window runReport PER section dimension (four calls), NOT one combined
 *    multi-dimension report (the cross-product overflows the 50k-row cap and collapses
 *    every marginal into (other)), NOT a daily loop (per-day (other)/thresholding bites
 *    harder). RESEARCH "GA4 dimensional ingest".
 *  - Each call: single monthly dateRange (NO `date` dimension), one secondary dimension,
 *    sessions descending, limit=TOP_N for payload size, and metricAggregations=['TOTAL'].
 *    The TOTAL aggregate is over the FULL matching set (not just the limited rows), so it
 *    yields the true dimension month total even when only top-N rows return — that total
 *    is what makes the '(other)' remainder honest for high-cardinality dimensions like
 *    landing pages (RESEARCH/advisor: sum(topN) is NOT the month total there).
 *  - averageSessionDuration (seconds) is read from the DEVICE report's TOTAL row, where
 *    GA4 computes the correctly sessions-weighted month aggregate. bounce_rate is NOT
 *    fetched (derived later as 1 - engagement_rate from already-ingested daily ga4 data).
 */

/** Top-N rows kept per dimension for payload/render size (quota lever is call COUNT,
 *  not limit — RESEARCH; top-N only bounds the stored array). */
export const TOP_N = 10;

type SectionKey = keyof Pick<
  Ga4DimensionsMetrics,
  "topChannels" | "topLandingPages" | "devices" | "newVsReturning"
>;

/** Section -> GA4 Data API dimension apiName (all RESEARCH-confirmed valid). */
const SECTIONS: { key: SectionKey; dimension: string }[] = [
  { key: "topChannels", dimension: "sessionDefaultChannelGroup" },
  { key: "topLandingPages", dimension: "landingPagePlusQueryString" },
  { key: "devices", dimension: "deviceCategory" },
  { key: "newVsReturning", dimension: "newVsReturning" },
];

/** Request metric names (header-indexed in the response, NOT positional). */
const REQUEST_METRICS = [
  "sessions",
  "totalUsers",
  "engagedSessions",
  "engagementRate",
  "averageSessionDuration",
].map((name) => ({ name }));

type Ga4ResponseRow = {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
};
type Ga4RunReportResponse = {
  metricHeaders?: Array<{ name?: string | null }> | null;
  rows?: Ga4ResponseRow[] | null;
  totals?: Ga4ResponseRow[] | null;
  metadata?: {
    samplingMetadatas?: unknown;
    subjectToThresholding?: boolean | null;
    dataLossFromOtherRow?: boolean | null;
  } | null;
  propertyQuota?: unknown;
};

export type Ga4Month = { start: string; end: string }; // YYYY-MM-DD inclusive

export type Ga4RunReportFn = (
  request: Record<string, unknown>
) => Promise<Ga4RunReportResponse>;

export type FetchGa4DimensionsDeps = {
  /** Test seam — bypasses the gax client entirely. */
  runReport?: Ga4RunReportFn;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

const defaultGa4Breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableGa4Error,
});

/** Number() a header-indexed metric off a row; 0 when missing/non-finite. */
function metricNumber(
  row: Ga4ResponseRow | undefined,
  headerIndex: Map<string, number>,
  name: string
): number {
  if (!row) return 0;
  const idx = headerIndex.get(name);
  if (idx === undefined) return 0;
  const n = Number(row.metricValues?.[idx]?.value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export async function fetchGa4Dimensions(
  shopId: string,
  month: Ga4Month,
  deps: FetchGa4DimensionsDeps = {}
): Promise<Ga4DimensionsMetrics> {
  const breaker = deps.breaker ?? defaultGa4Breaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableGa4Error,
    ...deps.retry,
  };
  const runReport = deps.runReport ?? defaultRunReport(shopId);

  const out: Ga4DimensionsMetrics = {
    topChannels: [],
    topLandingPages: [],
    devices: [],
    newVsReturning: [],
    averageSessionDuration: 0,
  };

  for (const section of SECTIONS) {
    const request = {
      dateRanges: [{ startDate: month.start, endDate: month.end }],
      dimensions: [{ name: section.dimension }],
      metrics: REQUEST_METRICS,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      metricAggregations: ["TOTAL"],
      limit: TOP_N,
      returnPropertyQuota: true,
    };

    let resp: Ga4RunReportResponse;
    try {
      resp = await breaker.execute(() => withRetry(() => runReport(request), retry));
    } catch (err) {
      throw mapGoogleApiError(err);
    }

    const md = resp.metadata;
    if (md?.subjectToThresholding || md?.dataLossFromOtherRow || md?.samplingMetadatas) {
      console.warn(
        `[ga4-dimensions] shop ${shopId} ${section.dimension} quality: thresholded=${Boolean(
          md?.subjectToThresholding
        )} dataLossFromOtherRow=${Boolean(md?.dataLossFromOtherRow)} sampled=${Boolean(
          md?.samplingMetadatas
        )}`
      );
    }
    if (resp.propertyQuota) {
      console.warn(
        `[ga4-dimensions] shop ${shopId} ${section.dimension} propertyQuota ${JSON.stringify(
          resp.propertyQuota
        )}`
      );
    }

    const headerIndex = new Map<string, number>();
    (resp.metricHeaders ?? []).forEach((h, i) => {
      if (h?.name) headerIndex.set(h.name, i);
    });

    const rows: Ga4DimensionRow[] = (resp.rows ?? []).map((r) => {
      const row: Ga4DimensionRow = {
        name: r.dimensionValues?.[0]?.value ?? "(unknown)",
        sessions: metricNumber(r, headerIndex, "sessions"),
        users: metricNumber(r, headerIndex, "totalUsers"),
      };
      const er = metricNumber(r, headerIndex, "engagementRate");
      if (Number.isFinite(er)) row.engagement_rate = er;
      return row;
    });

    // TOTAL aggregate row reconciles the section: (other) = month total - sum(top-N).
    const totalRow = resp.totals?.[0];
    const totalSessions = totalRow
      ? metricNumber(totalRow, headerIndex, "sessions")
      : rows.reduce((s, r) => s + r.sessions, 0);
    const sumTopSessions = rows.reduce((s, r) => s + r.sessions, 0);
    const otherSessions = totalSessions - sumTopSessions;
    if (otherSessions > 0) {
      const totalUsers = metricNumber(totalRow, headerIndex, "totalUsers");
      const sumTopUsers = rows.reduce((s, r) => s + r.users, 0);
      rows.push({
        name: "(other)",
        sessions: otherSessions,
        users: Math.max(0, totalUsers - sumTopUsers),
      });
    }

    out[section.key] = rows;

    // averageSessionDuration: the device report's sessions-weighted TOTAL (seconds).
    if (section.key === "devices" && totalRow) {
      out.averageSessionDuration = metricNumber(
        totalRow,
        headerIndex,
        "averageSessionDuration"
      );
    }
  }

  return out;
}

function defaultRunReport(shopId: string): Ga4RunReportFn {
  return async (request) => {
    const { client, property } = await getGa4DataClient(shopId);
    const [resp] = await client.runReport({ ...request, property });
    return resp as Ga4RunReportResponse;
  };
}
