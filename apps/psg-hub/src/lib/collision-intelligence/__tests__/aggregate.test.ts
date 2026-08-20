import { describe, expect, it } from "vitest";
import {
  buildCollisionDashboard,
  evaluateCollisionBaseline,
  type CollisionForecastRow,
} from "../aggregate";

describe("collision intelligence aggregation", () => {
  it("keeps financial, cycle-time, and forecast denominators honest", () => {
    const baselineRows: CollisionForecastRow[] = Array.from(
      { length: 52 },
      (_, index) => ({
        week_start: `2025-${String(Math.floor(index / 4) + 1).padStart(2, "0")}-${String((index % 4) * 7 + 1).padStart(2, "0")}`,
        repair_orders: 10,
        repair_orders_lag_52_weeks: 20,
        trailing_4_week_average: 10,
      }),
    );

    const dashboard = buildCollisionDashboard(
      [
        {
          company_name: "Pilot Shop",
          week_start: "2025-01-06",
          repair_orders: 2,
          insured_repair_orders: 1,
          repair_value_cents: 100_00,
          average_cycle_days: 10,
          cycle_time_observations: 1,
        },
        {
          company_name: "Pilot Shop",
          week_start: "2025-01-13",
          repair_orders: 3,
          insured_repair_orders: 3,
          repair_value_cents: 400_00,
          average_cycle_days: 20,
          cycle_time_observations: 2,
        },
      ],
      [],
      baselineRows,
      [
        {
          month: "2025-01-01",
          customer_zip_count: 4,
          crash_active_zip_count: 3,
          total_crashes: 12,
          fatal_crashes: 0,
          injury_crashes: 2,
          property_damage_crashes: 10,
          rain_or_snow_crashes: 1,
          weighted_crash_exposure: 2.5,
          crash_refreshed_at: "2026-08-18T00:00:00Z",
        },
      ],
      [
        {
          zip_code: "67037",
          historical_repair_orders: 14,
          source_event_id: 123,
          event_type: "hail",
          event_at: "2026-08-18T01:30:00Z",
          magnitude: 1.25,
          magnitude_unit: "IN",
          alert_level: "high",
          threshold_basis: "Hail >= 1 inch",
          is_provisional: true,
        },
      ],
      [
        {
          forecast_origin_week: "2026-08-17",
          forecast_horizon_weeks: 1,
          forecast_week: "2026-08-17",
          predicted_repair_orders: null,
          lower_repair_orders: null,
          upper_repair_orders: null,
          prediction_interval_pct: 80,
          source_latest_arrival_date: "2025-12-24",
          source_age_days: 237,
          status: "stale_source",
          status_reason: "Latest repair arrival is 237 days old.",
          generated_at: "2026-08-18T19:40:00Z",
        },
        {
          forecast_origin_week: "2026-08-17",
          forecast_horizon_weeks: 2,
          forecast_week: "2026-08-24",
          predicted_repair_orders: null,
          lower_repair_orders: null,
          upper_repair_orders: null,
          prediction_interval_pct: 80,
          source_latest_arrival_date: "2025-12-24",
          source_age_days: 237,
          status: "stale_source",
          status_reason: "Latest repair arrival is 237 days old.",
          generated_at: "2026-08-18T19:40:00Z",
        },
      ],
      [
        {
          cycle: "20260818",
          row_count: 0,
          status: "loaded_provisional",
          imported_at: "2026-08-18T19:40:00Z",
        },
      ],
      [
        {
          insurance_company_name: "State Farm",
          insurance_company_normalized: "state farm",
          alias_review_status: "candidate",
          repair_orders: 42,
          repair_value_cents: 250_000_00,
        },
      ],
      [
        {
          customer_zip: "67037",
          customer_state: "KS",
          repair_orders: 24,
          insured_repair_orders: 20,
          repair_value_cents: 125_000_00,
        },
      ],
      [
        {
          vehicle_make: "Ford",
          vehicle_model: "F-150",
          repair_orders: 18,
          repair_value_cents: 100_000_00,
        },
      ],
      [
        {
          quality_issue: "missing_ro_number",
          affected_repairs: 3,
          repair_orders: 100,
          affected_percent: 3,
        },
      ],
      [
        {
          forecast_horizon_weeks: 1,
          model_key: "trailing4_v1",
          promotion_status: "approved",
          seasonal_baseline_mae: 3.63,
          model_mae: 2.65,
          mae_improvement_pct: 27,
          interval_multiplier: 1.55,
          interval_half_width: 9,
          interval_validation_coverage_pct: 92.3,
        },
        {
          forecast_horizon_weeks: 4,
          model_key: "seasonal_recent_blend_v1",
          promotion_status: "approved",
          seasonal_baseline_mae: 3.63,
          model_mae: 3.04,
          mae_improvement_pct: 16.5,
          interval_multiplier: 1.55,
          interval_half_width: 8,
          interval_validation_coverage_pct: 92.1,
        },
      ],
      [
        {
          forecast_horizon_weeks: 1,
          model_key: "trailing4_v1",
          observation_count: 0,
          monitoring_window_weeks: 13,
          monitoring_start_week: null,
          monitoring_end_week: null,
          live_mae: null,
          live_wape_pct: null,
          live_interval_coverage_pct: null,
          monitoring_status: "awaiting_actuals",
          monitoring_reason:
            "0 of 13 observed weeks are available; no drift decision is made.",
        },
      ],
      [
        {
          file_modified_at: "2026-08-15T00:00:00Z",
          imported_at: "2026-08-18T19:40:00Z",
          status: "loaded",
          source_age_hours: 91.7,
          is_stale: true,
          repair_orders: 5,
          latest_arrival_date: "2025-01-13",
        },
      ],
    );

    expect(dashboard.summary).toMatchObject({
      repairOrders: 5,
      insuredRepairOrders: 4,
      insuredSharePct: 80,
      repairValue: 500,
      averageRepairAmount: 100,
    });
    expect(dashboard.summary.averageCycleDays).toBeCloseTo(50 / 3);
    expect(dashboard.recentPerformance).toBeNull();
    expect(dashboard.crashSeries).toEqual([{ month: "2025-01", crashes: 12 }]);
    expect(dashboard.crashes).toMatchObject({
      coverageStatus: "covered",
      latestTotal: 12,
      latestRainOrSnow: 1,
      customerZipCount: 4,
      activeZipCount: 3,
    });
    expect(dashboard.alerts).toEqual([
      expect.objectContaining({
        zipCode: "67037",
        eventType: "hail",
        magnitude: 1.25,
        alertLevel: "high",
        isProvisional: true,
      }),
    ]);
    expect(dashboard.operationalForecast).toMatchObject({
      week: "2026-08-17",
      horizonWeeks: 1,
      predicted: null,
      status: "stale_source",
      sourceAgeDays: 237,
    });
    expect(
      dashboard.operationalForecasts.map((forecast) => forecast.horizonWeeks),
    ).toEqual([1, 2]);
    expect(dashboard.planningGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "Staffing & scheduling",
          status: "blocked",
          title: "Forecast decisions paused",
        }),
        expect.objectContaining({
          area: "Parts & training",
          title: "Ford F-150",
        }),
        expect.objectContaining({
          area: "Insurance mix",
          title: "State Farm",
        }),
        expect.objectContaining({
          area: "Weather response",
          title: "1 high preliminary signal",
        }),
      ]),
    );
    expect(dashboard.alertFeed).toMatchObject({
      cycle: "20260818",
      status: "loaded_provisional",
      refreshedAt: "2026-08-18T19:40:00Z",
    });
    expect(dashboard.repairFeed).toMatchObject({
      status: "loaded",
      sourceAgeHours: 91.7,
      isStale: true,
      repairOrders: 5,
    });
    expect(dashboard.topInsurers[0]).toEqual({
      name: "State Farm",
      aliasStatus: "candidate",
      repairOrders: 42,
      repairValue: 250000,
    });
    expect(dashboard.topCustomerZips[0]).toMatchObject({
      zipCode: "67037",
      insuredRepairOrders: 20,
    });
    expect(dashboard.topVehicles[0]).toMatchObject({
      label: "Ford F-150",
      repairOrders: 18,
    });
    expect(dashboard.dataQuality[0]).toMatchObject({
      issue: "missing_ro_number",
      affectedPercent: 3,
    });
    expect(dashboard.modelEvidence).toHaveLength(2);
    expect(dashboard.modelEvidence[0]).toMatchObject({
      horizonWeeks: 1,
      modelKey: "trailing4_v1",
      status: "approved",
      modelMae: 2.65,
      intervalHalfWidth: 9,
      validationCoveragePct: 92.3,
    });
    expect(dashboard.modelEvidence[1]).toMatchObject({
      horizonWeeks: 4,
      modelKey: "seasonal_recent_blend_v1",
      intervalHalfWidth: 8,
    });
    expect(dashboard.forecastMonitoring[0]).toMatchObject({
      horizonWeeks: 1,
      observations: 0,
      windowWeeks: 13,
      liveMae: null,
      status: "awaiting_actuals",
    });
    expect(evaluateCollisionBaseline(baselineRows)).toMatchObject({
      champion: "trailing4",
      beatsSeasonal: true,
    });
  });

  it("distinguishes unavailable local crash coverage from zero crashes", () => {
    const dashboard = buildCollisionDashboard(
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          last_sync_status: "loaded",
        },
      ],
    );

    expect(dashboard.crashSeries).toEqual([]);
    expect(dashboard.crashes).toMatchObject({
      coverageStatus: "outside_kansas_portfolio",
    });
  });

  it("compares complete 13-week operating periods and excludes the latest week", () => {
    const weeklyRows = Array.from({ length: 27 }, (_, index) => {
      const week = new Date("2025-01-06T00:00:00Z");
      week.setUTCDate(week.getUTCDate() + index * 7);
      const currentPeriod = index >= 13 && index < 26;

      return {
        company_name: "Pilot Shop",
        week_start: week.toISOString().slice(0, 10),
        repair_orders: index === 26 ? 999 : currentPeriod ? 12 : 10,
        insured_repair_orders: currentPeriod ? 10 : 8,
        repair_value_cents:
          index === 26 ? 999_000_00 : currentPeriod ? 150_000 : 100_000,
        average_cycle_days: index === 26 ? 99 : currentPeriod ? 8 : 10,
        cycle_time_observations: currentPeriod ? 12 : 10,
      };
    });

    const dashboard = buildCollisionDashboard(
      weeklyRows,
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    expect(dashboard.recentPerformance).toMatchObject({
      windowWeeks: 13,
      currentStart: "2025-04-07",
      currentEnd: "2025-07-06",
      priorStart: "2025-01-06",
      priorEnd: "2025-04-06",
      workload: { current: 156, prior: 130, changePct: 20 },
      insuredWorkload: { current: 130, prior: 104, changePct: 25 },
      repairValue: { current: 19_500, prior: 13_000, changePct: 50 },
      cycleTime: {
        current: 8,
        prior: 10,
        currentObservations: 156,
        priorObservations: 130,
        changePct: -20,
      },
    });
  });

  it("compares seasonality only across complete source years", () => {
    const seasonalityRows = [2019, 2020, 2021, 2022].flatMap((year) =>
      Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        return {
          arrival_year: year,
          arrival_month: month,
          repair_orders: month === 6 ? 20 : 10,
          insured_repair_orders: month === 6 ? 18 : 8,
          repair_value_cents:
            month === 10 ? 300_000 : month === 6 ? 200_000 : 100_000,
        };
      }),
    );

    const dashboard = buildCollisionDashboard(
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      seasonalityRows,
    );

    expect(dashboard.seasonality).toMatchObject({
      firstYear: 2020,
      latestYear: 2021,
      yearCount: 2,
    });
    expect(dashboard.seasonality?.revenueLeaders[0]).toMatchObject({
      month: "Oct",
      averageRepairOrders: 10,
      averageRepairValue: 3_000,
      insuredSharePct: 80,
    });
    expect(dashboard.seasonality?.series[5]).toMatchObject({
      month: "Jun",
      averageRepairOrders: 20,
      averageRepairValue: 2_000,
      insuredSharePct: 90,
    });
  });
});
