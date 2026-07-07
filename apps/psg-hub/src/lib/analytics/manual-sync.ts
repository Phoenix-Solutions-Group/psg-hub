import type { SupabaseClient } from "@supabase/supabase-js";
import { priorMonth } from "@/lib/analytics/rollup";
import { psiConfigured } from "@/lib/perf/psi";
import type { PerformanceSyncOptions } from "@/lib/perf/perf-sync";
import type { MonthlyCounts } from "@/lib/report/monthly";
import { reportPipelineConfigured } from "@/lib/report/run-cron";

// PSG-645: on-demand analytics sync / monthly-report generation, driven by the
// superadmin "Sync now" button in /ops. This module dispatches to the EXACT SAME sync
// functions the Vercel crons call (see src/app/api/cron/*/route.ts) and normalizes each
// into a uniform { source, status, rows_written, error } outcome. Each sync function
// still opens its own analytics_sync_runs ledger row — this route adds no second ledger.
//
// SCOPE: the underlying sync functions are fleet-wide (they iterate every linked
// google_oauth_accounts / shop). There is no per-shop filter today, so a manual run is
// always fleet-scoped ("all shops"). For the pilot (a handful of shops) fleet == the
// shop(s), which satisfies the "sync a shop and see rows land" acceptance. Per-shop
// targeting would require a shop_id param threaded through each sync fn — a follow-up.
//
// AUTH: this module is auth-agnostic. The route (/api/ops/admin/analytics/sync) gates
// with requireSuperadmin BEFORE calling in; nothing here touches CRON_SECRET.

/** The daily ingest sources, in run order. Mirrors the daily cron set. */
export const DAILY_SOURCES = [
  "ga4",
  "gsc",
  "gbp",
  "gbp_reviews",
  "google_ads",
  "semrush",
] as const;
export type DailySource = (typeof DAILY_SOURCES)[number];

/** The monthly step set, in run order (the report reads the first three, then generates). */
export const MONTHLY_STEPS = ["ga4-dims", "perf", "gbp-presence", "monthly-report"] as const;
export type MonthlyStep = (typeof MONTHLY_STEPS)[number];

export type ManualSyncCadence = "daily" | "monthly";
export type ManualSyncSourceSelector = DailySource | "all";

export type ManualSyncRequest = {
  cadence: ManualSyncCadence;
  /** Daily only: which source(s) to run. "all" (default) or one DailySource. */
  source?: ManualSyncSourceSelector;
  /** monthly-report only: re-send an already-delivered report. */
  force?: boolean;
  /** monthly only: target period YYYY-MM (default = just-completed prior month). */
  period?: string;
};

export type SourceStatus = "success" | "error" | "skipped";
export type SourceOutcome = {
  /** Step key: a DailySource or a MonthlyStep. */
  source: string;
  status: SourceStatus;
  /** Rows written to analytics_snapshots (or reports sent, for monthly-report). */
  rows_written: number;
  /** Present on status="error" (thrown) or status="skipped" (e.g. "not_configured"). */
  error?: string;
  /** Extra structured detail (e.g. skipped/failed counts, monthly counts). */
  detail?: Record<string, unknown>;
};

export type ManualSyncResult = {
  cadence: ManualSyncCadence;
  scope: "fleet";
  period?: string;
  results: SourceOutcome[];
};

/** Shape shared by every daily/monthly ingest sync fn. */
type SyncResult = { synced: number; skipped: number; failed: number };

/**
 * Injectable dependencies — real functions in prod, fakes in unit tests. Keeping the
 * dispatch table behind an interface lets us assert exactly which step ran (and in what
 * order) without touching Supabase or any external API.
 */
export type ManualSyncDeps = {
  syncGa4: (svc: SupabaseClient) => Promise<SyncResult>;
  syncGsc: (svc: SupabaseClient) => Promise<SyncResult>;
  syncGbp: (svc: SupabaseClient) => Promise<SyncResult>;
  syncGbpReviews: (svc: SupabaseClient) => Promise<SyncResult>;
  syncGoogleAds: (svc: SupabaseClient) => Promise<SyncResult>;
  syncSemrush: (svc: SupabaseClient, opts: { apiKey: string }) => Promise<SyncResult>;
  syncGa4Dims: (svc: SupabaseClient, opts: { month: string }) => Promise<SyncResult>;
  syncPerf: (svc: SupabaseClient, opts: PerformanceSyncOptions) => Promise<SyncResult>;
  syncGbpPresence: (svc: SupabaseClient, opts: { month: string }) => Promise<SyncResult>;
  runMonthlyReport: (
    svc: SupabaseClient,
    opts: { force?: boolean; period?: string }
  ) => Promise<{ period: string; counts: MonthlyCounts }>;
  /** Env source for the config gates (overridable in tests). */
  env: NodeJS.ProcessEnv;
  /** Current month YYYY-MM (overridable in tests); the monthly steps target its prior month. */
  nowMonth: string;
};

