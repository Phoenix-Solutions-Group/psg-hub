import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGbpSnapshots } from "@/lib/google-oauth/gbp-sync";

// 13-02b: GBP daily-insights ingest trigger. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`); POST is supported for manual triggers
// with the same gate. The gate runs BEFORE any client construction or shop read —
// an unauthorized call spends zero Google API units.
//
// runtime=nodejs is REQUIRED (the googleapis Business Profile client is NOT Edge-safe).
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

// GBP Performance calls go through the SAME Google OAuth creds the GA4/GSC verticals
// use (googleOAuthClientEnv) — the gbp link carries its own refresh token under
// `business.manage`, but the client-app id/secret/redirect are shared. NO dev token.
function googleCredsPresent(): boolean {
  return Boolean(
    (process.env.GOOGLE_GBP_OAUTH_CLIENT_ID ??
      process.env.GOOGLE_OAUTH_CLIENT_ID) &&
      (process.env.GOOGLE_GBP_OAUTH_CLIENT_SECRET ??
        process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
      (process.env.GOOGLE_GBP_OAUTH_REDIRECT_URI ??
        process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI)
  );
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!googleCredsPresent()) {
    // Designed not-configured state — the Google OAuth app creds land at the
    // Phase-13 gate batch (13-04).
    return NextResponse.json({ error: "gbp_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const result = await syncGbpSnapshots(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
