import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGoogleAdsSnapshots } from "@/lib/google-ads/sync";

/**
 * 10-02: Google Ads ingest trigger. Vercel Cron fires GET (with
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set); POST is
 * supported for manual/operator triggers with the same gate. The gate runs
 * BEFORE any client construction or shop read — an unauthorized call spends
 * zero Google API units.
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

function googleCredsPresent(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!googleCredsPresent()) {
    // Designed not-configured state — the Google OAuth app creds land at the
    // Phase-10 gate batch (10-03).
    return NextResponse.json(
      { error: "google_ads_not_configured" },
      { status: 503 }
    );
  }

  const service = createServiceClient();
  const result = await syncGoogleAdsSnapshots(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
