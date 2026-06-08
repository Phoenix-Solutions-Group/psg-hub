import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, type RetryOptions } from "@/lib/resilience";
import { AdsApiError } from "../types";

// Mock the client module: withAdsRateLimit passes the inner fn through (no
// service client), logAdsCall noops, getGoogleAdsClient is unused (we inject
// getClient via deps), and mapGoogleAdsError wraps unknowns generically. The
// REAL structured GoogleAdsFailure classification is covered in map-error.test.ts
// against the unmocked impl.
vi.mock("../client", () => ({
  withAdsRateLimit: (_s: string, _m: string, fn: () => Promise<unknown>) => fn(),
  logAdsCall: vi.fn(async () => {}),
  getGoogleAdsClient: vi.fn(),
  mapGoogleAdsError: (e: unknown) =>
    e instanceof AdsApiError ? e : new AdsApiError("upstream", String(e)),
}));

import { fetchAccountDailyMetrics, isRetryableAdsError } from "../metrics";

/**
 * A google-ads-api@23 PARSED row: snake_case keys, INT64 (cost_micros/clicks/
 * impressions) already coerced to Number by parserRest, conversions a DOUBLE.
 * Fixtures mirror that exact shape — the only real-contract anchor available
 * before the 10-03 live run (RESEARCH "needs LIVE verification at 10-03").
 */
function makeClient(
  rows: unknown[],
  opts: { onQuery?: (gaql: string) => void } = {}
) {
  const query = vi.fn(async (gaql: string) => {
    opts.onQuery?.(gaql);
    return rows;
  });
  const getClient = vi.fn(async () => ({
    customer: { query } as never,
    account: { id: "acc-1" } as never,
  }));
  return { getClient, query };
}

// No-op resilience for deterministic tests; fresh breaker each call (no bleed).
const fastRetry: RetryOptions = { sleep: async () => {}, jitter: () => 0 };
function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 });
}

describe("fetchAccountDailyMetrics — GAQL contract", () => {
  it("queries FROM customer with segments.date BETWEEN (no `=`, no segment in SELECT)", async () => {
    let captured = "";
    const { getClient } = makeClient(
      [{ metrics: { cost_micros: 0, clicks: 0, impressions: 0, conversions: 0 } }],
      { onQuery: (g) => (captured = g) }
    );
    await fetchAccountDailyMetrics("shop-1", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    const norm = captured.replace(/\s+/g, " ").trim();
    expect(norm).toContain("FROM customer");
    expect(norm).toContain("WHERE segments.date BETWEEN '2026-06-07' AND '2026-06-07'");
    // Never the refuted single-day `=` form, never a segment in the SELECT.
    expect(norm).not.toMatch(/segments\.date\s*=/);
    const selectClause = norm.slice(norm.indexOf("SELECT"), norm.indexOf("FROM"));
    expect(selectClause).not.toContain("segments.");
  });
});

describe("fetchAccountDailyMetrics — metric mapping", () => {
  it("maps micros→spend and derives cpl = spend/conversions", async () => {
    const { getClient } = makeClient([
      { metrics: { cost_micros: 124_500_000, clicks: 312, impressions: 8044, conversions: 7 } },
    ]);
    const m = await fetchAccountDailyMetrics("s", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    expect(m.spend).toBeCloseTo(124.5, 6);
    expect(m.clicks).toBe(312);
    expect(m.impressions).toBe(8044);
    expect(m.conversions).toBe(7);
    expect(m.cpl).toBeCloseTo(124.5 / 7, 6);
    expect(m.cost_micros).toBe(124_500_000);
  });

  it("zero returned rows → all-zero metrics, cpl null (the empty-day path)", async () => {
    const { getClient } = makeClient([]);
    const m = await fetchAccountDailyMetrics("s", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    expect(m).toEqual({ spend: 0, clicks: 0, impressions: 0, conversions: 0, cpl: null, cost_micros: 0 });
  });

  it("spend>0 with zero conversions → cpl null (not Infinity)", async () => {
    const { getClient } = makeClient([
      { metrics: { cost_micros: 5_000_000, clicks: 10, impressions: 200, conversions: 0 } },
    ]);
    const m = await fetchAccountDailyMetrics("s", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    expect(m.spend).toBe(5);
    expect(m.cpl).toBeNull();
  });

  it("defensively sums over multiple returned rows", async () => {
    const { getClient } = makeClient([
      { metrics: { cost_micros: 1_000_000, clicks: 1, impressions: 10, conversions: 1 } },
      { metrics: { cost_micros: 2_000_000, clicks: 2, impressions: 20, conversions: 1 } },
    ]);
    const m = await fetchAccountDailyMetrics("s", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    expect(m.cost_micros).toBe(3_000_000);
    expect(m.spend).toBe(3);
    expect(m.clicks).toBe(3);
    expect(m.conversions).toBe(2);
    expect(m.cpl).toBeCloseTo(1.5, 6);
  });

  it("rejects a malformed date before issuing any query", async () => {
    const { getClient, query } = makeClient([]);
    await expect(
      fetchAccountDailyMetrics("s", "2026/06/07", { getClient, breaker: freshBreaker(), retry: fastRetry })
    ).rejects.toMatchObject({ code: "bad_request" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("fetchAccountDailyMetrics — resilience", () => {
  it("retries a transient (timeout) query error then succeeds", async () => {
    let calls = 0;
    const query = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new AdsApiError("timeout", "transient");
      return [{ metrics: { cost_micros: 1_000_000, clicks: 1, impressions: 1, conversions: 1 } }];
    });
    const getClient = vi.fn(async () => ({ customer: { query } as never, account: { id: "a" } as never }));
    const m = await fetchAccountDailyMetrics("s", "2026-06-07", {
      getClient,
      breaker: freshBreaker(),
      retry: fastRetry,
    });
    expect(calls).toBe(3);
    expect(m.spend).toBe(1);
  });

  it("does NOT retry a permanent auth_failed error", async () => {
    const query = vi.fn(async () => {
      throw new AdsApiError("auth_failed", "revoked");
    });
    const getClient = vi.fn(async () => ({ customer: { query } as never, account: { id: "a" } as never }));
    await expect(
      fetchAccountDailyMetrics("s", "2026-06-07", { getClient, breaker: freshBreaker(), retry: fastRetry })
    ).rejects.toMatchObject({ code: "auth_failed" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableAdsError", () => {
  it("retries transient codes, not permanent ones", () => {
    expect(isRetryableAdsError(new AdsApiError("timeout"))).toBe(true);
    expect(isRetryableAdsError(new AdsApiError("upstream"))).toBe(true);
    expect(isRetryableAdsError(new AdsApiError("rate_limited"))).toBe(true);
    expect(isRetryableAdsError(new AdsApiError("auth_failed"))).toBe(false);
    expect(isRetryableAdsError(new AdsApiError("bad_request"))).toBe(false);
  });
});
