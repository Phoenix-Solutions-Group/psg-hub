export type Numeric = number | string | null;

export type CollisionWeeklyRow = {
  company_name: string;
  week_start: string;
  repair_orders: Numeric;
  insured_repair_orders: Numeric;
  unknown_payment_repair_orders?: Numeric;
  repair_value_cents: Numeric;
  average_cycle_days: Numeric;
  cycle_time_observations: Numeric;
};

export type CollisionWeatherRow = {
  month: string;
  weather_coverage_pct: Numeric;
  weighted_hail_events: Numeric;
  weighted_wind_events: Numeric;
  weighted_tornado_events: Numeric;
  weighted_storm_demand_score: Numeric;
  weather_refreshed_at: string | null;
};

export type CollisionForecastRow = {
  week_start: string;
  repair_orders: Numeric;
  repair_orders_lag_52_weeks: Numeric;
  trailing_4_week_average: Numeric;
};

export type CollisionCrashRow = {
  month: string;
  customer_zip_count: Numeric;
  crash_active_zip_count: Numeric;
  total_crashes: Numeric;
  fatal_crashes: Numeric;
  injury_crashes: Numeric;
  property_damage_crashes: Numeric;
  rain_or_snow_crashes: Numeric;
  weighted_crash_exposure: Numeric;
  crash_refreshed_at: string | null;
};

export type CollisionCrashSourceRow = {
  last_sync_status: "running" | "loaded" | "failed";
};

export type CollisionNationalCrashRow = {
  month: Numeric;
};

export type CollisionNationalCrashSourceRow = {
  state_name: string;
  source_year: Numeric;
  imported_at: string | null;
};

export type CollisionAlertRow = {
  zip_code: string;
  historical_repair_orders: Numeric;
  source_event_id: number | string;
  event_type: string;
  event_at: string;
  magnitude: Numeric;
  magnitude_unit: string | null;
  alert_level: "high" | "review";
  threshold_basis: string;
  is_provisional: boolean;
};

export type CollisionForecastStatusRow = {
  forecast_origin_week: string;
  forecast_horizon_weeks: Numeric;
  forecast_week: string;
  model_key: string;
  predicted_repair_orders: Numeric;
  lower_repair_orders: Numeric;
  upper_repair_orders: Numeric;
  prediction_interval_pct: Numeric;
  source_latest_arrival_date: string | null;
  source_age_days: Numeric;
  status: "published" | "stale_source" | "insufficient_history";
  status_reason: string;
  generated_at: string;
};

export type CollisionSpcSourceRow = {
  cycle: string;
  row_count: Numeric;
  status: string;
  imported_at: string;
};

export type CollisionRepairFeedRow = {
  file_modified_at: string;
  imported_at: string;
  status: string;
  source_age_hours: Numeric;
  is_stale: boolean;
  repair_orders: Numeric;
  latest_arrival_date: string | null;
};

export type CollisionInsurerRow = {
  insurance_company_name: string | null;
  insurance_company_normalized: string;
  alias_review_status: "candidate" | "approved" | "rejected";
  repair_orders: Numeric;
  repair_value_cents: Numeric;
};

export type CollisionZipRow = {
  customer_zip: string;
  customer_state: string | null;
  repair_orders: Numeric;
  insured_repair_orders: Numeric;
  repair_value_cents: Numeric;
};

export type CollisionVehicleRow = {
  vehicle_make: string | null;
  vehicle_model: string | null;
  repair_orders: Numeric;
  repair_value_cents: Numeric;
};

export type CollisionSeasonalityRow = {
  arrival_year: Numeric;
  arrival_month: Numeric;
  repair_orders: Numeric;
  insured_repair_orders: Numeric;
  repair_value_cents: Numeric;
};

export type CollisionQualityRow = {
  quality_issue: string;
  affected_repairs: Numeric;
  repair_orders: Numeric;
  affected_percent: Numeric;
};

