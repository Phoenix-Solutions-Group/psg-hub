import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPipedriveClient } from "@/lib/pipedrive/client";
import { syncPipedriveDeals, type SyncSupabase } from "@/lib/pipedrive/sync";

// PSG-446 — Pipedrive deals sync trigger (durable mirror, PSG-434).
// Vercel Cron fires GET daily with `Authorization: Bearer ${CRON_SECRET}`; POST is
// the documented MANUAL refresh path (same gate). The auth gate runs BEFORE any
// client construction or Pipedrive read — an unauthorized call spends zero API calls
// and never touches the token.
//
// Refresh path (also in src/lib/pipedrive/README.md):
//   • Automatic: Vercel cron (daily) → this GET. Freshness via pipedrive_sync_runs.
//   • Manual:    POST here with the CRON_SECRET, or run syncPipedriveDeals() directly.
//
// runtime=nodejs is REQUIRED: node:crypto timingSafeEqual + the service-role client.
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

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.PIPEDRIVE_API_TOKEN) {
    // Designed not-configured state — the token lands via the PSG-445 operator task.
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }

  // The service-role client is the full Supabase client; the sync only needs the
  // narrow `from().upsert/insert` seam (typed for the unit-test fake), so narrow it.
  const service = createServiceClient() as unknown as SyncSupabase;
  const client = createPipedriveClient({
    companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
  });
  const result = await syncPipedriveDeals({ client, service });
  // A captured sync failure (e.g. Pipedrive 5xx) is a 502, not a 200 — so cron alerts.
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
