import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchGa4DailyMetrics,
  type Ga4RunReportFn,
} from "@/lib/google-oauth/ga4-metrics";
import { GoogleApiError } from "@/lib/google-oauth/client";

// deps.runReport bypasses the gax client; we assert the request shape and parse a
// canned response. A fresh breaker per call keeps circuit state from bleeding.
function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

describe("fetchGa4DailyMetrics", () => {
  it("maps rows to Map<date,Ga4Metrics>: YYYYMMDD->ISO, strings->Number, keyEvents->key_events, header-indexed (non-positional)", async () => {
    let captured: Record<string, unknown> | null = null;
    // Headers deliberately REORDERED vs request order to prove header-indexing.
    const runReport: Ga4RunReportFn = async (req) => {
      captured = req;
      return {
        metricHeaders: [
          { name: "keyEvents" },
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
        ],
        rows: [
          {
            dimensionValues: [{ value: "20260607" }],
            metricValues: [
              { value: "4" }, // keyEvents
              { value: "2541" }, // sessions
              { value: "1980" }, // totalUsers
              { value: "1875" }, // activeUsers
              { value: "640" }, // newUsers
              { value: "1600" }, // engagedSessions
              { value: "0.6342" }, // engagementRate
            ],
          },
          {
            dimensionValues: [{ value: "20260608" }],
            metricValues: [
              { value: "0" },
              { value: "10" },
              { value: "9" },
              { value: "9" },
              { value: "3" },
              { value: "5" },
              { value: "0.5" },
            ],
          },
        ],
      };
    };

    const out = await fetchGa4DailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-08" },
      { runReport, breaker: freshBreaker() }
    );

    expect(out.get("2026-06-07")).toEqual({
      sessions: 2541,
      total_users: 1980,
      active_users: 1875,
      new_users: 640,
      engaged_sessions: 1600,
      key_events: 4,
      engagement_rate: 0.6342,
    });
    expect(out.get("2026-06-08")?.key_events).toBe(0);
    expect(out.size).toBe(2);

    // Request shape: date dimension, keyEvents (NOT conversions), quota requested.
    const req = captured! as Record<string, unknown>;
    expect(req.dimensions).toEqual([{ name: "date" }]);
    const metricNames = (req.metrics as { name: string }[]).map((m) => m.name);
    expect(metricNames).toContain("keyEvents");
    expect(metricNames).not.toContain("conversions");
    expect(req.returnPropertyQuota).toBe(true);
  });

  it("returns an empty Map for a zero-row window (the empty-day path)", async () => {
    const runReport: Ga4RunReportFn = async () => ({
      metricHeaders: [{ name: "sessions" }],
      rows: [],
    });
    const out = await fetchGa4DailyMetrics(
      "shop-1",
      { startDate: "2026-06-01", endDate: "2026-06-03" },
      { runReport, breaker: freshBreaker() }
    );
    expect(out.size).toBe(0);
  });

  it("skips a malformed (non-YYYYMMDD) date row rather than poisoning the key", async () => {
    const runReport: Ga4RunReportFn = async () => ({
      metricHeaders: [{ name: "sessions" }],
      rows: [
        { dimensionValues: [{ value: "2026-06-07" }], metricValues: [{ value: "5" }] },
        { dimensionValues: [{ value: "20260608" }], metricValues: [{ value: "9" }] },
      ],
    });
    const out = await fetchGa4DailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-08" },
      { runReport, breaker: freshBreaker() }
    );
    expect([...out.keys()]).toEqual(["2026-06-08"]);
  });

  it("maps a gax ServiceError to a typed GoogleApiError (auth_failed)", async () => {
    const gaxErr = Object.assign(new Error("16 UNAUTHENTICATED"), { code: 16 });
    const runReport: Ga4RunReportFn = async () => {
      throw gaxErr;
    };
    await expect(
      fetchGa4DailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { runReport, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toBeInstanceOf(GoogleApiError);
    await expect(
      fetchGa4DailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { runReport, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("retries a transient upstream error then succeeds", async () => {
    const fn = vi
      .fn<Ga4RunReportFn>()
      .mockRejectedValueOnce(
        Object.assign(new Error("14 UNAVAILABLE"), { code: 14 })
      )
      .mockResolvedValueOnce({
        metricHeaders: [{ name: "sessions" }],
        rows: [
          { dimensionValues: [{ value: "20260608" }], metricValues: [{ value: "7" }] },
        ],
      });
    const out = await fetchGa4DailyMetrics(
      "shop-1",
      { startDate: "2026-06-08", endDate: "2026-06-08" },
      { runReport: fn, breaker: freshBreaker(), retry: { retries: 3, baseDelayMs: 1 } }
    );
    expect(out.get("2026-06-08")?.sessions).toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