export type CollisionModelRegistryRow = {
  forecast_horizon_weeks: Numeric;
  model_key: string;
  promotion_status: "review" | "approved" | "retired";
  seasonal_baseline_mae: Numeric;
  model_mae: Numeric;
  mae_improvement_pct: Numeric;
  interval_multiplier: Numeric;
  interval_half_width: Numeric;
  interval_validation_coverage_pct: Numeric;
};

export type CollisionForecastMonitoringRow = {
  forecast_horizon_weeks: Numeric;
  model_key: string;
  observation_count: Numeric;
  monitoring_window_weeks: Numeric;
  monitoring_start_week: string | null;
  monitoring_end_week: string | null;
  live_mae: Numeric;
  live_wape_pct: Numeric;
  live_interval_coverage_pct: Numeric;
  monitoring_status:
    | "awaiting_actuals"
    | "review_accuracy"
    | "review_interval"
    | "within_policy";
  monitoring_reason: string;
};

function numberOf(value: Numeric): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeWeatherAlerts(alertRows: CollisionAlertRow[]) {
  const grouped = new Map<
    string,
    CollisionAlertRow & { reportCount: number }
  >();

  for (const row of alertRows) {
    // ponytail: UTC-day grouping is enough for review-only signals; add storm-cell IDs before notifications.
    const key = `${row.zip_code}:${row.event_type}:${row.event_at.slice(0, 10)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row, reportCount: 1 });
      continue;
    }

    existing.reportCount += 1;
    existing.historical_repair_orders = Math.max(
      numberOf(existing.historical_repair_orders),
      numberOf(row.historical_repair_orders),
    );
    existing.is_provisional ||= row.is_provisional;

    if (row.event_at > existing.event_at) {
      existing.event_at = row.event_at;
      existing.source_event_id = row.source_event_id;
    }
    if (numberOf(row.magnitude) > numberOf(existing.magnitude)) {
      existing.magnitude = row.magnitude;
      existing.magnitude_unit = row.magnitude_unit;
    }
    if (row.alert_level === "high" && existing.alert_level !== "high") {
      existing.alert_level = "high";
      existing.threshold_basis = row.threshold_basis;
    }
  }

  return [...grouped.values()].sort(
    (a, b) =>
      Number(b.alert_level === "high") - Number(a.alert_level === "high") ||
      numberOf(b.historical_repair_orders) -
        numberOf(a.historical_repair_orders) ||
      b.event_at.localeCompare(a.event_at),
  );
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percentChange(current: number | null, prior: number | null) {
  return current === null || prior === null || prior === 0
    ? null
    : (100 * (current - prior)) / prior;
}

function summarizePeriod(
  rows: CollisionWeeklyRow[],
  start: string,
  endExclusive: string,
) {
  const period = rows.filter(
    (row) => row.week_start >= start && row.week_start < endExclusive,
  );
  const repairOrders = period.reduce(
    (sum, row) => sum + numberOf(row.repair_orders),
    0,
  );
  const insuredRepairOrders = period.reduce(
    (sum, row) => sum + numberOf(row.insured_repair_orders),
    0,
  );
  const repairValue =
    period.reduce((sum, row) => sum + numberOf(row.repair_value_cents), 0) /
    100;
  const cycleObservations = period.reduce(
    (sum, row) => sum + numberOf(row.cycle_time_observations),
    0,
  );
  const cycleDays = period.reduce(
    (sum, row) =>
      sum +
      numberOf(row.average_cycle_days) * numberOf(row.cycle_time_observations),
    0,
  );

  return {
    repairOrders,
    insuredRepairOrders,
    repairValue,
    cycleObservations,
    averageCycleDays: cycleObservations ? cycleDays / cycleObservations : null,
  };
}

function recentPerformance(rows: CollisionWeeklyRow[]) {
  const latestWeek = rows.at(-1)?.week_start;
  if (!latestWeek) return null;

  const currentStart = shiftDate(latestWeek, -13 * 7);
  const priorStart = shiftDate(latestWeek, -26 * 7);
  if (rows[0].week_start > priorStart) return null;

  const current = summarizePeriod(rows, currentStart, latestWeek);
  const prior = summarizePeriod(rows, priorStart, currentStart);

  return {
    windowWeeks: 13,
    currentStart,
    currentEnd: shiftDate(latestWeek, -1),
    priorStart,
    priorEnd: shiftDate(currentStart, -1),
    workload: {
      current: current.repairOrders,
      prior: prior.repairOrders,
      changePct: percentChange(current.repairOrders, prior.repairOrders),
    },
    insuredWorkload: {
      current: current.insuredRepairOrders,
      prior: prior.insuredRepairOrders,
      changePct: percentChange(
        current.insuredRepairOrders,
        prior.insuredRepairOrders,
      ),
    },
    repairValue: {
      current: current.repairValue,
      prior: prior.repairValue,
      changePct: percentChange(current.repairValue, prior.repairValue),
    },
    cycleTime: {
      current: current.averageCycleDays,
      prior: prior.averageCycleDays,
      currentObservations: current.cycleObservations,
      priorObservations: prior.cycleObservations,
      changePct: percentChange(
        current.averageCycleDays,
        prior.averageCycleDays,
      ),
    },
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function seasonality(rows: CollisionSeasonalityRow[]) {
  const years = [
    ...new Set(rows.map((row) => numberOf(row.arrival_year))),
  ].sort((a, b) => a - b);
  const completeYears = years
    .slice(1, -1)
    .filter(
      (year) =>
        new Set(
          rows
            .filter((row) => numberOf(row.arrival_year) === year)
            .map((row) => numberOf(row.arrival_month)),
        ).size === 12,
    )
    .slice(-5);
  if (!completeYears.length) return null;

  const includedYears = new Set(completeYears);
  const series = MONTHS.map((month, index) => {
    const monthRows = rows.filter(
      (row) =>
        includedYears.has(numberOf(row.arrival_year)) &&
        numberOf(row.arrival_month) === index + 1,
    );
    const repairOrders = monthRows.reduce(
      (sum, row) => sum + numberOf(row.repair_orders),
      0,
    );
    const insuredRepairOrders = monthRows.reduce(
      (sum, row) => sum + numberOf(row.insured_repair_orders),
      0,
    );

    return {
      month,
      averageRepairOrders: repairOrders / completeYears.length,
      averageRepairValue:
        monthRows.reduce(
          (sum, row) => sum + numberOf(row.repair_value_cents),
          0,
        ) /
        completeYears.length /
        100,
      insuredSharePct: repairOrders
        ? (100 * insuredRepairOrders) / repairOrders
        : 0,
    };
  });

  return {
    firstYear: completeYears[0],
    latestYear: completeYears.at(-1)!,
    yearCount: completeYears.length,
    series,
    revenueLeaders: [...series]
      .sort((a, b) => b.averageRepairValue - a.averageRepairValue)
      .slice(0, 5),
  };
}

function modelError(actual: number[], predicted: number[]) {
  const absoluteErrors = actual.map((value, index) =>
    Math.abs(value - predicted[index]),
  );
  const squaredErrors = actual.map(
    (value, index) => (value - predicted[index]) ** 2,
  );
  const total = actual.reduce((sum, value) => sum + value, 0);
  return {
    mae: absoluteErrors.reduce((sum, value) => sum + value, 0) / actual.length,
    rmse: Math.sqrt(
      squaredErrors.reduce((sum, value) => sum + value, 0) / actual.length,
    ),
    wapePct:
      (100 * absoluteErrors.reduce((sum, value) => sum + value, 0)) /
      Math.max(total, 1),
  };
}

export function evaluateCollisionBaseline(rows: CollisionForecastRow[]) {
  const eligible = rows
    .filter(
      (row) =>
        row.repair_orders_lag_52_weeks !== null &&
        row.trailing_4_week_average !== null,
    )
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
  // Require the same 52-week calibration + 52-week holdout frame used by the
  // governed evaluator. The first seasonal lag already consumes 52 weeks.
  if (eligible.length < 104) return null;

  const holdout = eligible.slice(-52);
  const actual = holdout.map((row) => numberOf(row.repair_orders));
  const seasonal = holdout.map((row) =>
    numberOf(row.repair_orders_lag_52_weeks),
  );
  const recent = holdout.map((row) => numberOf(row.trailing_4_week_average));
  const blend = seasonal.map((value, index) => (value + recent[index]) / 2);
  const models = {
    seasonal52: modelError(actual, seasonal),
    trailing4: modelError(actual, recent),
    blend: modelError(actual, blend),
  };
  const champion = (Object.keys(models) as Array<keyof typeof models>).reduce<
    keyof typeof models
  >(
    (best, candidate) =>
      models[candidate].mae < models[best].mae ? candidate : best,
    "seasonal52",
  );

  return {
    holdoutStart: holdout[0].week_start,
    holdoutEnd: holdout.at(-1)!.week_start,
    holdoutRepairs: actual.reduce((sum, value) => sum + value, 0),
    models,
    champion,
    beatsSeasonal:
      champion !== "seasonal52" && models[champion].mae < models.seasonal52.mae,
    maeImprovementPct:
      models.seasonal52.mae === 0
        ? 0
        : (100 * (models.seasonal52.mae - models[champion].mae)) /
          models.seasonal52.mae,
  };
}

export function buildCollisionDashboard(
  weeklyRows: CollisionWeeklyRow[],
  weatherRows: CollisionWeatherRow[],
  forecastRows: CollisionForecastRow[],
  crashRows: CollisionCrashRow[],
  alertRows: CollisionAlertRow[],
  forecastStatusRows: CollisionForecastStatusRow[],
  spcSourceRows: CollisionSpcSourceRow[],
  insurerRows: CollisionInsurerRow[],
  zipRows: CollisionZipRow[],
  vehicleRows: CollisionVehicleRow[],
  qualityRows: CollisionQualityRow[],
  modelRegistryRows: CollisionModelRegistryRow[],
  forecastMonitoringRows: CollisionForecastMonitoringRow[],
  repairFeedRows: CollisionRepairFeedRow[],
  seasonalityRows: CollisionSeasonalityRow[] = [],
  crashSourceRows: CollisionCrashSourceRow[] = [],
  nationalCrashRows: CollisionNationalCrashRow[] = [],
  nationalCrashSourceRows: CollisionNationalCrashSourceRow[] = [],
) {
  const weekly = [...weeklyRows].sort((a, b) =>
    a.week_start.localeCompare(b.week_start),
  );
  const repairOrders = weekly.reduce(
    (sum, row) => sum + numberOf(row.repair_orders),
    0,
  );
  const insuredRepairOrders = weekly.reduce(
    (sum, row) => sum + numberOf(row.insured_repair_orders),
    0,
  );
  const unknownPaymentRepairOrders = weekly.reduce(
    (sum, row) => sum + numberOf(row.unknown_payment_repair_orders ?? 0),
    0,
  );
  const repairValueCents = weekly.reduce(
    (sum, row) => sum + numberOf(row.repair_value_cents),
    0,
  );
  const cycleObservations = weekly.reduce(
    (sum, row) => sum + numberOf(row.cycle_time_observations),
    0,
  );
  const weightedCycleDays = weekly.reduce(
    (sum, row) =>
      sum +
      numberOf(row.average_cycle_days) * numberOf(row.cycle_time_observations),
    0,
  );
  const weather = [...weatherRows].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const crashes = [...crashRows].sort((a, b) => a.month.localeCompare(b.month));
  const latestCrash = crashes.at(-1);
  const latestForecastOrigin = forecastStatusRows.reduce(
    (latest, row) =>
      row.forecast_origin_week > latest ? row.forecast_origin_week : latest,
    "",
  );
  const operationalForecasts = forecastStatusRows
    .filter((row) => row.forecast_origin_week === latestForecastOrigin)
    .sort(
      (a, b) =>
        numberOf(a.forecast_horizon_weeks) - numberOf(b.forecast_horizon_weeks),
    )
    .map((forecast) => ({
      originWeek: forecast.forecast_origin_week,
      horizonWeeks: numberOf(forecast.forecast_horizon_weeks),
      week: forecast.forecast_week,
      modelKey: forecast.model_key,
      predicted:
        forecast.predicted_repair_orders === null
          ? null
          : numberOf(forecast.predicted_repair_orders),
      lower:
        forecast.lower_repair_orders === null
          ? null
          : numberOf(forecast.lower_repair_orders),
      upper:
        forecast.upper_repair_orders === null
          ? null
          : numberOf(forecast.upper_repair_orders),
      intervalPct: numberOf(forecast.prediction_interval_pct),
      sourceLatestArrivalDate: forecast.source_latest_arrival_date,
      sourceAgeDays: numberOf(forecast.source_age_days),
      status: forecast.status,
      reason: forecast.status_reason,
      generatedAt: forecast.generated_at,
    }));
  const publishedForecasts = operationalForecasts.filter(
    (forecast) =>
      forecast.status === "published" && forecast.predicted !== null,
  );
  const performance = recentPerformance(weekly);
  const recentWeeklyPace = performance
    ? performance.workload.current / performance.windowWeeks
    : null;
  const peakForecast = publishedForecasts.reduce<
    (typeof publishedForecasts)[number] | null
  >(
    (peak, forecast) =>
      !peak || (forecast.upper ?? 0) > (peak.upper ?? 0) ? forecast : peak,
    null,
  );
  const lowForecast = publishedForecasts.reduce<
    (typeof publishedForecasts)[number] | null
  >(
    (lowest, forecast) =>
      !lowest || (forecast.predicted ?? 0) < (lowest.predicted ?? 0)
        ? forecast
        : lowest,
    null,
  );
  const weatherAlerts = summarizeWeatherAlerts(alertRows);
  const highWeatherAlerts = weatherAlerts.filter(
    (alert) => alert.alert_level === "high",
  );
  const highWeatherSignals = highWeatherAlerts.length;
  const highestWeatherExposure = [...highWeatherAlerts].sort(
    (a, b) =>
      numberOf(b.historical_repair_orders) -
      numberOf(a.historical_repair_orders),
  )[0];
  const capacitySignal =
    recentWeeklyPace === null
      ? null
      : publishedForecasts.find(
          (forecast) =>
            forecast.lower !== null && forecast.lower > recentWeeklyPace,
        );
  const marketingSignal =
    recentWeeklyPace === null
      ? null
      : publishedForecasts.find(
          (forecast) =>
            forecast.upper !== null && forecast.upper < recentWeeklyPace,
        );
  const topVehicle = vehicleRows[0];
  const topInsurer = insurerRows[0];
  const latestSpcSource = spcSourceRows[0];
  const repairFeed = repairFeedRows[0];
  const crashSource = crashSourceRows[0];
  const nationalCrashSource = nationalCrashSourceRows[0];
  const nationalCrashMonthly = nationalCrashRows.reduce<Map<number, number>>(
    (monthly, row) => {
      const month = numberOf(row.month);
      if (month >= 1 && month <= 12)
        monthly.set(month, (monthly.get(month) ?? 0) + 1);
      return monthly;
    },
    new Map(),
  );
  const nationalCrashSeries = [...nationalCrashMonthly]
    .sort(([a], [b]) => a - b)
    .map(([month, total]) => ({
      month: `${numberOf(nationalCrashSource?.source_year)}-${String(month).padStart(2, "0")}`,
      crashes: total,
    }));
  const latestNationalCrash = nationalCrashSeries.at(-1);

  return {
    companyName: weekly[0]?.company_name ?? null,
    summary: {
      repairOrders,
      insuredRepairOrders,
      unknownPaymentRepairOrders,
      insuredSharePct: repairOrders
        ? (100 * insuredRepairOrders) / repairOrders
        : 0,
      repairValue: repairValueCents / 100,
      averageRepairAmount: repairOrders
        ? repairValueCents / 100 / repairOrders
        : 0,
      averageCycleDays: cycleObservations
        ? weightedCycleDays / cycleObservations
        : null,
      firstWeek: weekly[0]?.week_start ?? null,
      latestWeek: weekly.at(-1)?.week_start ?? null,
    },
    recentPerformance: performance,
    seasonality: seasonality(seasonalityRows),
    weeklySeries: [...forecastRows]
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-52)
      .map((row) => ({
        week: row.week_start.slice(5),
        orders: numberOf(row.repair_orders),
      })),
    weatherSeries: weather.slice(-12).map((row) => ({
      month: row.month.slice(0, 7),
      score: numberOf(row.weighted_storm_demand_score),
    })),
    crashSeries: latestCrash
      ? crashes.slice(-12).map((row) => ({
          month: row.month.slice(0, 7),
          crashes: numberOf(row.total_crashes),
        }))
      : nationalCrashSeries,
    crashes: {
      coverageStatus: latestCrash
        ? ("covered" as const)
        : latestNationalCrash
          ? ("national_fatal_context" as const)
          : crashSource?.last_sync_status === "loaded"
            ? ("outside_kansas_portfolio" as const)
            : ("source_unavailable" as const),
      latestMonth: latestCrash?.month ?? latestNationalCrash?.month ?? null,
      latestTotal: latestCrash
        ? numberOf(latestCrash.total_crashes)
        : (latestNationalCrash?.crashes ?? 0),
      latestRainOrSnow: numberOf(latestCrash?.rain_or_snow_crashes ?? 0),
      customerZipCount: numberOf(latestCrash?.customer_zip_count ?? 0),
      activeZipCount: numberOf(latestCrash?.crash_active_zip_count ?? 0),
      refreshedAt:
        latestCrash?.crash_refreshed_at ??
        nationalCrashSource?.imported_at ??
        null,
      nationalState: nationalCrashSource?.state_name ?? null,
      nationalYear: nationalCrashSource
        ? numberOf(nationalCrashSource.source_year)
        : null,
    },
    weather: {
      latestMonth: weather.at(-1)?.month ?? null,
      latestCoveragePct: numberOf(weather.at(-1)?.weather_coverage_pct ?? 0),
      refreshedAt: weather.at(-1)?.weather_refreshed_at ?? null,
    },
    alerts: weatherAlerts.slice(0, 6).map((row) => ({
      zipCode: row.zip_code,
      historicalRepairOrders: numberOf(row.historical_repair_orders),
      sourceEventId: String(row.source_event_id),
      eventType: row.event_type,
      eventAt: row.event_at,
      magnitude: row.magnitude === null ? null : numberOf(row.magnitude),
      magnitudeUnit: row.magnitude_unit,
      alertLevel: row.alert_level,
      thresholdBasis: row.threshold_basis,
      isProvisional: row.is_provisional,
      reportCount: row.reportCount,
    })),
    operationalForecasts,
    operationalForecast: operationalForecasts[0] ?? null,
    planningGuidance: [
      capacitySignal && recentWeeklyPace !== null
        ? {
            area: "Staffing & scheduling",
            status: "review" as const,
            title: `Capacity pressure in week ${capacitySignal.horizonWeeks}`,
            week: capacitySignal.week,
            detail: `The entire ${capacitySignal.intervalPct}% range (${capacitySignal.lower}–${capacitySignal.upper}) is above the latest complete 13-week average of ${recentWeeklyPace.toFixed(1)} repairs per week. Check booked slots and technician capacity now; change shifts or intake only if the schedule confirms the gap.`,
          }
        : peakForecast
          ? {
              area: "Staffing & scheduling",
              status: "ready" as const,
              title:
                recentWeeklyPace === null
                  ? `Capacity check for week ${peakForecast.horizonWeeks}`
                  : "No capacity pressure confirmed",
              week: peakForecast.week,
              detail:
                recentWeeklyPace === null
                  ? `The ${peakForecast.intervalPct}% upper range reaches ${peakForecast.upper} repairs. Compare that with booked slots and technician capacity before changing shifts or intake.`
                  : `The highest ${peakForecast.intervalPct}% range (${peakForecast.lower}–${peakForecast.upper}) does not sit fully above the latest complete 13-week average of ${recentWeeklyPace.toFixed(1)} repairs per week. Keep the current staffing plan and monitor booked slots.`,
            }
          : {
              area: "Staffing & scheduling",
              status: "blocked" as const,
              title: "Forecast decisions paused",
              week: null,
              detail:
                operationalForecasts[0]?.reason ??
                "No governed operating forecast is available.",
            },
      marketingSignal && recentWeeklyPace !== null
        ? {
            area: "Marketing",
            status: "review" as const,
            title: `Demand gap in week ${marketingSignal.horizonWeeks}`,
            week: marketingSignal.week,
            detail: `The entire ${marketingSignal.intervalPct}% range (${marketingSignal.lower}–${marketingSignal.upper}) is below the latest complete 13-week average of ${recentWeeklyPace.toFixed(1)} repairs per week. Confirm booked work; if the gap remains, review campaign timing and spend.`,
          }
        : lowForecast
          ? {
              area: "Marketing",
              status: "ready" as const,
              title:
                recentWeeklyPace === null
                  ? `Demand checkpoint for week ${lowForecast.horizonWeeks}`
                  : "No demand gap confirmed",
              week: lowForecast.week,
              detail:
                recentWeeklyPace === null
                  ? `The point forecast is ${lowForecast.predicted?.toFixed(1)} repairs (${lowForecast.lower}–${lowForecast.upper}). Confirm booked work before changing campaign timing or spend.`
                  : `The lowest ${lowForecast.intervalPct}% range (${lowForecast.lower}–${lowForecast.upper}) does not sit fully below the latest complete 13-week average of ${recentWeeklyPace.toFixed(1)} repairs per week. Hold campaign changes until booked work confirms a shortfall.`,
            }
          : {
              area: "Marketing",
              status: "blocked" as const,
              title: "Forecast trigger unavailable",
              week: null,
              detail:
                "Use observed repair history only; do not change campaign timing from a stale or unpublished forecast.",
            },
      topVehicle
        ? {
            area: "Parts & training",
            status: "review" as const,
            title:
              [topVehicle.vehicle_make, topVehicle.vehicle_model]
                .filter(Boolean)
                .join(" ") || "Vehicle mix review",
            week: null,
            detail: `${numberOf(topVehicle.repair_orders).toLocaleString()} historical repairs. Use this mix for certification and parts planning, then confirm the scheduled estimate mix before ordering.`,
          }
        : null,
      topInsurer
        ? {
            area: "Insurance mix",
            status: "review" as const,
            title:
              topInsurer.insurance_company_name ??
              topInsurer.insurance_company_normalized,
            week: null,
            detail: `${numberOf(topInsurer.repair_orders).toLocaleString()} historical carrier-labeled repairs. Use this for DRP and service planning, not as insurer claim volume.`,
          }
        : null,
      {
        area: "Weather response",
        status: highWeatherSignals ? ("review" as const) : ("ready" as const),
        title: highestWeatherExposure
          ? `Review ZIP ${highestWeatherExposure.zip_code} first`
          : "No high preliminary signals",
        week: null,
        detail: highestWeatherExposure
          ? `${numberOf(highestWeatherExposure.historical_repair_orders).toLocaleString()} historical repair orders came from this ZIP; ${highWeatherSignals} high preliminary weather signal${highWeatherSignals === 1 ? " is" : "s are"} active across the customer market. Prepare intake coverage, but do not treat a weather report as vehicle damage or a claim.`
          : "Continue monitoring the 72-hour customer-ZIP queue; notifications remain disabled.",
      },
    ].filter((guidance) => guidance !== null),
    alertFeed: latestSpcSource
      ? {
          cycle: latestSpcSource.cycle,
          rowCount: numberOf(latestSpcSource.row_count),
          status: latestSpcSource.status,
          refreshedAt: latestSpcSource.imported_at,
        }
      : null,
    repairFeed: repairFeed
      ? {
          fileModifiedAt: repairFeed.file_modified_at,
          importedAt: repairFeed.imported_at,
          status: repairFeed.status,
          sourceAgeHours: numberOf(repairFeed.source_age_hours),
          isStale: repairFeed.is_stale,
          repairOrders: numberOf(repairFeed.repair_orders),
          latestArrivalDate: repairFeed.latest_arrival_date,
        }
      : null,
    topInsurers: insurerRows.slice(0, 5).map((row) => ({
      name: row.insurance_company_name ?? row.insurance_company_normalized,
      aliasStatus: row.alias_review_status,
      repairOrders: numberOf(row.repair_orders),
      repairValue: numberOf(row.repair_value_cents) / 100,
    })),
    topCustomerZips: zipRows.slice(0, 5).map((row) => ({
      zipCode: row.customer_zip,
      state: row.customer_state,
      repairOrders: numberOf(row.repair_orders),
      insuredRepairOrders: numberOf(row.insured_repair_orders),
      repairValue: numberOf(row.repair_value_cents) / 100,
    })),
    topVehicles: vehicleRows.slice(0, 5).map((row) => ({
      label:
        [row.vehicle_make, row.vehicle_model].filter(Boolean).join(" ") ||
        "Unknown vehicle",
      repairOrders: numberOf(row.repair_orders),
      repairValue: numberOf(row.repair_value_cents) / 100,
    })),
    dataQuality: qualityRows.slice(0, 5).map((row) => ({
      issue: row.quality_issue,
      affectedRepairs: numberOf(row.affected_repairs),
      totalRepairs: numberOf(row.repair_orders),
      affectedPercent: numberOf(row.affected_percent),
    })),
    modelEvidence: [...modelRegistryRows]
      .sort(
        (a, b) =>
          numberOf(a.forecast_horizon_weeks) -
          numberOf(b.forecast_horizon_weeks),
      )
      .map((row) => ({
        horizonWeeks: numberOf(row.forecast_horizon_weeks),
        modelKey: row.model_key,
        status: row.promotion_status,
        seasonalMae: numberOf(row.seasonal_baseline_mae),
        modelMae: numberOf(row.model_mae),
        maeImprovementPct: numberOf(row.mae_improvement_pct),
        intervalMultiplier: numberOf(row.interval_multiplier),
        intervalHalfWidth: numberOf(row.interval_half_width),
        validationCoveragePct: numberOf(row.interval_validation_coverage_pct),
      })),
    forecastMonitoring: [...forecastMonitoringRows]
      .sort(
        (a, b) =>
          numberOf(a.forecast_horizon_weeks) -
          numberOf(b.forecast_horizon_weeks),
      )
      .map((row) => ({
        horizonWeeks: numberOf(row.forecast_horizon_weeks),
        modelKey: row.model_key,
        observations: numberOf(row.observation_count),
        windowWeeks: numberOf(row.monitoring_window_weeks),
        startWeek: row.monitoring_start_week,
        endWeek: row.monitoring_end_week,
        liveMae: row.live_mae === null ? null : numberOf(row.live_mae),
        liveWapePct:
          row.live_wape_pct === null ? null : numberOf(row.live_wape_pct),
        liveCoveragePct:
          row.live_interval_coverage_pct === null
            ? null
            : numberOf(row.live_interval_coverage_pct),
        status: row.monitoring_status,
        reason: row.monitoring_reason,
      })),
    baseline: evaluateCollisionBaseline(forecastRows),
  };
}
