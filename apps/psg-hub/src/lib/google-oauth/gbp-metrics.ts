import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { GbpMetrics } from "@/lib/analytics/types";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { getGbpPerfClient } from "./gbp-client";

/**
 * GBP daily local-presence metrics (Phase 13 / 13-02b). ONE
 * locations.fetchMultiDailyMetricsTimeSeries call per location, requesting the EIGHT
 * DailyMetric enum counts. Returns Map<dateISO, GbpMetrics> — one full entry per day.
 *
 * This parser is FRESH, NOT a gsc-metrics clone — only the breaker/retry/seam SHELL
 * is shared. The Performance API response is metric-major + DOUBLY nested and shaped
 * unlike GSC/GA4 (verified against the installed googleapis@173 type defs):
 *
 *   multiDailyMetricTimeSeries[]            (one per requested metric)
 *     .dailyMetricTimeSeries[]             { dailyMetric, timeSeries }
 *       .timeSeries.datedValues[]          { date:{year,month,day}, value }
 *
 * Parse gotchas (RESEARCH §Presence insights, confirmed in v1.d.ts):
 *  - REQUEST is dotted query params, integers: `dailyRange.startDate.year` = 2026
 *    (NOT "2026"); `dailyMetrics` repeats the 8 enum strings. impressions_total is
 *    NEVER sent — it is not a DailyMetric enum value (sending it 400s).
 *  - `value` is an int64 serialized AS A STRING and is ABSENT when zero — Number(v ?? 0).
 *  - `date` is a google.type.Date {year,month,day}; ASSEMBLE to ISO (zero-pad), never
 *    string-reformat. (Request range = integers; output ISO = zero-padded — opposite
 *    transforms.)
 *  - An empty/absent timeSeries simply yields no rows — a VALID zero, NOT a breaker
 *    failure. The pivot runs OUTSIDE breaker.execute (only the fetch is wrapped).
 *  - A 404 maps to a non-upstream, non-retryable bad_request ("not accessible / not
 *    linked"), contained per-shop by the orchestrator (it does NOT flip the account).
 *  - impressions_total is DERIVED at ingest: a post-pass sets it to the sum of the four
 *    impression splits (the splits arrive as separate metric entries, so it cannot be
 *    summed inline).
 */

export type GbpWindow = { startDate: string; endDate: string }; // YYYY-MM-DD

/** The 8 requested DailyMetric enum values → their GbpMetrics keys. impressions_total
 *  is NOT here (derived at ingest, not an enum value). */
const METRIC_KEY_BY_ENUM: Record<string, keyof GbpMetrics> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressions_desktop_maps",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressions_desktop_search",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressions_mobile_maps",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressions_mobile_search",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_DIRECTION_REQUESTS: "direction_requests",
  CALL_CLICKS: "call_clicks",
  WEBSITE_CLICKS: "website_clicks",
};

/** Exactly the 8 enum strings to request (impressions_total excluded). */
export const GBP_DAILY_METRICS: string[] = Object.keys(METRIC_KEY_BY_ENUM);

/** The four impression splits summed into impressions_total at ingest. */
const IMPRESSION_SPLIT_KEYS: (keyof GbpMetrics)[] = [
  "impressions_desktop_maps",
  "impressions_desktop_search",
  "impressions_mobile_maps",
  "impressions_mobile_search",
];

/** The dotted-key request param shape (googleapis@173 flattens dailyRange this way). */
export type GbpFetchParams = {
  location: string; // bare 'locations/{id}'
  dailyMetrics: string[];
  "dailyRange.startDate.year": number;
  "dailyRange.startDate.month": number;
  "dailyRange.startDate.day": number;
  "dailyRange.endDate.year": number;
  "dailyRange.endDate.month": number;
  "dailyRange.endDate.day": number;
};

/** Minimal shape of the doubly-nested fetchMulti response (only fields we read). */
type GbpDatedValue = {
  date?: { year?: number | null; month?: number | null; day?: number | null } | null;
  value?: string | number | null;
};
type GbpDailyMetricTimeSeries = {
  dailyMetric?: string | null;
  timeSeries?: { datedValues?: GbpDatedValue[] | null } | null;
};
export type GbpPerfResponse = {
  multiDailyMetricTimeSeries?:
    | { dailyMetricTimeSeries?: GbpDailyMetricTimeSeries[] | null }[]
    | null;
};

