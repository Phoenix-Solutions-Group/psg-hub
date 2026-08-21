import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCollisionDashboard } from "@/lib/collision-intelligence/aggregate";

const getCollisionDashboard = vi.fn();
const getActiveShopContext = vi.fn();

vi.mock("@/lib/collision-intelligence/dashboard", () => ({
  getCollisionDashboard,
}));
vi.mock("@/lib/shop/context", () => ({ getActiveShopContext }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "shop-user" } } })),
    },
  })),
}));
vi.mock("@/components/analytics/charts", () => ({
  BarChartCard: ({ title }: { title: string }) => <div>{title}</div>,
  LineChartCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

const { default: CollisionIntelligencePage } = await import(
  "@/app/dashboard/collision-intelligence/page"
);

const dashboard = buildCollisionDashboard(
  [
    {
      company_name: "Scoped Collision",
      week_start: "2026-08-10",
      repair_orders: 5,
      insured_repair_orders: 4,
      unknown_payment_repair_orders: 1,
      repair_value_cents: 5_000_000,
      average_cycle_days: 7.5,
      cycle_time_observations: 4,
    },
  ],
  [
    {
      month: "2026-08-01",
      weather_coverage_pct: 100,
      weighted_hail_events: 1,
      weighted_wind_events: 0,
      weighted_tornado_events: 0,
      weighted_storm_demand_score: 1,
      weather_refreshed_at: "2026-08-20T12:00:00Z",
    },
  ],
  [],
  [],
  [
    {
      zip_code: "68512",
      historical_repair_orders: 3,
      source_event_id: 42,
      event_type: "hail",
      event_at: "2026-08-20T12:00:00Z",
      magnitude: 1.75,
      magnitude_unit: "IN",
      alert_level: "high",
      threshold_basis: "Hail at or above 1 inch",
      is_provisional: true,
    },
  ],
  [
    {
      forecast_origin_week: "2026-08-17",
      forecast_horizon_weeks: 1,
      forecast_week: "2026-08-24",
      model_key: "seasonal_recent_blend_v1",
      predicted_repair_orders: 999,
      lower_repair_orders: 998,
      upper_repair_orders: 1000,
      prediction_interval_pct: 80,
      source_latest_arrival_date: "2025-12-24",
      source_age_days: 239,
      status: "stale_source",
      status_reason: "Latest repair arrival is 239 days old.",
      generated_at: "2026-08-20T12:00:00Z",
    },
  ],
  [
    {
      cycle: "20260820",
      row_count: 1,
      status: "loaded_provisional",
      imported_at: "2026-08-20T12:00:00Z",
    },
  ],
  [
    {
      insurance_company_name: "State Farm",
      insurance_company_normalized: "state farm",
      alias_review_status: "approved",
      repair_orders: 4,
      repair_value_cents: 4_000_000,
    },
  ],
  [
    {
      customer_zip: "68512",
      customer_state: "NE",
      repair_orders: 5,
      insured_repair_orders: 4,
      repair_value_cents: 5_000_000,
    },
  ],
  [
    {
      vehicle_make: "Ford",
      vehicle_model: "F-150",
      repair_orders: 2,
      repair_value_cents: 2_000_000,
    },
  ],
  [],
  [],
  [],
  [
    {
      file_modified_at: "2026-08-20T06:00:00Z",
      imported_at: "2026-08-20T12:00:00Z",
      status: "loaded",
      source_age_hours: 6,
      is_stale: false,
      repair_orders: 5,
      latest_arrival_date: "2025-12-24",
    },
  ],
);

beforeEach(() => {
  getCollisionDashboard.mockReset().mockResolvedValue(dashboard);
  getActiveShopContext.mockReset().mockResolvedValue({
    shops: [
      { id: "shop-1", name: "Other Shop", role: "viewer" },
      { id: "shop-2", name: "Scoped Collision", role: "owner" },
    ],
    activeShopId: "shop-2",
  });
});

describe("participating-shop collision dashboard", () => {
  it("renders the active shop's observed metrics and suppresses paused forecast numbers", async () => {
    const html = renderToStaticMarkup(
      await CollisionIntelligencePage({ searchParams: Promise.resolve({}) }),
    );

    expect(getActiveShopContext).toHaveBeenCalledWith("shop-user");
    expect(getCollisionDashboard).toHaveBeenCalledWith("shop-2");
    expect(html).toContain("Scoped Collision");
    expect(html).toContain("Insurance-paid");
    expect(html).toContain("80.0%");
    expect(html).toContain("4 repair orders");
    expect(html).toContain("NOAA SPC preliminary reports");
    expect(html).toContain("Review before acting");
    expect(html).toContain("stale source");
    expect(html).toContain(
      "aggregate shop repair arrivals—not individual crashes or insurer claim volume",
    );
    expect(html).not.toContain("999.0 repairs");
    expect(html).toContain('href="/api/collision-intelligence/export"');
  });
});
