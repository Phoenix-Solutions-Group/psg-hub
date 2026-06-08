import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import {
  fetchAccountDailyMetrics,
  type FetchAccountDailyMetricsDeps,
} from "./metrics";
import { markAccountAuthFailed } from "./client";
import { AdsApiError } from "./types";
import { sanitizeLastError } from "./sanitize";

/**
 * Google Ads ingest orchestrator (Phase 10 / 10-02). Structural mirror of
 * semrush/sync.ts: one run = idempotent analytics_snapshots rows
 * (source='google_ads', period='daily') for every shop holding a
 * status='linked' google_ads_accounts row, plus one analytics_sync_runs ledger
 * entry. A single shop's failure is CONTAINED — counted, the batch continues,
 * and an auth_failed flips the account to status='error' so the 10-01 accounts
 * surface shows "needs re-link".
 *
 * DATE DERIVATION (single source for BOTH the query window AND the stored
 * `date`, so the (shop,source,date,period) unique key never collides):
 * UTC-yesterday back `resyncDays`. DEVIATION from the ROADMAP's stated
 * `date=today` — RESEARCH #2: `today` is a partial day (undercounts
 * conversions / overstates CPL); ingest YESTERDAY-settled and let the trailing
 * re-sync backfill conversion lag (the idempotent upsert makes re-fetch safe).
 * The stored date is UTC-derived; ≤1-day skew vs the account-tz segments.date
 * bucket, immaterial over a 30-day trend.
 *
 * COST (RESEARCH #8): one SEARCH call per linked shop per target date. A
 * `resyncDays` window multiplies calls by the window size — size ADS_RESYNC_DAYS
 * against the developer-token tier (Explorer = 2,880 prod ops/day) and shop count.
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type GoogleAdsSyncOptions = {
  /** Injectable "today" (UTC ISO date) — clock stays out of callers' paths. */
  today?: string;
  /** Trailing re-sync window in days. Default env ADS_RESYNC_DAYS or 7. */
  resyncDays?: number;
  /** Test seam for the per-account/per-date metrics fetch. */
  fetchMetrics?: typeof fetchAccountDailyMetrics;
  /** Passed through to the real fetch (breaker/retry seams). */
  fetchDeps?: FetchAccountDailyMetricsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedAccount = { id: string; shop_id: string };

function resyncWindow(): number {
  const raw = process.env.ADS_RESYNC_DAYS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Target dates: yesterday back `resyncDays`, derived from the UTC anchor. */
export function targetDates(today: string, resyncDays: number): string[] {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  const dates: string[] = [];
  for (let i = 1; i <= resyncDays; i++) {
    dates.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "google_ads", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[google-ads-sync] ledger open failed: ${error?.message}`);
    return null;
  }
  return { id: data.id as string };
}

async function closeLedger(
  service: SupabaseClient,
  ledger: LedgerHandle,
  patch: { status: "success" | "error"; rows_written: number; error?: string }
): Promise<void> {
  if (!ledger) return;
  const { error } = await service
    .from("analytics_sync_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", ledger.id);
  if (error) {
    console.error(`[google-ads-sync] ledger close failed: ${error.message}`);
  }
}

export async function syncGoogleAdsSnapshots(
  service: SupabaseClient,
  options: GoogleAdsSyncOptions = {}
): Promise<SyncResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const resyncDays = options.resyncDays ?? resyncWindow();
  const fetchMetrics = options.fetchMetrics ?? fetchAccountDailyMetrics;
  const dates = targetDates(today, resyncDays);
  const ledger = await openLedger(service);

  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    // Eligibility: ONLY shops with a status='linked' account. error/revoked and
    // unlinked shops never enter the loop (they surface their own states).
    const { data: accounts, error } = await service
      .from("google_ads_accounts")
      .select("id, shop_id")
      .eq("status", "linked");
    if (error) {
      throw new Error(`google_ads_accounts read failed: ${error.message}`);
    }

    const rows: AnalyticsSnapshotInsert[] = [];
    for (const account of (accounts ?? []) as LinkedAccount[]) {
      try {
        for (const date of dates) {
          const metrics = await fetchMetrics(
            account.shop_id,
            date,
            options.fetchDeps
          );
          rows.push({
            shop_id: account.shop_id,
            source: "google_ads",
            period: "daily",
            date,
            metrics,
          });
        }
      } catch (shopError) {
        // Contained per-shop failure (no bare catch). An auth_failed flips the
        // account so the 10-01 surface shows "needs re-link"; the batch continues.
        result.failed += 1;
        const mapped =
          shopError instanceof AdsApiError
            ? shopError
            : new AdsApiError(
                "upstream",
                shopError instanceof Error ? shopError.message : String(shopError)
              );
        if (mapped.code === "auth_failed") {
          await markAccountAuthFailed(account.id, mapped.message);
        }
        console.error(
          `[google-ads-sync] shop ${account.shop_id} failed: ${sanitizeLastError(
            mapped.message
          )}`
        );
      }
    }

    result.synced = await upsertSnapshots(service, rows);
    await closeLedger(service, ledger, {
      status: "success",
      rows_written: result.synced,
    });
    return result;
  } catch (runError) {
    const message = sanitizeLastError(
      runError instanceof Error ? runError.message : String(runError)
    );
    await closeLedger(service, ledger, {
      status: "error",
      rows_written: result.synced,
      error: message,
    });
    throw runError;
  }
}
