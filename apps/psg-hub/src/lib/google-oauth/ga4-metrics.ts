import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { Ga4Metrics } from "@/lib/analytics/types";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { getGa4DataClient } from "./ga4-client";

/**
 * GA4 daily traffic metrics (Phase 11 / 11-02). ONE trailing-window runReport per
 * property (dimensions=[date], account-level daily totals — NO channel dimension,
 * which would split each day into N rows; RESEARCH quota: prefer one trailing call
 * over N single-day calls). Returns Map<dateISO, Ga4Metrics> — one entry per day.
 *
 * GA4 Data API contract traps (RESEARCH, all CONFIRMED):
 *  - `keyEvents` is the conversions metric — `conversions` is deprecated (2024).
 *  - dateRanges send YYYY-MM-DD; the `date` dimension returns YYYYMMDD (no dashes)
 *    — reformat before it becomes the snapshot DATE key.
 *  - ALL metricValues come back as STRINGS — Number() before arithmetic/storage.
 *  - sampling/thresholding/(other)-rollup are SILENT — log the metadata per run.
 */

// Request metric name -> Ga4Metrics jsonb key. Header-indexed (NOT positional).
const METRIC_MAP: Record<string, keyof Ga4Metrics> = {
  sessions: "sessions",
  totalUsers: "total_users",
  activeUsers: "active_users",
  newUsers: "new_users",
  engagedSessions: "engaged_sessions",
  keyEvents: "key_events",
  engagementRate: "engagement_rate",
};
const REQUEST_METRICS = Object.keys(METRIC_MAP).map((name) => ({ name }));

/** Minimal shapes of the runReport response (the fields the parser reads). */
type Ga4ResponseRow = {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
};
type Ga4RunReportResponse = {
  metricHeaders?: Array<{ name?: string | null }> | null;
  rows?: Ga4ResponseRow[] | null;
  rowCount?: number | null;
  metadata?: {
    samplingMetadatas?: unknown;
    subjectToThresholding?: boolean | null;
    dataLossFromOtherRow?: boolean | null;
  } | null;
  propertyQuota?: unknown;
};

export type Ga4Window = { startDate: string; endDate: string }; // YYYY-MM-DD

/** Run one runReport and return the raw response. Default builds the gax client. */
export type Ga4RunReportFn = (
  request: Record<string, unknown>
) => Promise<Ga4RunReportResponse>;

export type FetchGa4DailyMetricsDeps = {
  /** Test seam — bypasses the gax client entirely. */
  runReport?: Ga4RunReportFn;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

export function isRetryableGa4Error(err: unknown): boolean {
  const code = err instanceof GoogleApiError ? err.code : mapGoogleApiError(err).code;
  return code === "timeout" || code === "upstream" || code === "rate_limited";
}

const defaultGa4Breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableGa4Error,
});

const YYYYMMDD = /^\d{8}$/;

/** GA4's compact `YYYYMMDD` date-dimension value -> ISO `YYYY-MM-DD`. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (!YYYYMMDD.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function emptyMetrics(): Ga4Metrics {
  return {
    sessions: 0,
    total_users: 0,
    active_users: 0,
    new_users: 0,
    engaged_sessions: 0,
    key_events: 0,
    engagement_rate: 0,
  };
}

export async function fetchGa4DailyMetrics(
  shopId: string,
  window: Ga4Window,
  deps: FetchGa4DailyMetricsDeps = {}
): Promise<Map<string, Ga4Metrics>> {
  const breaker = deps.breaker ?? defaultGa4Breaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableGa4Error,
    ...deps.retry,
  };

  const runReport = deps.runReport ?? defaultRunReport(shopId);

  const request = {
    dateRanges: [{ startDate: window.startDate, endDate: window.endDate }],
    dimensions: [{ name: "date" }],
    metrics: REQUEST_METRICS,
    orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    keepEmptyRows: false,
    returnPropertyQuota: true,
    limit: 100000,
  };

  let resp: Ga4RunReportResponse;
  try {
    resp = await breaker.execute(() => withRetry(() => runReport(request), retry));
  } catch (err) {
    throw mapGoogleApiError(err);
  }

  // Silent-failure surfaces — log, never drop (no per-call ledger by design).
  const md = resp.metadata;
  if (md?.subjectToThresholding || md?.dataLossFromOtherRow || md?.samplingMetadatas) {
    console.warn(
      `[ga4-metrics] shop ${shopId} quality: thresholded=${Boolean(
        md?.subjectToThresholding
      )} dataLossFromOtherRow=${Boolean(md?.dataLossFromOtherRow)} sampled=${Boolean(
        md?.samplingMetadatas
      )}`
    );
  }
  if (resp.propertyQuota) {
    console.warn(
      `[ga4-metrics] shop ${shopId} propertyQuota ${JSON.stringify(resp.propertyQuota)}`
    );
  }

  // Map each request metric name to its response column index by HEADER name
  // (do NOT assume positional order — the API may reorder).
  const headerIndex = new Map<string, number>();
  (resp.metricHeaders ?? []).forEach((h, i) => {
    if (h?.name) headerIndex.set(h.name, i);
  });

  const out = new Map<string, Ga4Metrics>();
  for (const row of resp.rows ?? []) {
    const rawDate = row.dimensionValues?.[0]?.value ?? "";
    const date = toIsoDate(rawDate);
    if (!date) continue; // skip a malformed date rather than poison the key

    const metrics = emptyMetrics();
    for (const [reqName, jsonbKey] of Object.entries(METRIC_MAP)) {
      const idx = headerIndex.get(reqName);
      if (idx === undefined) continue;
      const valueStr = row.metricValues?.[idx]?.value ?? "0";
      const n = Number(valueStr);
      metrics[jsonbKey] = Number.isFinite(n) ? n : 0;
    }
    out.set(date, metrics);
  }
  return out;
}

function defaultRunReport(shopId: string): Ga4RunReportFn {
  return async (request) => {
    const { client, property } = await getGa4DataClient(shopId);
    // gax runReport resolves to a [response, ...] tuple.
    const [resp] = await client.runReport({ ...request, property });
    return resp as Ga4RunReportResponse;
  };
}
