import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGa4Snapshots } from "@/lib/google-oauth/ga4-sync";

// 11-02: GA4 ingest trigger. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`); POST is supported for manual triggers
// with the same gate. The gate runs BEFORE any client construction or shop read —
// an unauthorized call spends zero Google API units.
//
// runtime=nodejs is REQUIRED (the gax/grpc GA4 Data client is NOT Edge-safe) —
// the ads cron template omits this; it must be present here.
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

// GA4 has NO developer token (unlike Google Ads) — the creds are the OAuth web
// client + the Phase-11 combined-consent redirect.
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
    // Designed not-configured state — the Google OAuth app creds land at the
    // shared Phase-11 gate batch.
    return NextResponse.json({ error: "ga4_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const result = await syncGa4Snapshots(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
