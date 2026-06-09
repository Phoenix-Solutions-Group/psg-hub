import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import {
  fetchGa4DailyMetrics,
  type FetchGa4DailyMetricsDeps,
} from "./ga4-metrics";

/**
 * GA4 ingest orchestrator (Phase 11 / 11-02). Structural mirror of
 * google-ads/sync.ts: one run = idempotent analytics_snapshots rows
 * (source='ga4', period='daily') for every shop holding a status='linked'
 * google_oauth_accounts ga4 row, plus one analytics_sync_runs ledger entry. A
 * single shop's failure is CONTAINED; an auth_failed flips the account to
 * status='error' so the 11-01 link surface shows "needs re-link".
 *
 * KEY DIFFERENCES from the ads vertical (RESEARCH):
 *  - ONE trailing-window runReport per property (not N per-date calls) — GA4
 *    quota is non-linear; one window call is far cheaper than N single-day calls.
 *  - GA4_RESYNC_DAYS default 3 (NOT the ads 7): GA4 reprocesses ~18-48h, so a
 *    short trailing window backfills the settling days; the idempotent upsert
 *    (onConflict shop_id,source,date,period) makes re-pulling safe.
 *  - DETERMINISTIC one row per shop (latest linked_at): a shop with two ga4
 *    accounts must not double-write the property-less snapshot key (multi-property
 *    is deferred — mirrors the Phase-10 ads decision).
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type Ga4SyncOptions = {
  /** Injectable "today" (UTC ISO date) — clock stays out of callers' paths. */
  today?: string;
  /** Trailing re-sync window in days. Default env GA4_RESYNC_DAYS or 3. */
  resyncDays?: number;
  /** Test seam for the per-shop metrics fetch. */
  fetchMetrics?: typeof fetchGa4DailyMetrics;
  /** Passed through to the real fetch (breaker/retry seams). */
  fetchDeps?: FetchGa4DailyMetricsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedGa4Account = {
  id: string;
  shop_id: string;
  external_account_id: string;
};

function resyncWindow(): number {
  const raw = process.env.GA4_RESYNC_DAYS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * Trailing window [yesterday-(resyncDays-1) .. yesterday], derived from the UTC
 * anchor. resyncDays=3 -> a 3-day inclusive range ending yesterday.
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
    .insert({ source: "ga4", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[ga4-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[ga4-sync] ledger close failed: ${error.message}`);
  }
}

/** Collapse to ONE account per shop (latest linked_at wins — the read is already
 *  ordered desc, so keep the first seen). */
function dedupeByShop(rows: LinkedGa4Account[]): LinkedGa4Account[] {
  const seen = new Set<string>();
  const out: LinkedGa4Account[] = [];
  for (const r of rows) {
    if (seen.has(r.shop_id)) continue;
    seen.add(r.shop_id);
    out.push(r);
  }
  return out;
}

export async function syncGa4Snapshots(
  service: SupabaseClient,
  options: Ga4SyncOptions = {}
): Promise<SyncResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const resyncDays = options.resyncDays ?? resyncWindow();
  const fetchMetrics = options.fetchMetrics ?? fetchGa4DailyMetrics;
  const { startDate, endDate } = windowBounds(today, resyncDays);
  const ledger = await openLedger(service);

  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    const { data: accounts, error } = await service
      .from("google_oauth_accounts")
      .select("id, shop_id, external_account_id")
      .eq("source", "ga4")
      .eq("status", "linked")
      .order("linked_at", { ascending: false });
    if (error) {
      throw new Error(`google_oauth_accounts read failed: ${error.message}`);
    }

    const eligible = dedupeByShop((accounts ?? []) as LinkedGa4Account[]);

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
            source: "ga4",
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
          `[ga4-sync] shop ${account.shop_id} failed: ${sanitizeLastError(
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
