import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import { fetchGbpPresence, type FetchGbpPresenceDeps } from "./gbp-presence";
import {
  fetchGbpReviewsAggregate,
  type FetchGbpReviewsDeps,
} from "./gbp-reviews";

/**
 * GBP monthly presence + star-rating ingest orchestrator (Phase 13 / 13-03b).
 * Structural mirror of ga4-dims-sync.ts: one run = exactly ONE idempotent
 * analytics_snapshots row per shop holding a status='linked' gbp google_oauth_accounts
 * row, plus one analytics_sync_runs ledger entry; a single shop's PRESENCE failure is
 * CONTAINED and an auth_failed flips the account to status='error'.
 *
 * KEY DIFFERENCES from the daily gbp-sync AND from ga4-dims-sync:
 *  - source='gbp_presence', period='monthly'. Exactly ONE row per shop at date=
 *    <report-month YYYY-MM-01>. The metrics jsonb merges the Business Information
 *    location STATE (fetchGbpPresence) with the legacy v4 lifetime review AGGREGATE
 *    (fetchGbpReviewsAggregate).
 *  - No date window: presence is point-in-time STOCK and the rating is a lifetime
 *    aggregate, so there is no month-window to pass to the fetch (unlike ga4-dims-sync).
 *  - The rating call is SECOND + tolerated: any reviews failure is swallowed to a
 *    { null, null } pair and the presence row is STILL written, and the account is
 *    NOT flipped (a non-VoM / unverified location simply has no rating).
 *  - Idempotent on (shop_id, source, date, period): re-running nets zero rows.
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type GbpPresenceSyncOptions = {
  /** Injectable "today" (UTC ISO date) — derives the report month when `month` absent. */
  today?: string;
  /** Explicit report month 'YYYY-MM' (the cron injects priorMonth); overrides `today`. */
  month?: string;
  /** Test seam for the per-shop presence-state fetch. */
  fetchPresence?: typeof fetchGbpPresence;
  /** Test seam for the per-shop reviews-aggregate fetch. */
  fetchReviews?: typeof fetchGbpReviewsAggregate;
  /** Passed through to the real fetchers (deps seams). */
  fetchDeps?: FetchGbpPresenceDeps & FetchGbpReviewsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedGbpAccount = {
  id: string;
  shop_id: string;
  external_account_id: string;
};

/** Report month 'YYYY-MM' from an explicit override or the month containing `today`. */
export function reportMonth(options: GbpPresenceSyncOptions): string {
  if (options.month) return options.month;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  return today.slice(0, 7);
}

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "gbp_presence", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[gbp-presence-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[gbp-presence-sync] ledger close failed: ${error.message}`);
  }
}

/** Collapse to ONE account per shop (latest linked_at wins — read is ordered desc). */
function dedupeByShop(rows: LinkedGbpAccount[]): LinkedGbpAccount[] {
  const seen = new Set<string>();
  const out: LinkedGbpAccount[] = [];
  for (const r of rows) {
    if (seen.has(r.shop_id)) continue;
    seen.add(r.shop_id);
    out.push(r);
  }
  return out;
}

export async function syncGbpPresence(
  service: SupabaseClient,
  options: GbpPresenceSyncOptions = {}
): Promise<SyncResult> {
  const periodMonth = reportMonth(options);
  const rowDate = `${periodMonth}-01`;
  const fetchPresence = options.fetchPresence ?? fetchGbpPresence;
  const fetchReviews = options.fetchReviews ?? fetchGbpReviewsAggregate;
  const ledger = await openLedger(service);

  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    const { data: accounts, error } = await service
      .from("google_oauth_accounts")
      .select("id, shop_id, external_account_id")
      .eq("source", "gbp")
      .eq("status", "linked")
      .order("linked_at", { ascending: false });
    if (error) {
      throw new Error(`google_oauth_accounts read failed: ${error.message}`);
    }

    const eligible = dedupeByShop((accounts ?? []) as LinkedGbpAccount[]);

    const rows: AnalyticsSnapshotInsert[] = [];
    for (const account of eligible) {
      try {
        // 1. PRESENCE STATE (can throw -> contained per-shop below).
        const presence = await fetchPresence(account.shop_id, options.fetchDeps);

        // 2. STAR-RATING AGGREGATE (second, tolerated). A reviews failure NEVER drops
        // the presence row and NEVER flips the account — a non-VoM/unverified location
        // simply has no rating, persisted as { null, null }.
        let rating: { average_rating: number | null; total_review_count: number | null } = {
          average_rating: null,
          total_review_count: null,
        };
        try {
          rating = await fetchReviews(account.shop_id, options.fetchDeps);
        } catch (reviewError) {
          console.error(
            `[gbp-presence-sync] shop ${account.shop_id} reviews aggregate failed (presence row kept): ${sanitizeLastError(
              reviewError instanceof Error ? reviewError.message : String(reviewError)
            )}`
          );
        }

        rows.push({
          shop_id: account.shop_id,
          source: "gbp_presence",
          period: "monthly",
          date: rowDate,
          metrics: { ...presence, ...rating },
        });
      } catch (shopError) {
        // Contained per-shop PRESENCE failure (no bare catch). auth_failed flips the
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
          `[gbp-presence-sync] shop ${account.shop_id} failed: ${sanitizeLastError(
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