/** Run one fetchMultiDailyMetricsTimeSeries and return the raw response body. The
 *  location is built into `params` BEFORE this seam (so tests assert the param shape
 *  without a live client); the default binds the linked-account client. */
export type GbpPerfFetchFn = (params: GbpFetchParams) => Promise<GbpPerfResponse>;

/** A resolved client = the network call + the location it is bound to. */
export type ResolvedGbpClient = {
  fetch: GbpPerfFetchFn;
  locationName: string;
};

export type FetchGbpDailyMetricsDeps = {
  /** Test seam — bypasses the googleapis client entirely (carries the location too). */
  client?: ResolvedGbpClient;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

export function isRetryableGbpError(err: unknown): boolean {
  const code =
    err instanceof GoogleApiError ? err.code : mapGoogleApiError(err).code;
  return code === "timeout" || code === "upstream" || code === "rate_limited";
}

const defaultGbpBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableGbpError,
});

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Split 'YYYY-MM-DD' into integer {year,month,day} for the request range. */
function splitDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  return { year: y, month: m, day: d };
}

/** Assemble a google.type.Date into a zero-padded ISO string, or null if incomplete. */
function isoFromDate(date: GbpDatedValue["date"]): string | null {
  if (!date) return null;
  const { year, month, day } = date;
  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof day !== "number"
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function zeroMetrics(): GbpMetrics {
  return {
    impressions_desktop_maps: 0,
    impressions_desktop_search: 0,
    impressions_mobile_maps: 0,
    impressions_mobile_search: 0,
    impressions_total: 0,
    website_clicks: 0,
    call_clicks: 0,
    direction_requests: 0,
    conversations: 0,
  };
}

function buildParams(location: string, window: GbpWindow): GbpFetchParams {
  const s = splitDate(window.startDate);
  const e = splitDate(window.endDate);
  return {
    location,
    dailyMetrics: GBP_DAILY_METRICS,
    "dailyRange.startDate.year": s.year,
    "dailyRange.startDate.month": s.month,
    "dailyRange.startDate.day": s.day,
    "dailyRange.endDate.year": e.year,
    "dailyRange.endDate.month": e.month,
    "dailyRange.endDate.day": e.day,
  };
}

export async function fetchGbpDailyMetrics(
  shopId: string,
  window: GbpWindow,
  deps: FetchGbpDailyMetricsDeps = {}
): Promise<Map<string, GbpMetrics>> {
  const breaker = deps.breaker ?? defaultGbpBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableGbpError,
    ...deps.retry,
  };

  let resp: GbpPerfResponse;
  try {
    const resolved = deps.client ?? (await defaultClient(shopId));
    const params = buildParams(resolved.locationName, window);
    resp = await breaker.execute(() =>
      withRetry(() => resolved.fetch(params), retry)
    );
  } catch (err) {
    throw mapGoogleApiError(err);
  }

  // PIVOT (outside the breaker — an empty/zero window is a valid result, not a failure).
  const out = new Map<string, GbpMetrics>();
  const ensure = (iso: string): GbpMetrics => {
    let m = out.get(iso);
    if (!m) {
      m = zeroMetrics();
      out.set(iso, m);
    }
    return m;
  };

  for (const multi of resp.multiDailyMetricTimeSeries ?? []) {
    for (const dm of multi?.dailyMetricTimeSeries ?? []) {
      const key = METRIC_KEY_BY_ENUM[dm?.dailyMetric ?? ""];
      if (!key) continue; // ignore any metric we did not request
      for (const dv of dm?.timeSeries?.datedValues ?? []) {
        const iso = isoFromDate(dv?.date);
        if (!iso) continue;
        ensure(iso)[key] = num(dv?.value); // value absent => 0
      }
    }
  }

  // Derive impressions_total per day = sum of the four impression splits (post-pass:
  // the splits arrive in separate metric entries, so this cannot be summed inline).
  for (const m of out.values()) {
    m.impressions_total = IMPRESSION_SPLIT_KEYS.reduce((sum, k) => sum + m[k], 0);
  }

  return out;
}

/** Default network seam: bind the linked-account client + call the API. */
async function defaultClient(shopId: string): Promise<ResolvedGbpClient> {
  const { client, locationName } = await getGbpPerfClient(shopId);
  return {
    locationName,
    fetch: async (params) => {
      const res = await client.fetchMultiDailyMetricsTimeSeries(params);
      return (res.data ?? {}) as GbpPerfResponse;
    },
  };
}
