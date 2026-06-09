import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchGscDailyMetrics,
  type GscQueryFn,
} from "@/lib/google-oauth/gsc-metrics";
import { GoogleApiError } from "@/lib/google-oauth/client";

// deps.query bypasses the googleapis client; we assert the request body shape and
// parse a canned GSC response. A fresh breaker per call keeps circuit state clean.
function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

describe("fetchGscDailyMetrics", () => {
  it("maps rows to Map<date,GscMetrics> from keys[0] (ALREADY ISO — no reformat), numeric fields", async () => {
    let captured: Record<string, unknown> | null = null;
    const query: GscQueryFn = async (requestBody) => {
      captured = requestBody;
      return {
        rows: [
          { keys: ["2026-06-07"], clicks: 258, impressions: 4100, ctr: 0.0629, position: 7.4 },
          { keys: ["2026-06-08"], clicks: 0, impressions: 12, ctr: 0, position: 41.2 },
        ],
      };
    };

    const out = await fetchGscDailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-08" },
      { query, breaker: freshBreaker() }
    );

    expect(out.get("2026-06-07")).toEqual({
      clicks: 258,
      impressions: 4100,
      ctr: 0.0629,
      position: 7.4,
    });
    expect(out.get("2026-06-08")?.clicks).toBe(0);
    expect(out.size).toBe(2);

    // Request body: date dimension, web search-type, FINAL data state, no reformat.
    const body = captured! as Record<string, unknown>;
    expect(body.dimensions).toEqual(["date"]);
    expect(body.type).toBe("web");
    expect(body.dataState).toBe("final");
    expect(body.startDate).toBe("2026-06-07");
    expect(body.endDate).toBe("2026-06-08");
  });

  it("coerces string-y numeric values defensively (Number())", async () => {
    const query: GscQueryFn = async () => ({
      rows: [
        {
          keys: ["2026-06-09"],
          clicks: "120" as unknown as number,
          impressions: "3000" as unknown as number,
          ctr: "0.04" as unknown as number,
          position: "9.1" as unknown as number,
        },
      ],
    });
    const out = await fetchGscDailyMetrics(
      "shop-1",
      { startDate: "2026-06-09", endDate: "2026-06-09" },
      { query, breaker: freshBreaker() }
    );
    expect(out.get("2026-06-09")).toEqual({
      clicks: 120,
      impressions: 3000,
      ctr: 0.04,
      position: 9.1,
    });
  });

  it("returns an empty Map for a zero-row window (recent lagging days — the empty path)", async () => {
    const query: GscQueryFn = async () => ({ rows: [] });
    const out = await fetchGscDailyMetrics(
      "shop-1",
      { startDate: "2026-06-01", endDate: "2026-06-03" },
      { query, breaker: freshBreaker() }
    );
    expect(out.size).toBe(0);
  });

  it("skips a malformed (non-ISO) date row rather than poisoning the key", async () => {
    const query: GscQueryFn = async () => ({
      rows: [
        { keys: ["20260607"], clicks: 5 },
        { keys: ["2026-06-08"], clicks: 9 },
      ],
    });
    const out = await fetchGscDailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-08" },
      { query, breaker: freshBreaker() }
    );
    expect([...out.keys()]).toEqual(["2026-06-08"]);
  });

  it("maps a Gaxios 403 to a typed GoogleApiError (auth_failed)", async () => {
    const gaxiosErr = Object.assign(new Error("Forbidden"), {
      response: { status: 403 },
    });
    const query: GscQueryFn = async () => {
      throw gaxiosErr;
    };
    await expect(
      fetchGscDailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { query, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toBeInstanceOf(GoogleApiError);
    await expect(
      fetchGscDailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { query, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("retries a transient upstream (5xx) error then succeeds", async () => {
    const fn = vi
      .fn<GscQueryFn>()
      .mockRejectedValueOnce(
        Object.assign(new Error("Service Unavailable"), {
          response: { status: 503 },
        })
      )
      .mockResolvedValueOnce({
        rows: [{ keys: ["2026-06-08"], clicks: 7, impressions: 100, ctr: 0.07, position: 5 }],
      });
    const out = await fetchGscDailyMetrics(
      "shop-1",
      { startDate: "2026-06-08", endDate: "2026-06-08" },
      { query: fn, breaker: freshBreaker(), retry: { retries: 3, baseDelayMs: 1 } }
    );
    expect(out.get("2026-06-08")?.clicks).toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
