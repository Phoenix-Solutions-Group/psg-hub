import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGbpReviews } from "@/lib/google-oauth/gbp-reviews-sync";
import {
  classifyPendingSentiment,
  type SentimentSyncResult,
} from "@/lib/reviews/review-sentiment-sync";

// 14-01: GBP per-review ingest trigger. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`); POST is supported for manual triggers with
// the same gate. The gate runs BEFORE any client construction or shop read — an
// unauthorized call spends zero Google API units. Structural copy of gbp-sync.
//
// runtime=nodejs is REQUIRED (the raw-HTTP v4 reviews call uses google-auth-library,
// which is NOT Edge-safe).
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

// Reviews ride the SAME Google OAuth client-app creds the GA4/GSC/GBP verticals use; the
// per-shop refresh token carries `business.manage`. NO dev token.
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
    return NextResponse.json({ error: "gbp_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const result = await syncGbpReviews(service);

  // 14-03: classify-on-ingest. The first post-deploy run sweeps pre-existing rows (the
  // one-shot backfill). CONTAINED — a sentiment failure must never fail the ingest cron.
  let sentiment: SentimentSyncResult | { error: string };
  try {
    sentiment = await classifyPendingSentiment(service);
  } catch (err) {
    sentiment = { error: err instanceof Error ? err.message : String(err) };
    console.error(
      `[gbp-reviews-sync] sentiment classify failed (ingest unaffected): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return NextResponse.json({ ...result, sentiment });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
