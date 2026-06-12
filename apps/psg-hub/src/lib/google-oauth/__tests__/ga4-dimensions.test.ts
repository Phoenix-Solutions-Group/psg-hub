import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchGa4Dimensions,
  type Ga4RunReportFn,
} from "@/lib/google-oauth/ga4-dimensions";
import { GoogleApiError } from "@/lib/google-oauth/client";

function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

// Canned per-dimension response. `total` is the dimension's full-set sessions/users
// (GA4 metricAggregations TOTAL) and is deliberately LARGER than the sum of the
// returned rows so a real '(other)' remainder is exercised. Headers are REORDERED
// vs the request to prove header-indexing (non-positional).
function dimResponse(opts: {
  rows: Array<{ name: string; sessions: number; users: number; er: number }>;
  totalSessions: number;
  totalUsers: number;
  totalAvgDuration: number;
}) {
  // header order: engagementRate, sessions, averageSessionDuration, totalUsers, engagedSessions
  const order = [
    "engagementRate",
    "sessions",
    "averageSessionDuration",
    "totalUsers",
    "engagedSessions",
  ];
  const cell = (vals: Record<string, number>) => ({
    metricValues: order.map((k) => ({ value: String(vals[k] ?? 0) })),
  });
  return {
    metricHeaders: order.map((name) => ({ name })),
    rows: opts.rows.map((r) => ({
      dimensionValues: [{ value: r.name }],
      ...cell({
        sessions: r.sessions,
        totalUsers: r.users,
        engagementRate: r.er,
        averageSessionDuration: 0,
        engagedSessions: r.sessions,
      }),
    })),
    totals: [
      cell({
        sessions: opts.totalSessions,
        totalUsers: opts.totalUsers,
        engagementRate: 0,
        averageSessionDuration: opts.totalAvgDuration,
        engagedSessions: opts.totalSessions,
      }),
    ],
  };
}

const MONTH = { start: "2026-05-01", end: "2026-05-31" };

describe("fetchGa4Dimensions", () => {
  it("issues ONE runReport per dimension (four calls), each a monthly window with no date dimension + TOTAL aggregation", async () => {
    const captured: Record<string, unknown>[] = [];
    const runReport: Ga4RunReportFn = async (req) => {
      captured.push(req);
      return dimResponse({
        rows: [{ name: "Organic Search", sessions: 100, users: 80, er: 0.6 }],
        totalSessions: 100,
        totalUsers: 80,
        totalAvgDuration: 95,
      });
    };

    await fetchGa4Dimensions("shop-1", MONTH, { runReport, breaker: freshBreaker() });

    expect(captured).toHaveLength(4); // one per section dimension, never combined
    const dims = captured.map((r) => (r.dimensions as { name: string }[])[0].name);
    expect(dims).toEqual([
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "deviceCategory",
      "newVsReturning",
    ]);
    for (const req of captured) {
      expect(req.dateRanges).toEqual([{ startDate: "2026-05-01", endDate: "2026-05-31" }]);
      // single secondary dimension, NO `date` dimension (not a daily loop)
      expect((req.dimensions as { name: string }[])).toHaveLength(1);
      expect((req.dimensions as { name: string }[])[0].name).not.toBe("date");
      expect(req.metricAggregations).toEqual(["TOTAL"]);
      expect(req.returnPropertyQuota).toBe(true);
      const metricNames = (req.metrics as { name: string }[]).map((m) => m.name);
      expect(metricNames).toContain("averageSessionDuration");
    }
  });

  it("keeps top-N rows and appends a reconciling '(other)' = month total - sum(top-N); coerces string metricValues", async () => {
    const runReport: Ga4RunReportFn = async (req) => {
      const dim = (req.dimensions as { name: string }[])[0].name;
      if (dim === "landingPagePlusQueryString") {
        // returned rows sum to 150 sessions; TOTAL says 500 -> (other)=350.
        return dimResponse({
          rows: [
            { name: "/", sessions: 100, users: 70, er: 0.55 },
            { name: "/services", sessions: 50, users: 40, er: 0.42 },
          ],
          totalSessions: 500,
          totalUsers: 300,
          totalAvgDuration: 0,
        });
      }
      if (dim === "deviceCategory") {
        return dimResponse({
          rows: [
            { name: "mobile", sessions: 300, users: 220, er: 0.5 },
            { name: "desktop", sessions: 180, users: 150, er: 0.6 },
          ],
          totalSessions: 480, // equals the sum -> NO (other) row
          totalUsers: 370,
          totalAvgDuration: 132,
        });
      }
      return dimResponse({
        rows: [{ name: "x", sessions: 10, users: 8, er: 0.5 }],
        totalSessions: 10,
        totalUsers: 8,
        totalAvgDuration: 0,
      });
    };

    const out = await fetchGa4Dimensions("shop-1", MONTH, {
      runReport,
      breaker: freshBreaker(),
    });

    // Landing pages: two real rows + a non-zero (other) of 350 sessions.
    expect(out.topLandingPages).toHaveLength(3);
    const other = out.topLandingPages.find((r) => r.name === "(other)");
    expect(other).toBeDefined();
    expect(other!.sessions).toBe(350); // 500 - (100 + 50)
    expect(other!.users).toBe(190); // 300 - (70 + 40)
    expect(other!.engagement_rate).toBeUndefined(); // ratio not summed on (other)
    // string metricValues coerced to numbers
    expect(out.topLandingPages[0]).toMatchObject({ name: "/", sessions: 100, users: 70 });
    expect(out.topLandingPages[0].engagement_rate).toBeCloseTo(0.55);

    // Device: total equals the row sum -> no (other) appended.
    expect(out.devices.map((r) => r.name)).toEqual(["mobile", "desktop"]);

    // averageSessionDuration comes from the DEVICE report's weighted TOTAL.
    expect(out.averageSessionDuration).toBe(132);
  });

  it("maps a gax auth error to a typed GoogleApiError (auth_failed)", async () => {
    const runReport: Ga4RunReportFn = async () => {
      throw Object.assign(new Error("16 UNAUTHENTICATED"), { code: 16 });
    };
    await expect(
      fetchGa4Dimensions("shop-1", MONTH, {
        runReport,
        breaker: freshBreaker(),
        retry: { retries: 0 },
      })
    ).rejects.toBeInstanceOf(GoogleApiError);
  });

  it("retries a transient upstream error then succeeds (breaker/retry seam)", async () => {
    const ok = dimResponse({
      rows: [{ name: "Direct", sessions: 5, users: 5, er: 0.4 }],
      totalSessions: 5,
      totalUsers: 5,
      totalAvgDuration: 10,
    });
    const fn = vi
      .fn<Ga4RunReportFn>()
      .mockRejectedValueOnce(Object.assign(new Error("14 UNAVAILABLE"), { code: 14 }))
      .mockResolvedValue(ok);

    const out = await fetchGa4Dimensions("shop-1", MONTH, {
      runReport: fn,
      breaker: freshBreaker(),
      retry: { retries: 3, baseDelayMs: 1 },
    });
    // first dimension retried once (2 calls) then 3 more dimensions = 5 total
    expect(fn).toHaveBeenCalledTimes(5);
    expect(out.topChannels[0].sessions).toBe(5);
  });
});
