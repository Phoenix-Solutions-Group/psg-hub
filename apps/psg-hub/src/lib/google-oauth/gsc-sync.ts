import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import {
  fetchGscDailyMetrics,
  type FetchGscDailyMetricsDeps,
} from "./gsc-metrics";

/**
 * GSC ingest orchestrator (Phase 11 / 11-03). Structural clone of ga4-sync.ts: one
 * run = idempotent analytics_snapshots rows (source='gsc', period='daily') for every
 * shop holding a status='linked' google_oauth_accounts gsc row, plus one
 * analytics_sync_runs ledger entry. A single shop's failure is CONTAINED; an
 * auth_failed flips the account to status='error' so the 11-01 link surface shows
 * "needs re-link".
 *
 * KEY DIFFERENCES from the GA4 vertical (RESEARCH):
 *  - GSC_RESYNC_DAYS default 7 (WIDER than GA4's 3): GSC data lags ~2-3 days, so the
 *    window must still capture finalized days when yesterday is empty. The idempotent
 *    upsert (onConflict shop_id,source,date,period) makes re-pulling safe; recent
 *    empty days simply yield no rows (never a delete).
 *  - DETERMINISTIC one row per shop (latest linked_at): a shop with two gsc sites must
 *    not double-write the site-less snapshot key (multi-site is deferred — mirrors the
 *    GA4 + Phase-10 ads decision).
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type GscSyncOptions = {
  /** Injectable "today" (UTC ISO date) — clock stays out of callers' paths. */
  today?: string;
  /** Trailing re-sync window in days. Default env GSC_RESYNC_DAYS or 7. */
  resyncDays?: number;
  /** Test seam for the per-shop metrics fetch. */
  fetchMetrics?: typeof fetchGscDailyMetrics;
  /** Passed through to the real fetch (breaker/retry seams). */
  fetchDeps?: FetchGscDailyMetricsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedGscAccount = {
  id: string;
  shop_id: string;
  external_account_id: string;
};

function resyncWindow(): number {
  const raw = process.env.GSC_RESYNC_DAYS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/**
 * Trailing window [yesterday-(resyncDays-1) .. yesterday], derived from the UTC
 * anchor. resyncDays=7 -> a 7-day inclusive range ending yesterday.
 */
export function windowBounds(
  today: string,
  resyncDays: number
): { startDate: string; endDate: string } {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  const endDate = new Date(base - 86_400_000).toISOString().slice(0, 10);
  const startDate = new Date(base - resyncDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { startDate, endDate };
}

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "gsc", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[gsc-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[gsc-sync] ledger close failed: ${error.message}`);
  }
}

/** Collapse to ONE account per shop (latest linked_at wins — the read is already
 *  ordered desc, so keep the first seen). */
function dedupeByShop(rows: LinkedGscAccount[]): LinkedGscAccount[] {
  const seen = new Set<string>();
  const out: LinkedGscAccount[] = [];
  for (const r of rows) {
    if (seen.has(r.shop_id)) continue;
    seen.add(r.shop_id);
    out.push(r);
  }
  return out;
}

export async function syncGscSnapshots(
  service: SupabaseClient,
  options: GscSyncOptions = {}
): Promise<SyncResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const resyncDays = options.resyncDays ?? resyncWindow();
  const fetchMetrics = options.fetchMetrics ?? fetchGscDailyMetrics;
  const { startDate, endDate } = windowBounds(today, resyncDays);
  const ledger = await openLedger(service);

  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    const { data: accounts, error } = await service
      .from("google_oauth_accounts")
      .select("id, shop_id, external_account_id")
      .eq("source", "gsc")
      .eq("status", "linked")
      .order("linked_at", { ascending: false });
    if (error) {
      throw new Error(`google_oauth_accounts read failed: ${error.message}`);
    }

    const eligible = dedupeByShop((accounts ?? []) as LinkedGscAccount[]);

    const rows: AnalyticsSnapshotInsert[] = [];
    for (const account of eligible) {
      try {
        const byDate = await fetchMetrics(
          account.shop_id,
          { startDate, endDate },
          options.fetchDeps
        );
        for (const [date, metrics] of byDate) {
          rows.push({
            shop_id: account.shop_id,
            source: "gsc",
            period: "daily",
            date,
            metrics,
          });
        }
      } catch (shopError) {
        // Contained per-shop failure (no bare catch). An auth_failed flips the
        // account so the 11-01 surface shows "needs re-link"; the batch continues.
        result.failed += 1;
        const mapped =
          shopError instanceof GoogleApiError
            ? shopError
            : mapGoogleApiError(shopError);
        if (mapped.code === "auth_failed") {
          await markAccountError(account.id, mapped.message);
        }
        console.error(
          `[gsc-sync] shop ${account.shop_id} failed: ${sanitizeLastError(
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
