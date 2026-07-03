import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkAnalyticsHealth } from "@/lib/analytics/health";

/**
 * PSG-533: analytics silent-stall alert trigger. Runs daily AFTER the ingest
 * crons (semrush/ads/ga4/gsc/gbp fire 06:00-08:00 UTC) so it sees the day's
 * runs. Vercel Cron fires GET with `Authorization: Bearer ${CRON_SECRET}`; POST
 * is supported for manual/operator triggers with the same gate, which runs
 * BEFORE any DB read.
 *
 * On a degraded pipeline it emits one operator-visible `console.error` line per
 * alert prefixed `[analytics-health] ALERT` — the operator wires that to
 * email/Slack (or scrapes it from Vercel logs). This is the visible signal that
 * was missing during the 06-30 PSG-532 stall; the endpoint itself always returns
 * 200 with the structured report (a non-2xx would make Vercel Cron retry a
 * healthy check).
 */

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const report = await checkAnalyticsHealth(service);

  if (!report.ok) {
    console.error(
      `[analytics-health] ALERT: ${report.alerts.length} issue(s) at ${report.checkedAt}`
    );
    for (const alert of report.alerts) {
      console.error(`[analytics-health] ALERT ${alert.kind}: ${alert.detail}`);
    }
  } else {
    console.log(`[analytics-health] ok at ${report.checkedAt}`);
  }

  return NextResponse.json(report);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
