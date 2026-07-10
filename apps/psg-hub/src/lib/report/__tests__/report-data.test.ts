import { describe, it, expect } from "vitest";
import {
  assembleReportData,
  type SnapshotReader,
  type MonthlyDimensionsReader,
  type MonthlyPerformanceReader,
  type MonthlyGbpPresenceReader,
} from "../report-data";
import type {
  AnalyticsSnapshot,
  AnalyticsSource,
  Ga4DimensionsMetrics,
  GbpPresenceMetrics,
  MonthlySnapshotRow,
  PerformanceMetrics,
} from "../../analytics/types";
import type { LocalFalconReport } from "../../local-falcon/types";

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

  it("leaves dimensions undefined when no monthly reader is wired (daily assembly unchanged)", async () => {
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
    });
    expect(data.dimensions).toBeUndefined();
  });

  it("leaves dimensions undefined when the reader returns null (no monthly row)", async () => {
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyDimensions: async () => null,
    });
    expect(data.dimensions).toBeUndefined();
  });

  it("populates dimensions off the monthly path and derives bounce_rate from the rolled-up ga4 engagement_rate", async () => {
    const metrics: Ga4DimensionsMetrics = {
      topChannels: [
        { name: "Organic Search", sessions: 40, users: 30 },
        { name: "(other)", sessions: 11, users: 9 },
      ],
      topLandingPages: [{ name: "/", sessions: 25, users: 18, engagement_rate: 0.5 }],
      devices: [{ name: "mobile", sessions: 51, users: 40 }],
      newVsReturning: [{ name: "new", sessions: 51, users: 40 }],
      averageSessionDuration: 135,
    };
    const monthlyRow: MonthlySnapshotRow = {
      id: "ga4dim-1",
      shop_id: "shop-1",
      location_id: null,
      source: "ga4_dimensions",
      date: "2026-06-01",
      period: "monthly",
      metrics,
      synced_at: "2026-07-01T04:00:00Z",
      created_at: "2026-07-01T04:00:00Z",
    };
    const readMonthlyDimensions: MonthlyDimensionsReader = async ({ shopId, month }) => {
      expect(shopId).toBe("shop-1");
      expect(month).toBe("2026-06");
      return monthlyRow;
    };

    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyDimensions,
    });

    expect(data.dimensions).toBeDefined();
    expect(data.dimensions!.topChannels).toHaveLength(2);
    expect(data.dimensions!.averageSessionDuration).toBe(135);
    // bounce_rate = 1 - monthly engagement_rate (recomputed in rollup from summed parts).
    const er = data.sources.ga4!.current.engagement_rate;
    expect(typeof er).toBe("number");
    expect(data.dimensions!.bounceRate).toBeCloseTo(1 - (er as number));
    // the daily four-source assembly is untouched.
    expect([...data.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
  });

  it("sets bounceRate null when ga4 is not linked", async () => {
    const map = fullMap();
    map.ga4 = []; // no ga4 daily data -> no ga4 block -> no engagement_rate
    const metrics: Ga4DimensionsMetrics = {
      topChannels: [{ name: "Direct", sessions: 5, users: 5 }],
      topLandingPages: [],
      devices: [],
      newVsReturning: [],
      averageSessionDuration: 0,
    };
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(map),
      generatedAt: GENERATED_AT,
      readMonthlyDimensions: async () =>
        ({
          id: "d",
          shop_id: "shop-1",
          location_id: null,
          source: "ga4_dimensions",
          date: "2026-06-01",
          period: "monthly",
          metrics,
          synced_at: GENERATED_AT,
          created_at: GENERATED_AT,
        }) as MonthlySnapshotRow,
    });
    expect(data.sources.ga4).toBeUndefined();
    expect(data.dimensions!.bounceRate).toBeNull();
  });

  it("leaves performance undefined with no reader / a null reader, and populates it from a monthly row", async () => {
    // no reader
    const a = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
    });
    expect(a.performance).toBeUndefined();

    // null reader
    const b = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyPerformance: async () => null,
    });
    expect(b.performance).toBeUndefined();

    // populated
    const metrics: PerformanceMetrics = {
      psi: {
        perf_score: 62,
        lab_lcp_ms: 3200,
        lab_cls: 0.05,
        lab_tbt_ms: 410,
        lab_fcp_ms: 1800,
        lab_speed_index_ms: 4100,
        lab_ttfb_ms: 620,
        field: null,
        origin_field: false,
      },
      gtmetrix: null,
      strategy: "mobile",
      tested_url: "https://wallacecollisionrepair.com",
    };
    const row: MonthlySnapshotRow = {
      id: "perf-1",
      shop_id: "shop-1",
      location_id: null,
      source: "performance",
      date: "2026-06-01",
      period: "monthly",
      metrics,
      synced_at: GENERATED_AT,
      created_at: GENERATED_AT,
    };
    const readMonthlyPerformance: MonthlyPerformanceReader = async ({ shopId, month }) => {
      expect(shopId).toBe("shop-1");
      expect(month).toBe("2026-06");
      return row;
    };
    const c = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyPerformance,
    });
    expect(c.performance).toBeDefined();
    expect(c.performance!.psi.perf_score).toBe(62);
    expect(c.performance!.gtmetrix).toBeNull();
    expect(c.performance!.testedUrl).toBe("https://wallacecollisionrepair.com");
    // daily assembly untouched
    expect([...c.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
  });

  it("assembles a gbp block (all FLOW) with current, prior, MoM, and trend", async () => {
    const map = fullMap();
    map.gbp = [
      snap("gbp", "2026-05-20", { call_clicks: 6, website_clicks: 10, direction_requests: 4, conversations: 2, impressions_total: 300, impressions_desktop_maps: 60, impressions_desktop_search: 40, impressions_mobile_maps: 120, impressions_mobile_search: 80 }),
      snap("gbp", "2026-06-05", { call_clicks: 5, website_clicks: 8, direction_requests: 3, conversations: 1, impressions_total: 250, impressions_desktop_maps: 50, impressions_desktop_search: 30, impressions_mobile_maps: 100, impressions_mobile_search: 70 }),
      snap("gbp", "2026-06-18", { call_clicks: 9, website_clicks: 12, direction_requests: 5, conversations: 2, impressions_total: 350, impressions_desktop_maps: 70, impressions_desktop_search: 50, impressions_mobile_maps: 130, impressions_mobile_search: 100 }),
    ];
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(map),
      generatedAt: GENERATED_AT,
    });
    const gbp = data.sources.gbp!;
    // FLOW sums across June (06-05 + 06-18): call_clicks 5+9=14, website_clicks 8+12=20.
    expect(gbp.current.call_clicks).toBe(14);
    expect(gbp.current.website_clicks).toBe(20);
    expect(gbp.current.impressions_total).toBe(600); // 250 + 350
    expect(gbp.prior!.call_clicks).toBe(6); // May 6
    expect(gbp.momDelta.call_clicks).toBeCloseTo((14 - 6) / 6);
    // trend keyed by TREND_KEYS.gbp = [call_clicks, website_clicks], two June daily points each.
    expect(Object.keys(gbp.trend).sort()).toEqual(["call_clicks", "website_clicks"]);
    expect(gbp.trend.call_clicks).toHaveLength(2);
    expect(data.linkedSources).toContain("gbp");
  });

  it("omits gbp when the shop has no gbp rows (existing four-source reports unchanged)", async () => {
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
    });
    expect(data.sources.gbp).toBeUndefined();
    expect(data.linkedSources).not.toContain("gbp");
    expect([...data.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
  });

  it("leaves gbpPresence undefined with no reader / a null reader, and populates it (rating mapped) from a monthly row", async () => {
    // no reader
    const a = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
    });
    expect(a.gbpPresence).toBeUndefined();

    // null reader
    const b = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyGbpPresence: async () => null,
    });
    expect(b.gbpPresence).toBeUndefined();

    // populated — STOCK presence + lifetime rating, snake_case -> camelCase
    const metrics: GbpPresenceMetrics = {
      open_status: "OPEN",
      primary_category: "Auto Body Shop",
      categories: ["Auto Body Shop", "Auto Repair Shop"],
      has_hours: true,
      website_uri: "https://wallacecollisionrepair.com",
      has_description: true,
      phone_present: true,
      completeness_score: 92,
      average_rating: 4.7,
      total_review_count: 138,
    };
    const row: MonthlySnapshotRow = {
      id: "gbppres-1",
      shop_id: "shop-1",
      location_id: null,
      source: "gbp_presence",
      date: "2026-06-01",
      period: "monthly",
      metrics,
      synced_at: GENERATED_AT,
      created_at: GENERATED_AT,
    };
    const readMonthlyGbpPresence: MonthlyGbpPresenceReader = async ({ shopId, month }) => {
      expect(shopId).toBe("shop-1");
      expect(month).toBe("2026-06");
      return row;
    };
    const c = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyGbpPresence,
    });
    expect(c.gbpPresence).toBeDefined();
    expect(c.gbpPresence!.openStatus).toBe("OPEN");
    expect(c.gbpPresence!.primaryCategory).toBe("Auto Body Shop");
    expect(c.gbpPresence!.averageRating).toBe(4.7);
    expect(c.gbpPresence!.totalReviewCount).toBe(138);
    expect(c.gbpPresence!.completenessScore).toBe(92);
    // daily assembly untouched
    expect([...c.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
  });

  it("maps the rating pair to null when absent (no reviews / unverified / v4 failed)", async () => {
    const metrics: GbpPresenceMetrics = {
      open_status: "OPEN",
      primary_category: null,
      categories: [],
      has_hours: false,
      website_uri: null,
      has_description: false,
      phone_present: false,
      average_rating: null,
      total_review_count: null,
    };
    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readMonthlyGbpPresence: async () =>
        ({
          id: "gp",
          shop_id: "shop-1",
          location_id: null,
          source: "gbp_presence",
          date: "2026-06-01",
          period: "monthly",
          metrics,
          synced_at: GENERATED_AT,
          created_at: GENERATED_AT,
        }) as MonthlySnapshotRow,
    });
    expect(data.gbpPresence!.averageRating).toBeNull();
    expect(data.gbpPresence!.totalReviewCount).toBeNull();
    expect(data.gbpPresence!.completenessScore).toBeUndefined();
  });

  it("adds latest Local Falcon visibility through a separate report reader", async () => {
    const localFalcon: LocalFalconReport = {
      capturedAt: "2026-07-10T00:00:00Z",
      sourceFileName: "wallace-local-falcon-july.csv",
      campaignName: "Wallace July",
      gridSize: "7x7",
      shareOfLocalVoice: 70,
      averageRank: 2.7,
      priorityNotes: ["Improve south grid"],
      keywordSummaries: [
        {
          keyword: "collision repair",
          locations: 2,
          averageRank: 3.5,
          topThreeLocations: 1,
          priorityNotes: ["Improve south grid"],
        },
      ],
    };

    const data = await assembleReportData("shop-1", "2026-06", {
      readSnapshots: reader(fullMap()),
      generatedAt: GENERATED_AT,
      readLocalFalconVisibility: async ({ shopId, month }) => {
        expect(shopId).toBe("shop-1");
        expect(month).toBe("2026-06");
        return localFalcon;
      },
    });

    expect(data.localFalcon).toEqual(localFalcon);
    expect([...data.linkedSources].sort()).toEqual(["ga4", "google_ads", "gsc", "semrush"]);
  });
});
