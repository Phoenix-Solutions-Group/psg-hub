import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncSpcReports } from "@/lib/collision-intelligence/spc-sync";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const [weather, forecasts, repairFeed] = await Promise.allSettled([
    syncSpcReports(service),
    service.rpc("run_collision_weekly_forecasts"),
    service
      .from("v_collision_repair_feed_status")
      .select("shop_id,source_age_hours")
      .eq("is_stale", true),
  ]);
  const [stormSources, forecastReadiness] = await Promise.allSettled([
    service
      .from("v_collision_storm_source_reconciliation")
      .select(
        "source_key,import_batch_id,event_rows,reported_rows,reconciliation_status",
      )
      .eq("is_reconciled", false),
    service
      .from("v_collision_forecast_readiness")
      .select("shop_id,forecast_horizon_weeks,readiness_status")
      .eq("is_ready", false),
  ]);
  const feedFailed =
    repairFeed.status === "rejected" ||
    (repairFeed.status === "fulfilled" && repairFeed.value.error);
  const staleFeeds =
    repairFeed.status === "fulfilled" && !repairFeed.value.error
      ? (repairFeed.value.data?.length ?? 0)
      : 0;
  const stormSourcesFailed =
    stormSources.status === "rejected" ||
    (stormSources.status === "fulfilled" && stormSources.value.error);
  const unreconciledStormSources =
    stormSources.status === "fulfilled" && !stormSources.value.error
      ? (stormSources.value.data?.length ?? 0)
      : 0;
  const forecastReadinessFailed =
    forecastReadiness.status === "rejected" ||
    (forecastReadiness.status === "fulfilled" && forecastReadiness.value.error);
  const gatedForecasts =
    forecastReadiness.status === "fulfilled" && !forecastReadiness.value.error
      ? (forecastReadiness.value.data?.length ?? 0)
      : 0;
  if (
    weather.status === "rejected" ||
    forecasts.status === "rejected" ||
    forecasts.value.error ||
    feedFailed ||
    staleFeeds > 0 ||
    stormSourcesFailed ||
    unreconciledStormSources > 0 ||
    forecastReadinessFailed ||
    gatedForecasts > 0
  ) {
    const failure =
      weather.status === "rejected"
        ? weather.reason
        : forecasts.status === "rejected"
          ? forecasts.reason
          : forecasts.value.error ||
            (repairFeed.status === "rejected"
              ? repairFeed.reason
              : repairFeed.value.error) ||
            (staleFeeds > 0
              ? new Error(`${staleFeeds} mapped repair feed(s) are stale`)
              : stormSources.status === "rejected"
                ? stormSources.reason
                : stormSources.value.error) ||
            (unreconciledStormSources > 0
              ? new Error(
                  `${unreconciledStormSources} storm source batch(es) are unreconciled`,
                )
              : forecastReadiness.status === "rejected"
                ? forecastReadiness.reason
                : forecastReadiness.value.error) ||
            new Error(`${gatedForecasts} forecast horizon(s) are gated`);
    console.error("[collision-intelligence-cron]", failure);
    return NextResponse.json(
      {
        error: "collision_intelligence_sync_failed",
        weather: weather.status === "rejected" ? "failed" : "success",
        forecasts:
          forecasts.status === "rejected" || forecasts.value.error
            ? "failed"
            : "success",
        repairFeed: feedFailed ? "failed" : staleFeeds ? "stale" : "current",
        stormSources: stormSourcesFailed
          ? "failed"
          : unreconciledStormSources
            ? "unreconciled"
            : "current",
        forecastReadiness: forecastReadinessFailed
          ? "failed"
          : gatedForecasts
            ? "gated"
            : "ready",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    weather: weather.value,
    forecasts: forecasts.value.data,
    repairFeed: "current",
    stormSources: "current",
    forecastReadiness: "ready",
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
