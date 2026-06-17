import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGbpReviewReplies } from "@/lib/google-oauth/gbp-reviews-reply-sync";

// 14-02: GBP reply-publish trigger. Structural copy of the 14-01 gbp-reviews-sync cron, with the
// SAME CRON_SECRET gate before any client construction.
//
// BUILD-LOCAL / UNSCHEDULED: this route is intentionally NOT added to vercel.json, so it never
// fires on a schedule, and it is reachable ONLY with the CRON_SECRET (operator-held) — there is no
// customer/membership-reachable publish path in 14-02. Scheduling it is part of the consent-gated
// activation (the Phase-14 gate batch), after the consent/authorization model is decided.
//
// runtime=nodejs is REQUIRED (the raw-HTTP v4 reply uses google-auth-library, not Edge-safe).
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
  const result = await syncGbpReviewReplies(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
