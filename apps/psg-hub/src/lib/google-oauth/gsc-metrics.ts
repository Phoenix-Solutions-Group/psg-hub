import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { GscMetrics } from "@/lib/analytics/types";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { getGscClient } from "./gsc-client";

/**
 * GSC daily search-performance metrics (Phase 11 / 11-03). ONE trailing-window
 * searchanalytics.query per site (dimensions=['date'], site-level daily totals —
 * NO query/page/country dimension, which would split each day into N rows).
 * Returns Map<dateISO, GscMetrics> — one entry per day.
 *
 * GSC Search Analytics API contract traps (RESEARCH):
 *  - The response shape is NOT the GA4 runReport shape — do NOT clone ga4-metrics.
 *    Rows are `{ keys: ['YYYY-MM-DD'], clicks, impressions, ctr, position }`: there
 *    are NO metricHeaders / metricValues, and `keys[0]` is ALREADY YYYY-MM-DD (NO
 *    reformat — that GA4 step would corrupt it).
 *  - Values arrive as JSON NUMBERS (not strings); Number() is defensive only.
 *  - `siteUrl` is a METHOD param (not a body field). googleapis@173 builds the path
 *    via an RFC-6570 url-template (`/sites/{siteUrl}/searchAnalytics/query`, expanded
 *    in googleapis-common/apirequest.js) which ALREADY percent-encodes the param —
 *    so pass it RAW (a pre-encodeURIComponent would double-encode `:`/`/` →
 *    `sc-domain%253A...` → 404/403). RESEARCH UNVERIFIED #4 framed the risk as
 *    "might need to add encoding"; the installed client encodes for us — verified
 *    against node_modules. The live round-trip is still a gate-batch confirmation.
 *  - Dates are interpreted in Pacific Time; data lags ~2-3 days, so the orchestrator
 *    pulls a WIDE trailing window and UPSERTs. `dataState:'final'` is pinned (mixing
 *    'all'/'final' across runs without an upsert-on-final strategy corrupts stored data).
 */

export type GscWindow = { startDate: string; endDate: string }; // YYYY-MM-DD

/** Minimal shape of a searchanalytics.query response row. */
type GscResponseRow = {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};
type GscQueryResponse = {
  rows?: GscResponseRow[] | null;
};

/** Run one searchanalytics.query and return the raw response body. The siteUrl is
 *  bound inside the default (it owns the linked-account read), so the seam only
 *  needs the request body — tests assert the body shape without a live site. */
export type GscQueryFn = (
  requestBody: Record<string, unknown>
) => Promise<GscQueryResponse>;

export type FetchGscDailyMetricsDeps = {
  /** Test seam — bypasses the googleapis client entirely. */
  query?: GscQueryFn;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

export function isRetryableGscError(err: unknown): boolean {
  const code = err instanceof GoogleApiError ? err.code : mapGoogleApiError(err).code;
  return code === "timeout" || code === "upstream" || code === "rate_limited";
}

const defaultGscBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableGscError,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchGscDailyMetrics(
  shopId: string,
  window: GscWindow,
  deps: FetchGscDailyMetricsDeps = {}
): Promise<Map<string, GscMetrics>> {
  const breaker = deps.breaker ?? defaultGscBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableGscError,
    ...deps.retry,
  };

  const query = deps.query ?? defaultQuery(shopId);

  const requestBody = {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: ["date"],
    type: "web",
    dataState: "final",
    rowLimit: 25000,
  };

  let resp: GscQueryResponse;
  try {
    resp = await breaker.execute(() => withRetry(() => query(requestBody), retry));
  } catch (err) {
    throw mapGoogleApiError(err);
  }

  const out = new Map<string, GscMetrics>();
  for (const row of resp.rows ?? []) {
    const date = (row.keys?.[0] ?? "").trim();
    // keys[0] is ALREADY YYYY-MM-DD — guard, do NOT reformat.
    if (!ISO_DATE.test(date)) continue;
    out.set(date, {
      clicks: num(row.clicks),
      impressions: num(row.impressions),
      ctr: num(row.ctr),
      position: num(row.position),
    });
  }
  return out;
}

function defaultQuery(shopId: string): GscQueryFn {
  return async (requestBody) => {
    const { client, siteUrl } = await getGscClient(shopId);
    // Pass siteUrl RAW — googleapis@173 percent-encodes the {siteUrl} path param
    // itself (RFC-6570 url-template); a manual encode would double-encode `:`/`/`.
    const res = await client.query({ siteUrl, requestBody });
    return (res.data ?? {}) as GscQueryResponse;
  };
}
