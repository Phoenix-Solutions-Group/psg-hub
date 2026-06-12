import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGa4Dimensions } from "@/lib/google-oauth/ga4-dims-sync";
import { priorMonth } from "@/lib/analytics/rollup";

// 12-05c: GA4 dimensional MONTHLY ingest trigger. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`) on the 1st BEFORE the monthly-report cron;
// POST is supported for manual triggers under the same gate. The gate runs BEFORE any
// client construction or shop read — an unauthorized call spends zero Google API units.
//
// The injected month is the JUST-COMPLETED prior month, so the one monthly
// ga4_dimensions row lands at date={prior-month}-01 — exactly what the report reads
// (monthly-report/route.ts computes the same priorMonth). Without this injection the
// orchestrator would default to the current month and the report would see no row.
//
// runtime=nodejs is REQUIRED (the gax/grpc GA4 Data client is NOT Edge-safe).
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// GA4 has NO developer token (unlike Google Ads) — the creds are the Phase-11 OAuth web
// client + the combined-consent redirect. Same guard as the daily ga4-sync cron.
function googleCredsPresent(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI
  );
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!googleCredsPresent()) {
    // Designed not-configured state — the Google OAuth app creds land at the Phase-11
    // gate batch (already set on prod since Phase 11).
    return NextResponse.json({ error: "ga4_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const month = priorMonth(new Date().toISOString().slice(0, 7));
  const result = await syncGa4Dimensions(service, { month });
  return NextResponse.json({ month, ...result });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
