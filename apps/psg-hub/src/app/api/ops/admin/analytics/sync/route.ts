// PSG-645: superadmin "Sync now" trigger. Runs the analytics ingest syncs and/or the
// monthly-report generator ON DEMAND — the same functions the Vercel crons call — so an
// operator can recover from a stalled pipeline or backfill a report without waiting for
// the daily/monthly schedule.
//
// AUTH: requireSuperadmin (NOT CRON_SECRET). Fail-closed — a non-superadmin gets 401/403
// before any external API is touched. CRON_SECRET is never read here and never exposed.
//
// These calls hit external Google / SEMrush APIs and can run for many seconds; steps run
// SEQUENTIALLY inside the dispatcher and the handler is given a 300s ceiling.
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import {
  runManualSync,
  DAILY_SOURCES,
  type ManualSyncDeps,
  type ManualSyncRequest,
  type ManualSyncSourceSelector,
  type ManualSyncCadence,
} from "@/lib/analytics/manual-sync";
import { syncGa4Snapshots } from "@/lib/google-oauth/ga4-sync";
import { syncGscSnapshots } from "@/lib/google-oauth/gsc-sync";
import { syncGbpSnapshots } from "@/lib/google-oauth/gbp-sync";
import { syncGbpReviews } from "@/lib/google-oauth/gbp-reviews-sync";
import { syncGoogleAdsSnapshots } from "@/lib/google-ads/sync";
import { syncSemrushSnapshots } from "@/lib/semrush/sync";
import { syncGa4Dimensions } from "@/lib/google-oauth/ga4-dims-sync";
import { syncPerformance } from "@/lib/perf/perf-sync";
import { syncGbpPresence } from "@/lib/google-oauth/gbp-presence-sync";
import { runMonthlyReportPipeline } from "@/lib/report/run-cron";

const CADENCES: ManualSyncCadence[] = ["daily", "monthly"];
const SOURCE_SELECTORS: ManualSyncSourceSelector[] = ["all", ...DAILY_SOURCES];
const PERIOD_RE = /^\d{4}-\d{2}$/;

type ParsedBody =
  | { ok: true; request: ManualSyncRequest }
  | { ok: false; error: string };

function parseBody(raw: unknown): ParsedBody {
  const body = (raw ?? {}) as Record<string, unknown>;

  const cadence = (body.cadence ?? "daily") as ManualSyncCadence;
  if (!CADENCES.includes(cadence)) {
    return { ok: false, error: `invalid cadence (expected ${CADENCES.join(" | ")})` };
  }

  const request: ManualSyncRequest = { cadence };

  if (cadence === "daily") {
    const source = (body.source ?? "all") as ManualSyncSourceSelector;
    if (!SOURCE_SELECTORS.includes(source)) {
      return { ok: false, error: `invalid source (expected ${SOURCE_SELECTORS.join(" | ")})` };
    }
    request.source = source;
  } else {
    if (body.period !== undefined) {
      if (typeof body.period !== "string" || !PERIOD_RE.test(body.period)) {
        return { ok: false, error: "invalid period (expected YYYY-MM)" };
      }
      request.period = body.period;
    }
    if (body.force !== undefined) {
      if (typeof body.force !== "boolean") {
        return { ok: false, error: "invalid force (expected boolean)" };
      }
      request.force = body.force;
    }
  }

  return { ok: true, request };
}

function realDeps(): ManualSyncDeps {
  return {
    syncGa4: (svc) => syncGa4Snapshots(svc),
    syncGsc: (svc) => syncGscSnapshots(svc),
    syncGbp: (svc) => syncGbpSnapshots(svc),
    syncGbpReviews: (svc) => syncGbpReviews(svc),
    syncGoogleAds: (svc) => syncGoogleAdsSnapshots(svc),
    syncSemrush: (svc, opts) => syncSemrushSnapshots(svc, opts),
    syncGa4Dims: (svc, opts) => syncGa4Dimensions(svc, opts),
    syncPerf: (svc, opts) => syncPerformance(svc, opts),
    syncGbpPresence: (svc, opts) => syncGbpPresence(svc, opts),
    runMonthlyReport: (svc, opts) => runMonthlyReportPipeline(svc, opts),
    env: process.env,
    nowMonth: new Date().toISOString().slice(0, 7),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  // Fail-closed superadmin gate — runs before any external client is constructed.
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const service = createServiceClient();
  const result = await runManualSync(service, parsed.request, realDeps());

  // Surface a non-2xx when the run produced no successful step, so the operator sees a
  // failure at the HTTP layer (not just buried in per-source outcomes):
  //   - every step skipped (nothing configured) -> 503
  //   - at least one step errored and none succeeded -> 502
  //   - otherwise (any success) -> 200
  const anySuccess = result.results.some((r) => r.status === "success");
  const anyError = result.results.some((r) => r.status === "error");
  const status = anySuccess ? 200 : anyError ? 502 : 503;

  return NextResponse.json(result, { status });
}
