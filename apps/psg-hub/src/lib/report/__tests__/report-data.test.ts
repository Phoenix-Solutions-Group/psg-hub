import { describe, it, expect } from "vitest";
import { assembleReportData, type SnapshotReader } from "../report-data";
import type { AnalyticsSnapshot, AnalyticsSource } from "../../analytics/types";

const snap = (
  source: AnalyticsSource,
  date: string,
  metrics: Record<string, number>
): AnalyticsSnapshot => ({
  id: `${source}-${date}`,
  shop_id: "shop-1",
  location_id: null,
  source,
  date,
  period: "daily",
  metrics,
  synced_at: `${date}T06:00:00Z`,
  created_at: `${date}T06:00:00Z`,
});

/** Fake reader: returns the fixture rows for the requested source (or []). */
const reader = (
  map: Partial<Record<AnalyticsSource, AnalyticsSnapshot[]>>
): SnapshotReader => {
  return async ({ source }) => map[source] ?? [];
};

const GENERATED_AT = "2026-07-01T00:00:00Z";

/** All four sources, each with a current (June) and prior (May) month. */
function fullMap(): Partial<Record<AnalyticsSource, AnalyticsSnapshot[]>> {
  return {
    semrush: [
      snap("semrush", "2026-05-31", { organic_traffic: 1200, organic_keywords: 90, authority_score: 30 }),
      snap("semrush", "2026-06-30", { organic_traffic: 1500, organic_keywords: 100, authority_score: 32 }),
    ],
    google_ads: [
      snap("google_ads", "2026-05-10", { spend: 80, clicks: 10, impressions: 200, conversions: 2, cost_micros: 80_000_000 }),
      snap("google_ads", "2026-06-10", { spend: 100, clicks: 20, impressions: 500, conversions: 4, cost_micros: 100_000_000 }),
    ],
    ga4: [
      snap("ga4", "2026-05-15", { sessions: 10, engaged_sessions: 5, key_events: 1 }),
      snap("ga4", "2026-06-07", { sessions: 28, engaged_sessions: 14, key_events: 0 }),
      snap("ga4", "2026-06-08", { sessions: 23, engaged_sessions: 12, key_events: 0 }),
    ],
    gsc: [
      snap("gsc", "2026-05-20", { clicks: 2, impressions: 100, position: 12, ctr: 0.02 }),
      snap("gsc", "2026-06-03", { clicks: 4, impressions: 372, position: 13, ctr: 0.011 }),
    ],
  };
}

describe("assembleReportData", () => {
  it("assembles all four sources with current, prior, MoM, and trends", async () => {
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
    });

    expect(data.window).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(data.generatedAt).toBe(GENERATED_AT);
    expect([...data.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
    expect([...data.sourcesWithPriorMonth].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);

    // GA4: current sessions summed across June (28 + 23 = 51); prior = May 10.
    const ga4 = data.sources.ga4!;
    expect(ga4.current.sessions).toBe(51);
    expect(ga4.prior!.sessions).toBe(10);
    expect(ga4.momDelta.sessions).toBeCloseTo((51 - 10) / 10); // 4.1
    expect(ga4.trend.sessions).toHaveLength(2); // two June daily points

    // SEMrush organic_traffic is STOCK: June latest (06-30) = 1500, not a sum.
    expect(data.sources.semrush!.current.organic_traffic).toBe(1500);
  });

  it("omits a source with no current-month data (graceful degradation)", async () => {
    const map = fullMap();
    map.google_ads = []; // shop not linked to Ads
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(map),
      generatedAt: GENERATED_AT,
    });

    expect(data.sources.google_ads).toBeUndefined();
    expect(data.linkedSources).not.toContain("google_ads");
    expect(data.linkedSources).toHaveLength(3);
  });

  it("flags cold start when a source has a current but no prior month", async () => {
    const map = fullMap();
    // GA4 has only June rows, no May.
    map.ga4 = [
      snap("ga4", "2026-06-07", { sessions: 28, engaged_sessions: 14, key_events: 0 }),
      snap("ga4", "2026-06-08", { sessions: 23, engaged_sessions: 12, key_events: 0 }),
    ];
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(map),
      generatedAt: GENERATED_AT,
    });

    const ga4 = data.sources.ga4!;
    expect(ga4.current.sessions).toBe(51); // still has a current block
    expect(ga4.prior).toBeNull();
    expect(ga4.momDelta.sessions).toBeNull();
    expect(data.linkedSources).toContain("ga4"); // linked...
    expect(data.sourcesWithPriorMonth).not.toContain("ga4"); // ...but cold start
  });

  it("returns an empty report (no sources) when nothing is linked", async () => {
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader({}),
      generatedAt: GENERATED_AT,
    });
    expect(data.linkedSources).toEqual([]);
    expect(data.sourcesWithPriorMonth).toEqual([]);
    expect(Object.keys(data.sources)).toEqual([]);
  });
});
