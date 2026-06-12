import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import { monthWindow } from "@/lib/analytics/rollup";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import {
  fetchGa4Dimensions,
  type FetchGa4DimensionsDeps,
} from "./ga4-dimensions";

/**
 * GA4 dimensional ingest orchestrator (Phase 12 / 12-05a). Structural mirror of
 * ga4-sync.ts: one run = idempotent analytics_snapshots rows for every shop holding a
 * status='linked' ga4 google_oauth_accounts row, plus one analytics_sync_runs ledger
 * entry; a single shop's failure is CONTAINED and an auth_failed flips the account to
 * status='error'.
 *
 * KEY DIFFERENCES from the daily ga4-sync:
 *  - source='ga4_dimensions', period='monthly'. Exactly ONE row per shop at
 *    date=<first-of-report-month YYYY-MM-01>, the four top-N dimension arrays nested in
 *    metrics jsonb (NOT a date-fanned map of daily rows).
 *  - The window is the WHOLE report month (one monthly runReport per dimension inside
 *    the fetch), not a trailing re-sync window. Default month = the calendar month
 *    containing options.today; 12-05c injects the report month explicitly.
 *  - Idempotent on (shop_id, source, date, period): re-running the sync nets zero rows.
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type Ga4DimsSyncOptions = {
  /** Injectable "today" (UTC ISO date) — derives the report month when `month` absent. */
  today?: string;
  /** Explicit report month 'YYYY-MM' (12-05c injects this); overrides `today`. */
  month?: string;
  /** Test seam for the per-shop dimensional fetch. */
  fetchDimensions?: typeof fetchGa4Dimensions;
  /** Passed through to the real fetch (breaker/retry seams). */
  fetchDeps?: FetchGa4DimensionsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedGa4Account = {
  id: string;
  shop_id: string;
  external_account_id: string;
};

/** Report month 'YYYY-MM' from an explicit override or the month containing `today`. */
export function reportMonth(options: Ga4DimsSyncOptions): string {
  if (options.month) return options.month;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  return today.slice(0, 7);
}

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "ga4_dimensions", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[ga4-dims-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[ga4-dims-sync] ledger close failed: ${error.message}`);
  }
}

/** Collapse to ONE account per shop (latest linked_at wins — read is ordered desc). */
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

export async function syncGa4Dimensions(
  service: SupabaseClient,
  options: Ga4DimsSyncOptions = {}
): Promise<SyncResult> {
  const periodMonth = reportMonth(options);
  const window = monthWindow(periodMonth); // { start: YYYY-MM-01, end: YYYY-MM-last }
  const rowDate = `${periodMonth}-01`;
  const fetchDimensions = options.fetchDimensions ?? fetchGa4Dimensions;
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
        const metrics = await fetchDimensions(
          account.shop_id,
          { start: window.start, end: window.end },
          options.fetchDeps
        );
        rows.push({
          shop_id: account.shop_id,
          source: "ga4_dimensions",
          period: "monthly",
          date: rowDate,
          metrics,
        });
      } catch (shopError) {
        // Contained per-shop failure (no bare catch). auth_failed flips the account
        // so the 11-01 surface shows "needs re-link"; the batch continues.
        result.failed += 1;
        const mapped =
          shopError instanceof GoogleApiError
            ? shopError
            : mapGoogleApiError(shopError);
        if (mapped.code === "auth_failed") {
          await markAccountError(account.id, mapped.message);
        }
        console.error(
          `[ga4-dims-sync] shop ${account.shop_id} failed: ${sanitizeLastError(
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
