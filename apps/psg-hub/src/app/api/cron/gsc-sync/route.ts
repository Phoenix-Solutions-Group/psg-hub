import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGscSnapshots } from "@/lib/google-oauth/gsc-sync";

// 11-03: GSC ingest trigger. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`); POST is supported for manual triggers
// with the same gate. The gate runs BEFORE any client construction or shop read —
// an unauthorized call spends zero Google API units.
//
// runtime=nodejs is REQUIRED (the googleapis Search Console client is NOT Edge-safe).
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

// GSC shares the GA4 combined consent — the IDENTICAL OAuth creds (one refresh
// token, both APIs). NO developer token (unlike Google Ads), NO new redirect URI.
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
    return NextResponse.json({ error: "gsc_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const result = await syncGscSnapshots(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
