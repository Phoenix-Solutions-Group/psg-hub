import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { GoogleAdsMetrics } from "@/lib/analytics/types";
import {
  getGoogleAdsClient,
  withAdsRateLimit,
  logAdsCall,
  mapGoogleAdsError,
} from "./client";
import { AdsApiError } from "./types";

/**
 * Account-level daily Google Ads metrics (Phase 10 / 10-02). ONE settled day,
 * ONE totals row, mapped to the GoogleAdsMetrics jsonb the analytics surface
 * reads. This is a NEW query, NOT a reuse of campaigns.ts `fetchCampaignMetrics`
 * (that is FROM campaign / per-campaign / LAST_30_DAYS — wrong entity, cardinality,
 * and window for a daily account snapshot).
 *
 * Contract anchored to google-ads-api@23 (RESEARCH.md / wf_a78f4fd7-d6b):
 *  - `FROM customer` yields exactly one row: GAQL has no GROUP BY and aggregates
 *    by the FROM resource_name; an account has exactly one `customer` resource.
 *  - `segments.date BETWEEN 'd' AND 'd'` filters the window WITHOUT splitting
 *    rows. NEVER `segments.date = 'd'` (undocumented for segments.date,
 *    adversarially REFUTED) and NEVER a segment in the SELECT (splits totals).
 *  - cost_micros/clicks/impressions are INT64 → already coerced to Number by the
 *    REST parser; conversions is a DOUBLE. `spend = cost_micros / 1_000_000`.
 *  - cpl is derived in code (`spend / conversions`), never read from
 *    metrics.cost_per_conversion (a non-summable average in micros-units).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape of one parsed google-ads-api row (snake_case, INT64→Number). */
type GoogleAdsRow = {
  metrics?: {
    cost_micros?: number;
    clicks?: number;
    impressions?: number;
    conversions?: number;
  };
};

/**
 * Transient codes worth retrying. auth_failed / bad_request are PERMANENT
 * (a revoked token or a malformed GAQL will never succeed on retry) and must
 * propagate immediately so the orchestrator can skip the shop.
 */
export function isRetryableAdsError(err: unknown): boolean {
  const code = err instanceof AdsApiError ? err.code : mapGoogleAdsError(err).code;
  return code === "timeout" || code === "upstream" || code === "rate_limited";
}

/**
 * One module-level breaker for the Google Ads upstream (mirror
 * semrush/client.ts defaultBreaker). Closes the PROJECT.md "retry + circuit
 * breaker on every external call" gap the inherited google-ads path had.
 */
const defaultAdsBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableAdsError,
});

export type FetchAccountDailyMetricsDeps = {
  /** Test seam — default real getGoogleAdsClient. */
  getClient?: typeof getGoogleAdsClient;
  /** Test seam — pass a fresh breaker so state never bleeds across tests. */
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

export async function fetchAccountDailyMetrics(
  shopId: string,
  dateStr: string,
  deps: FetchAccountDailyMetricsDeps = {}
): Promise<GoogleAdsMetrics> {
  // dateStr is code-derived (account-tz/UTC yesterday), never user input — but
  // it is interpolated into GAQL, so pin the format before building the query.
  if (!DATE_RE.test(dateStr)) {
    throw new AdsApiError("bad_request", `invalid date: ${dateStr}`);
  }

  const getClient = deps.getClient ?? getGoogleAdsClient;
  const breaker = deps.breaker ?? defaultAdsBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableAdsError,
    ...deps.retry,
  };

  const started = Date.now();
  const { customer, account } = await getClient(shopId);

  const gaql = `
    SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${dateStr}' AND '${dateStr}'
  `;

  try {
    // Rate-limit is the OUTER guard (one logical hourly call); the breaker +
    // retry wrap only the upstream query so internal transient retries do NOT
    // re-increment the hourly counter.
    const rows = (await withAdsRateLimit(shopId, "SEARCH", () =>
      breaker.execute(() =>
        withRetry(() => customer.query(gaql) as Promise<GoogleAdsRow[]>, retry)
      )
    )) as GoogleAdsRow[];

    // Zero-init aggregate: a zero-activity day returns ZERO rows (not a row of
    // zeros), so summing over 0/1/N rows is correct AND gives the empty-day path.
    let cost_micros = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    for (const r of rows) {
      cost_micros += Number(r.metrics?.cost_micros ?? 0);
      clicks += Number(r.metrics?.clicks ?? 0);
      impressions += Number(r.metrics?.impressions ?? 0);
      conversions += Number(r.metrics?.conversions ?? 0);
    }
    const spend = cost_micros / 1_000_000;
    const cpl = conversions > 0 ? spend / conversions : null;

    await logAdsCall({
      userId: null,
      shopId,
      accountId: account.id,
      endpoint: "customer.query.account-daily-metrics",
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result: "success",
    });

    return { spend, clicks, impressions, conversions, cpl, cost_micros };
  } catch (err) {
    const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
    await logAdsCall({
      userId: null,
      shopId,
      accountId: account.id,
      endpoint: "customer.query.account-daily-metrics",
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result:
        mapped.code === "rate_limited"
          ? "rate_limited"
          : mapped.code === "auth_failed"
            ? "auth_failed"
            : "error",
      errorCode: mapped.code,
    });
    // Per-shop status flip (markAccountAuthFailed) is the ORCHESTRATOR's job
    // (sync.ts, AC-2) — keep this fetch a pure typed-throw read.
    throw mapped;
  }
}
