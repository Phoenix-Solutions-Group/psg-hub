import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchGbpDailyMetrics,
  GBP_DAILY_METRICS,
  type GbpFetchParams,
  type GbpPerfResponse,
  type ResolvedGbpClient,
} from "@/lib/google-oauth/gbp-metrics";
import { GoogleApiError } from "@/lib/google-oauth/client";

// deps.client bypasses the googleapis client; we assert the request param shape and
// parse a canned doubly-nested fetchMulti response. A fresh breaker keeps state clean.
function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

/** Build a resolved-client seam over a canned response, capturing the params. */
function seam(
  resp: GbpPerfResponse | (() => Promise<GbpPerfResponse>),
  location = "locations/123"
): { client: ResolvedGbpClient; captured: () => GbpFetchParams | null } {
  let captured: GbpFetchParams | null = null;
  const client: ResolvedGbpClient = {
    locationName: location,
    fetch: async (params) => {
      captured = params;
      return typeof resp === "function" ? resp() : resp;
    },
  };
  return { client, captured: () => captured };
}

/** One metric's doubly-nested series block. */
function metricBlock(
  enumName: string,
  points: { date: { year: number; month: number; day: number }; value?: string | number | null }[]
) {
  return {
    dailyMetricTimeSeries: [
      { dailyMetric: enumName, timeSeries: { datedValues: points } },
    ],
  };
}

describe("fetchGbpDailyMetrics", () => {
  it("pivots the metric-major doubly-nested response into Map<date,GbpMetrics>, correctly keyed", async () => {
    const resp: GbpPerfResponse = {
      multiDailyMetricTimeSeries: [
        metricBlock("CALL_CLICKS", [
          { date: { year: 2026, month: 6, day: 7 }, value: "5" },
          { date: { year: 2026, month: 6, day: 8 }, value: "9" },
        ]),
        metricBlock("WEBSITE_CLICKS", [
          { date: { year: 2026, month: 6, day: 7 }, value: "3" },
          { date: { year: 2026, month: 6, day: 8 }, value: "4" },
        ]),
      ],
    };
    const { client } = seam(resp);
    const out = await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-08" },
      { client, breaker: freshBreaker() }
    );

    expect(out.size).toBe(2);
    expect(out.get("2026-06-07")).toMatchObject({ call_clicks: 5, website_clicks: 3 });
    expect(out.get("2026-06-08")).toMatchObject({ call_clicks: 9, website_clicks: 4 });
    // every entry is a FULL GbpMetrics (untouched keys default 0)
    expect(out.get("2026-06-07")?.direction_requests).toBe(0);
  });

  it("coerces the int64-as-string value via Number() and treats an absent value as 0", async () => {
    const resp: GbpPerfResponse = {
      multiDailyMetricTimeSeries: [
        metricBlock("CALL_CLICKS", [
          { date: { year: 2026, month: 6, day: 9 }, value: "120" },
          { date: { year: 2026, month: 6, day: 10 } }, // value absent => 0
        ]),
      ],
    };
    const { client } = seam(resp);
    const out = await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-06-09", endDate: "2026-06-10" },
      { client, breaker: freshBreaker() }
    );
    expect(out.get("2026-06-09")?.call_clicks).toBe(120);
    expect(out.get("2026-06-10")?.call_clicks).toBe(0);
  });

  it("assembles a google.type.Date {year,month,day} into a zero-padded ISO key", async () => {
    const resp: GbpPerfResponse = {
      multiDailyMetricTimeSeries: [
        metricBlock("CALL_CLICKS", [
          { date: { year: 2026, month: 1, day: 5 }, value: "1" },
        ]),
      ],
    };
    const { client } = seam(resp);
    const out = await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-01-05", endDate: "2026-01-05" },
      { client, breaker: freshBreaker() }
    );
    expect([...out.keys()]).toEqual(["2026-01-05"]); // not 2026-1-5
  });

  it("returns an empty Map for an empty/absent timeSeries (valid zero, not a failure)", async () => {
    const { client } = seam({ multiDailyMetricTimeSeries: [] });
    const out = await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-06-01", endDate: "2026-06-03" },
      { client, breaker: freshBreaker() }
    );
    expect(out.size).toBe(0);
  });

  it("derives impressions_total per day as the sum of the four impression splits", async () => {
    const resp: GbpPerfResponse = {
      multiDailyMetricTimeSeries: [
        metricBlock("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", [
          { date: { year: 2026, month: 6, day: 7 }, value: "10" },
        ]),
        metricBlock("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", [
          { date: { year: 2026, month: 6, day: 7 }, value: "20" },
        ]),
        metricBlock("BUSINESS_IMPRESSIONS_MOBILE_MAPS", [
          { date: { year: 2026, month: 6, day: 7 }, value: "30" },
        ]),
        metricBlock("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", [
          { date: { year: 2026, month: 6, day: 7 }, value: "40" },
        ]),
        metricBlock("CALL_CLICKS", [
          { date: { year: 2026, month: 6, day: 7 }, value: "7" },
        ]),
      ],
    };
    const { client } = seam(resp);
    const out = await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-06-07", endDate: "2026-06-07" },
      { client, breaker: freshBreaker() }
    );
    const day = out.get("2026-06-07")!;
    expect(day.impressions_total).toBe(100); // 10+20+30+40
    expect(day.call_clicks).toBe(7); // call clicks do NOT feed impressions_total
  });

  it("maps a 404 to a non-upstream bad_request (not accessible / not linked), never auth_failed", async () => {
    const notFound = Object.assign(new Error("Requested entity was not found."), {
      response: { status: 404 },
    });
    const { client } = seam(() => Promise.reject(notFound));
    await expect(
      fetchGbpDailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { client, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toBeInstanceOf(GoogleApiError);
    await expect(
      fetchGbpDailyMetrics(
        "shop-1",
        { startDate: "2026-06-07", endDate: "2026-06-08" },
        { client, breaker: freshBreaker(), retry: { retries: 0 } }
      )
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("builds the request with EXACTLY 8 dailyMetrics, an integer {year,month,day} range, and the bare location", async () => {
    const { client, captured } = seam({ multiDailyMetricTimeSeries: [] });
    await fetchGbpDailyMetrics(
      "shop-1",
      { startDate: "2026-06-03", endDate: "2026-06-09" },
      { client, breaker: freshBreaker() }
    );
    const p = captured()!;
    expect(p.location).toBe("locations/123");
    expect(p.dailyMetrics).toHaveLength(8);
    expect(p.dailyMetrics).toEqual(GBP_DAILY_METRICS);
    expect(p.dailyMetrics).not.toContain("BUSINESS_IMPRESSIONS"); // no impressions_total enum
    // dotted range keys are INTEGERS (not zero-padded strings)
    expect(p["dailyRange.startDate.year"]).toBe(2026);
    expect(p["dailyRange.startDate.month"]).toBe(6);
    expect(p["dailyRange.startDate.day"]).toBe(3);
    expect(p["dailyRange.endDate.month"]).toBe(6);
    expect(p["dailyRange.endDate.day"]).toBe(9);
  });
});
