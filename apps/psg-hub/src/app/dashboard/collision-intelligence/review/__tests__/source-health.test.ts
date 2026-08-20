import { describe, expect, it } from "vitest";
import {
  buildForecastReadinessFallback,
  isForecastArrivalFresh,
  isMissingReviewView,
} from "../source-health";

describe("isMissingReviewView", () => {
  it("accepts only the named missing view", () => {
    const error = {
      code: "PGRST205",
      message:
        "Could not find the table 'public.v_collision_forecast_readiness' in the schema cache",
    };

    expect(isMissingReviewView(error, "v_collision_forecast_readiness")).toBe(
      true,
    );
    expect(
      isMissingReviewView(error, "v_collision_storm_source_reconciliation"),
    ).toBe(false);
    expect(
      isMissingReviewView(
        { ...error, code: "42501" },
        "v_collision_forecast_readiness",
      ),
    ).toBe(false);
  });
});

describe("isForecastArrivalFresh", () => {
  it("uses the 14-day forecast publication gate", () => {
    const today = new Date("2026-08-20T12:00:00Z");

    expect(isForecastArrivalFresh("2026-08-06", today)).toBe(true);
    expect(isForecastArrivalFresh("2026-08-05", today)).toBe(false);
    expect(isForecastArrivalFresh(null, today)).toBe(false);
  });
});

describe("buildForecastReadinessFallback", () => {
  it("reports the real gate for every mapped forecast horizon", () => {
    const policies = [
      {
        shop_id: "shop-1",
        model_key: "trailing4_v1",
        promotion_status: "approved",
      },
    ];
    const horizons = [2, 3, 4].map((forecast_horizon_weeks) => ({
      shop_id: "shop-1",
      forecast_horizon_weeks,
      model_key: "trailing4_v1",
      promotion_status: "approved",
    }));
    const forecasts = [1, 2, 3, 4].map((forecast_horizon_weeks) => ({
      shop_id: "shop-1",
      forecast_horizon_weeks,
      model_key: "trailing4_v1",
      forecast_origin_week: "2026-08-17",
      forecast_week: "2026-08-17",
      source_latest_arrival_date: "2025-12-24",
      source_age_days: 238,
      status: "stale_source",
      status_reason: "Latest repair arrival is 238 days old.",
      generated_at: "2026-08-19T16:50:07Z",
    }));

    const readiness = buildForecastReadinessFallback(
      ["shop-1"],
      policies,
      horizons,
      forecasts,
      new Date("2026-08-20T12:00:00Z"),
    );

    expect(readiness).toHaveLength(4);
    expect(readiness.every((row) => !row.is_ready)).toBe(true);
    expect(
      readiness.every((row) => row.readiness_status === "stale_source"),
    ).toBe(true);
    expect(readiness.map((row) => row.forecast_horizon_weeks)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
