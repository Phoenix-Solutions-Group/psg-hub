import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  buildCollisionDashboard,
  type CollisionAlertRow,
  type CollisionCrashRow,
  type CollisionCrashSourceRow,
  type CollisionForecastRow,
  type CollisionForecastMonitoringRow,
  type CollisionForecastStatusRow,
  type CollisionInsurerRow,
  type CollisionModelRegistryRow,
  type CollisionNationalCrashRow,
  type CollisionNationalCrashSourceRow,
  type CollisionQualityRow,
  type CollisionRepairFeedRow,
  type CollisionSeasonalityRow,
  type CollisionSpcSourceRow,
  type CollisionVehicleRow,
  type CollisionWeatherRow,
  type CollisionWeeklyRow,
  type CollisionZipRow,
} from "./aggregate";

/**
 * Call only after resolving shopId from getActiveShopContext. The service client
 * can bypass RLS, so the explicit shop filter and upstream membership check are
 * both required.
 */
export async function getCollisionDashboard(shopId: string) {
  const service = createServiceClient();
  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const [
    weekly,
    weather,
    forecast,
    crashes,
    alerts,
    forecastStatus,
    spcSource,
    insurers,
    customerZips,
    vehicles,
    quality,
    modelRegistry,
    horizonModelRegistry,
    forecastMonitoring,
    repairFeed,
    seasonality,
    crashSource,
  ] = await Promise.all([
    service
      .from("v_collision_weekly_demand")
      .select(
        "company_name,week_start,repair_orders,insured_repair_orders,repair_value_cents,average_cycle_days,cycle_time_observations",
      )
      .eq("shop_id", shopId)
      .order("week_start", { ascending: true }),
    service
      .from("v_collision_weather_monthly")
      .select(
        "month,weather_coverage_pct,weighted_hail_events,weighted_wind_events,weighted_tornado_events,weighted_storm_demand_score,weather_refreshed_at",
      )
      .eq("shop_id", shopId)
      .order("month", { ascending: true }),
    service
      .from("v_collision_forecast_training_weekly")
      .select(
        "week_start,repair_orders,repair_orders_lag_52_weeks,trailing_4_week_average",
      )
      .eq("shop_id", shopId)
      .order("week_start", { ascending: true }),
    service
      .from("v_collision_ksdot_monthly")
      .select(
        "month,customer_zip_count,crash_active_zip_count,total_crashes,fatal_crashes,injury_crashes,property_damage_crashes,rain_or_snow_crashes,weighted_crash_exposure,crash_refreshed_at",
      )
      .eq("shop_id", shopId)
      .lt("month", currentMonth)
      .order("month", { ascending: true }),
    service
      .from("v_collision_zip_alert_candidates")
      .select(
        "zip_code,historical_repair_orders,source_event_id,event_type,event_at,magnitude,magnitude_unit,alert_level,threshold_basis,is_provisional",
      )
      .eq("shop_id", shopId)
      .order("alert_level", { ascending: true })
      .order("historical_repair_orders", { ascending: false })
      .order("event_at", { ascending: false })
      // ponytail: 500 raw 72-hour reports per shop; move clustering into SQL if this cap is reached.
      .limit(500),
    service
      .from("collision_demand_forecasts")
      .select(
        "forecast_origin_week,forecast_horizon_weeks,forecast_week,predicted_repair_orders,lower_repair_orders,upper_repair_orders,prediction_interval_pct,source_latest_arrival_date,source_age_days,status,status_reason,generated_at",
      )
      .eq("shop_id", shopId)
      .order("forecast_origin_week", { ascending: false })
      .order("forecast_horizon_weeks", { ascending: true })
      .limit(4),
    service
      .from("storm_event_sources")
      .select("cycle,row_count,status,imported_at")
      .eq("source_key", "noaa_spc_preliminary_reports")
      .eq("file_family", "daily_reports")
      .order("imported_at", { ascending: false })
      .limit(1),
    service
      .from("v_collision_filemaker_insurers")
      .select(
        "insurance_company_name,insurance_company_normalized,alias_review_status,repair_orders,repair_value_cents",
      )
      .eq("shop_id", shopId)
      .order("repair_orders", { ascending: false })
      .limit(5),
    service
      .from("v_collision_filemaker_zip_summary")
      .select(
        "customer_zip,customer_state,repair_orders,insured_repair_orders,repair_value_cents",
      )
      .eq("shop_id", shopId)
      .order("repair_orders", { ascending: false })
      .limit(5),
    service
      .from("v_collision_filemaker_vehicle_summary")
      .select("vehicle_make,vehicle_model,repair_orders,repair_value_cents")
      .eq("shop_id", shopId)
      .order("repair_orders", { ascending: false })
      .limit(5),
    service
      .from("v_collision_filemaker_quality_summary")
      .select("quality_issue,affected_repairs,repair_orders,affected_percent")
      .eq("shop_id", shopId)
      .order("affected_repairs", { ascending: false })
      .limit(5),
    service
      .from("collision_forecast_model_registry")
      .select(
        "model_key,promotion_status,seasonal_baseline_mae,model_mae,mae_improvement_pct,interval_multiplier,interval_half_width,interval_validation_coverage_pct",
      )
      .eq("shop_id", shopId)
      .limit(1),
    service
      .from("collision_forecast_horizon_registry")
      .select(
        "forecast_horizon_weeks,model_key,promotion_status,seasonal_baseline_mae,model_mae,mae_improvement_pct,interval_multiplier,interval_half_width,interval_validation_coverage_pct",
      )
      .eq("shop_id", shopId)
      .order("forecast_horizon_weeks", { ascending: true }),
    service
      .from("v_collision_forecast_monitoring")
      .select(
        "forecast_horizon_weeks,model_key,observation_count,monitoring_window_weeks,monitoring_start_week,monitoring_end_week,live_mae,live_wape_pct,live_interval_coverage_pct,monitoring_status,monitoring_reason",
      )
      .eq("shop_id", shopId)
      .order("forecast_horizon_weeks", { ascending: true }),
    service
      .from("v_collision_repair_feed_status")
      .select(
        "file_modified_at,imported_at,status,source_age_hours,is_stale,repair_orders,latest_arrival_date",
      )
      .eq("shop_id", shopId)
      .limit(1),
    service
      .from("v_collision_filemaker_seasonality")
      .select(
        "arrival_year,arrival_month,repair_orders,insured_repair_orders,repair_value_cents",
      )
      .eq("shop_id", shopId)
      .order("arrival_year", { ascending: true })
      .order("arrival_month", { ascending: true }),
    service
      .from("ksdot_crash_sources")
      .select("last_sync_status")
      .order("imported_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  const error =
    weekly.error ??
    weather.error ??
    forecast.error ??
    crashes.error ??
    alerts.error ??
    forecastStatus.error ??
    spcSource.error ??
    insurers.error ??
    customerZips.error ??
    vehicles.error ??
    quality.error ??
    modelRegistry.error ??
    horizonModelRegistry.error ??
    forecastMonitoring.error ??
    repairFeed.error ??
    seasonality.error ??
    crashSource.error;
  if (error)
    throw new Error(`Collision dashboard query failed: ${error.message}`);

  let nationalCrashRows: CollisionNationalCrashRow[] = [];
  let nationalCrashSourceRows: CollisionNationalCrashSourceRow[] = [];
  const topCustomerState = customerZips.data?.[0]?.customer_state;

  if (!crashes.data?.length && topCustomerState) {
    const stateReference = await service
      .from("state_references")
      .select("state_name")
      .eq("state_abbr", topCustomerState)
      .maybeSingle();

    if (stateReference.error)
      throw new Error(
        `Collision national crash geography query failed: ${stateReference.error.message}`,
      );

    const stateName = stateReference.data?.state_name;
    if (stateName) {
      const [nationalCrashes, nationalCrashSource] = await Promise.all([
        service
          .from("nhtsa_crashes")
          .select("month")
          .eq("dataset_key", "fars")
          .eq("source_year", 2024)
          .eq("state", stateName),
        service
          .from("nhtsa_dataset_sources")
          .select("source_year,imported_at")
          .eq("dataset_key", "fars")
          .eq("source_year", 2024)
          .limit(1),
      ]);
      const nationalCrashError =
        nationalCrashes.error ?? nationalCrashSource.error;

      if (nationalCrashError)
        throw new Error(
          `Collision national crash query failed: ${nationalCrashError.message}`,
        );

      nationalCrashRows = (nationalCrashes.data ??
        []) as CollisionNationalCrashRow[];
      nationalCrashSourceRows = (nationalCrashSource.data ?? []).map((row) => ({
        ...row,
        state_name: stateName,
      })) as CollisionNationalCrashSourceRow[];
    }
  }

  return buildCollisionDashboard(
    (weekly.data ?? []) as CollisionWeeklyRow[],
    (weather.data ?? []) as CollisionWeatherRow[],
    (forecast.data ?? []) as CollisionForecastRow[],
    (crashes.data ?? []) as CollisionCrashRow[],
    (alerts.data ?? []) as CollisionAlertRow[],
    (forecastStatus.data ?? []) as CollisionForecastStatusRow[],
    (spcSource.data ?? []) as CollisionSpcSourceRow[],
    (insurers.data ?? []) as CollisionInsurerRow[],
    (customerZips.data ?? []) as CollisionZipRow[],
    (vehicles.data ?? []) as CollisionVehicleRow[],
    (quality.data ?? []) as CollisionQualityRow[],
    [
      ...(modelRegistry.data ?? []).map((row) => ({
        ...row,
        forecast_horizon_weeks: 1,
      })),
      ...(horizonModelRegistry.data ?? []),
    ] as CollisionModelRegistryRow[],
    (forecastMonitoring.data ?? []) as CollisionForecastMonitoringRow[],
    (repairFeed.data ?? []) as CollisionRepairFeedRow[],
    (seasonality.data ?? []) as CollisionSeasonalityRow[],
    (crashSource.data ?? []) as CollisionCrashSourceRow[],
    nationalCrashRows,
    nationalCrashSourceRows,
  );
}
