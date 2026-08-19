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
  const feedFailed =
    repairFeed.status === "rejected" ||
    (repairFeed.status === "fulfilled" && repairFeed.value.error);
  const staleFeeds =
    repairFeed.status === "fulfilled" && !repairFeed.value.error
      ? (repairFeed.value.data?.length ?? 0)
      : 0;
  if (
    weather.status === "rejected" ||
    forecasts.status === "rejected" ||
    forecasts.value.error ||
    feedFailed ||
    staleFeeds > 0
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
            new Error(`${staleFeeds} mapped repair feed(s) are stale`);
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
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    weather: weather.value,
    forecasts: forecasts.value.data,
    repairFeed: "current",
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