// --- config gates: mirror each cron route's `*_not_configured` predicate exactly ---

function ga4LikeConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI
  );
}

function gbpLikeConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    (env.GOOGLE_GBP_OAUTH_CLIENT_ID ?? env.GOOGLE_OAUTH_CLIENT_ID) &&
      (env.GOOGLE_GBP_OAUTH_CLIENT_SECRET ?? env.GOOGLE_OAUTH_CLIENT_SECRET) &&
      (env.GOOGLE_GBP_OAUTH_REDIRECT_URI ?? env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI)
  );
}

function googleAdsConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

/** GTMetrix scope from env: explicit shop ids win; else a safe limit of 1 (matches perf cron). */
function gtmetrixScope(env: NodeJS.ProcessEnv): Pick<
  PerformanceSyncOptions,
  "gtmetrixShopIds" | "gtmetrixShopLimit"
> {
  const ids = (env.GTMETRIX_SHOP_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 0) return { gtmetrixShopIds: ids };
  return { gtmetrixShopLimit: 1 };
}

/** Run one step: skip if not configured, catch throws, normalize SyncResult → outcome. */
async function runStep(
  source: string,
  configured: boolean,
  run: () => Promise<SyncResult>
): Promise<SourceOutcome> {
  if (!configured) {
    return { source, status: "skipped", rows_written: 0, error: "not_configured" };
  }
  try {
    const r = await run();
    return {
      source,
      status: "success",
      rows_written: r.synced,
      detail: { skipped: r.skipped, failed: r.failed },
    };
  } catch (err) {
    return {
      source,
      status: "error",
      rows_written: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Dispatch a single daily source. */
function runDailySource(
  service: SupabaseClient,
  source: DailySource,
  deps: ManualSyncDeps
): Promise<SourceOutcome> {
  const env = deps.env;
  switch (source) {
    case "ga4":
      return runStep("ga4", ga4LikeConfigured(env), () => deps.syncGa4(service));
    case "gsc":
      return runStep("gsc", ga4LikeConfigured(env), () => deps.syncGsc(service));
    case "gbp":
      return runStep("gbp", gbpLikeConfigured(env), () => deps.syncGbp(service));
    case "gbp_reviews":
      return runStep("gbp_reviews", gbpLikeConfigured(env), () => deps.syncGbpReviews(service));
    case "google_ads":
      return runStep("google_ads", googleAdsConfigured(env), () => deps.syncGoogleAds(service));
    case "semrush": {
      const apiKey = env.SEMRUSH_API_KEY;
      return runStep("semrush", Boolean(apiKey), () =>
        deps.syncSemrush(service, { apiKey: apiKey as string })
      );
    }
  }
}

/**
 * Run an on-demand sync. Steps run SEQUENTIALLY (each hits external Google/SEMrush APIs
 * and can take many seconds; sequential keeps us under the invocation ceiling and avoids
 * hammering shared quota). A single step's failure never aborts the rest — every step
 * reports its own outcome.
 */
export async function runManualSync(
  service: SupabaseClient,
  request: ManualSyncRequest,
  deps: ManualSyncDeps
): Promise<ManualSyncResult> {
  if (request.cadence === "daily") {
    const selector = request.source ?? "all";
    const sources: readonly DailySource[] =
      selector === "all" ? DAILY_SOURCES : [selector];
    const results: SourceOutcome[] = [];
    for (const source of sources) {
      results.push(await runDailySource(service, source, deps));
    }
    return { cadence: "daily", scope: "fleet", results };
  }

  // monthly: fixed ordered set (ga4-dims → perf → gbp-presence → monthly-report).
  const month = request.period ?? priorMonth(deps.nowMonth);
  const env = deps.env;
  const results: SourceOutcome[] = [];

  results.push(
    await runStep("ga4-dims", ga4LikeConfigured(env), () =>
      deps.syncGa4Dims(service, { month })
    )
  );
  results.push(
    await runStep("perf", psiConfigured(), () =>
      deps.syncPerf(service, { month, ...gtmetrixScope(env) })
    )
  );
  results.push(
    await runStep("gbp-presence", gbpLikeConfigured(env), () =>
      deps.syncGbpPresence(service, { month })
    )
  );

  // monthly-report: not a SyncResult — normalize its counts into an outcome.
  if (!reportPipelineConfigured()) {
    results.push({
      source: "monthly-report",
      status: "skipped",
      rows_written: 0,
      error: "not_configured",
    });
  } else {
    try {
      const { counts } = await deps.runMonthlyReport(service, {
        force: request.force,
        period: month,
      });
      results.push({
        source: "monthly-report",
        status: "success",
        rows_written: counts.sent,
        detail: { ...counts },
      });
    } catch (err) {
      results.push({
        source: "monthly-report",
        status: "error",
        rows_written: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { cadence: "monthly", scope: "fleet", period: month, results };
}
