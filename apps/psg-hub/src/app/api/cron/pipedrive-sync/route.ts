import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPipedriveClient } from "@/lib/pipedrive/client";
import { syncPipedriveDeals, type SyncSupabase } from "@/lib/pipedrive/sync";
import { enrollStalledPipedriveDeals, type NurtureSupabase } from "@/lib/nurture/enrollment";

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

// PSG-623 — pull won/lost deals (not just open) into the mirror so the won/booked
// reconciliation line (buildDealsExport) has live data. Rolling window in days; matches
// the export's default 90-day reconcile window (DEFAULT_CLOSED_WITHIN_DAYS in export.ts).
// Pipedrive `updated_since` filters by update_time, which is >= a deal's close date, so a
// 90-day update window fully covers every deal CLOSED in the last 90 days. Over-fetching is
// harmless: the UPSERT is idempotent and the export re-windows on closeDate.
const CLOSED_RECONCILE_WINDOW_DAYS = 90;

/**
 * RFC3339 timestamp `CLOSED_RECONCILE_WINDOW_DAYS` before `now`, for the won/lost pull.
 * Pipedrive v2 `/deals?updated_since=` REJECTS a fractional-second datetime with HTTP 400
 * ("This value is not a valid datetime"), so we strip the milliseconds `toISOString()`
 * emits and send whole-second UTC (`YYYY-MM-DDTHH:MM:SSZ`). PSG-630.
 */
function closedUpdatedSince(now: Date): string {
  const ms = CLOSED_RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * PSG-760 — resolve the won/lost `closedUpdatedSince` window for one run.
 *
 * Default (the Vercel daily cron, which calls with NO query param): the rolling
 * `CLOSED_RECONCILE_WINDOW_DAYS`-day window (PSG-623) — behaviour is unchanged.
 *
 * One-time override: `?since=YYYY-MM-DD` widens the won/lost pull to everything updated on
 * or after that calendar date, for a full historical backfill (used to backfill client
 * (org) names onto every mirrored deal — the newer v2 `/deals` API returns no org name, so
 * only a re-sync fills them). Strictly validated to a real calendar date and emitted as
 * whole-second RFC3339 (PSG-630) so Pipedrive never rejects it with HTTP 400. Anything
 * malformed silently falls back to the safe default — an override can only ever WIDEN a
 * read window, never change what gets written (the UPSERT is idempotent).
 */
export function resolveClosedSince(requestUrl: string, now: Date): string {
  let since: string | null = null;
  try {
    since = new URL(requestUrl).searchParams.get("since");
  } catch {
    since = null;
  }
  if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const iso = `${since}T00:00:00Z`;
    const parsed = new Date(iso);
    // Reject regex-passing-but-invalid dates. JS rolls an out-of-range day OVER rather
    // than failing (2026-02-30 → 2026-03-02), so validity requires the parsed instant to
    // round-trip back to the SAME calendar date, not just be non-NaN.
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(since)) {
      return iso;
    }
  }
  return closedUpdatedSince(now);
}

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
  const result = await syncPipedriveDeals({
    client,
    service,
    closedUpdatedSince: resolveClosedSince(request.url, new Date()),
  });
  const stalled = result.ok
    ? await enrollStalledPipedriveDeals(service as unknown as NurtureSupabase)
    : null;
  // A captured sync failure (e.g. Pipedrive 5xx) is a 502, not a 200 — so cron alerts.
  return NextResponse.json({ ...result, stalledNurture: stalled }, { status: result.ok ? 200 : 502 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
