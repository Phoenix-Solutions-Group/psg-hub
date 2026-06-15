import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGbpPresence } from "@/lib/google-oauth/gbp-presence-sync";
import { priorMonth } from "@/lib/analytics/rollup";

// 13-03b: GBP monthly presence + star-rating ingest trigger. Vercel Cron fires GET
// (with `Authorization: Bearer ${CRON_SECRET}`) on the 1st at 04:00 — AFTER ga4-dims
// (02:00) + perf (03:00), BEFORE the monthly report (05:00) so the report reads a fresh
// presence row. POST is supported for manual triggers under the same gate. The gate
// runs BEFORE any client construction or shop read — an unauthorized call spends zero
// Google API units.
//
// The injected month is the JUST-COMPLETED prior month, so the one gbp_presence row
// lands at date={prior-month}-01 — exactly what the report reads (monthly-report
// computes the same priorMonth). Without this injection the orchestrator would default
// to the current month and the report would see no row.
//
// runtime=nodejs is REQUIRED (node:crypto + the server-only google-oauth/service deps).
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

// GBP rides the Phase-11 OAuth web client creds (no developer token) — the SAME guard
// as the daily gbp-sync + the ga4-dims/perf monthly crons.
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
    return NextResponse.json({ error: "gbp_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const month = priorMonth(new Date().toISOString().slice(0, 7));
  const result = await syncGbpPresence(service, { month });
  return NextResponse.json({ month, ...result });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
