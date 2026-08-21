import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveShopContext = vi.fn();
const getCollisionDashboard = vi.fn();
let user: { id: string } | null = null;

vi.mock("@/lib/shop/context", () => ({ getActiveShopContext }));
vi.mock("@/lib/collision-intelligence/dashboard", () => ({
  getCollisionDashboard,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  })),
}));

const { GET } = await import("@/app/api/collision-intelligence/export/route");

const dashboard = {
  companyName: '=HYPERLINK("https://example.test")',
  summary: {
    repairOrders: 100,
    insuredRepairOrders: 80,
    unknownPaymentRepairOrders: 5,
    insuredSharePct: 80,
    repairValue: 500_000,
    averageRepairAmount: 5_000,
    averageCycleDays: 7.5,
    firstWeek: "2026-01-05",
    latestWeek: "2026-08-10",
  },
  repairFeed: {
    fileModifiedAt: "2026-08-20T10:00:00Z",
    sourceAgeHours: 6,
    isStale: false,
    latestArrivalDate: "2026-08-19",
  },
  weather: {
    latestMonth: "2026-08-01",
    latestCoveragePct: 99.4,
  },
  crashes: {
    latestMonth: "2026-07-01",
    latestTotal: 45,
    coverageStatus: "covered",
    nationalState: null,
  },
  operationalForecasts: [
    {
      horizonWeeks: 1,
      week: "2026-08-24",
      modelKey: "seasonal_recent_blend_v1",
      predicted: 24,
      lower: 17,
      upper: 31,
      intervalPct: 80,
      sourceLatestArrivalDate: "2026-08-19",
      sourceAgeDays: 1,
      status: "published",
      reason: "Current governed source and approved model.",
    },
  ],
  modelEvidence: [
    {
      horizonWeeks: 1,
      modelKey: "seasonal_recent_blend_v1",
      maeImprovementPct: 20.1,
      validationCoveragePct: 82.4,
      status: "approved",
    },
  ],
  alerts: [
    {
      eventType: "hail",
      zipCode: "68512",
      eventAt: "2026-08-20T12:00:00Z",
      historicalRepairOrders: 42,
      alertLevel: "high",
      isProvisional: true,
      magnitude: 1.75,
      magnitudeUnit: "IN",
      thresholdBasis: "Hail at or above 1 inch",
    },
  ],
  alertReviewAvailable: true,
  weatherReviewCases: [
    {
      eventType: "hail",
      zipCode: "68512",
      eventDate: "2026-08-20",
      status: "closed",
      outcome: "observed_follow_through",
      control: {
        matchStatus: "matched",
        eventDate: "2025-08-20",
        yearsBack: 1,
        weeklyRepairOrders: [0, 1, 0, 0],
        prior52WeekRepairOrders: 26,
        observedFourWeekRepairOrders: 1,
        followThroughThresholdRepairOrders: 3,
        derivedOutcome: "no_observed_follow_through",
      },
      evidence: {
        sourceLatestArrivalDate: "2026-09-17",
        weeklyRepairOrders: [1, 1, 1, 0],
        prior52WeekRepairOrders: 26,
        observedFourWeekRepairOrders: 3,
        followThroughThresholdRepairOrders: 3,
        matureForClose: true,
      },
    },
  ],
  weatherAlertMonitoring: [
    {
      cohort: "all",
      matchedCaseCount: 1,
      signalFollowThroughRatePct: 100,
      controlFollowThroughRatePct: 0,
      liftPctPoints: 100,
    },
  ],
};

beforeEach(() => {
  user = null;
  getActiveShopContext.mockReset();
  getCollisionDashboard.mockReset().mockResolvedValue(dashboard);
});

describe("GET collision intelligence export", () => {
  it("requires an authenticated active-shop membership", async () => {
    expect((await GET()).status).toBe(401);

    user = { id: "user-1" };
    getActiveShopContext.mockResolvedValue({ activeShopId: null });
    expect((await GET()).status).toBe(403);
    expect(getCollisionDashboard).not.toHaveBeenCalled();
  });

  it("exports only the active shop with freshness, confidence, and limitations", async () => {
    user = { id: "user-1" };
    getActiveShopContext.mockResolvedValue({ activeShopId: "shop-2" });

    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /collision-intelligence-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(getActiveShopContext).toHaveBeenCalledWith("user-1");
    expect(getCollisionDashboard).toHaveBeenCalledWith("shop-2");
    expect(csv).toContain("'=" + 'HYPERLINK(""https://example.test"")');
    expect(csv).toContain("Held-out MAE improvement 20.1%");
    expect(csv).toContain("source arrivals through 2026-08-19 (1 day old)");
    expect(csv).toContain("not storm damage or claims");
    expect(csv).toContain("hail · ZIP 68512 · matched control");
    expect(csv).toContain("Pre-registered 1 year earlier");
    expect(csv).toContain("signal follow-through 100.0%");
    expect(csv).toContain("descriptive_only");
    expect(csv).toContain("cannot enable notifications or operational changes");
    expect(csv).toContain(
      "The model does not predict individual crashes or insurer claim volume.",
    );
  });

  it("reports missing prospective lifecycle evidence instead of zero", async () => {
    user = { id: "user-1" };
    getActiveShopContext.mockResolvedValue({ activeShopId: "shop-2" });
    getCollisionDashboard.mockResolvedValue({
      ...dashboard,
      alertReviewAvailable: false,
      weatherReviewCases: [],
      weatherAlertMonitoring: [],
    });

    const csv = await (await GET()).text();

    expect(csv).toContain("release_pending");
    expect(csv).toContain("weather lifecycle migration is not applied");
  });
});
