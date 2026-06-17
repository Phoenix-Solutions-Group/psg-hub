import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import {
  fetchGbpReviews,
  type FetchGbpReviewItemsDeps,
} from "./gbp-review-items";

/**
 * GBP per-review ingest orchestrator (Phase 14 / 14-01). Structural mirror of
 * gbp-presence-sync.ts: one batch run opens ONE analytics_sync_runs ledger row
 * (source='gbp_reviews'), iterates every shop holding a status='linked' gbp
 * google_oauth_accounts row, and upserts that shop's reviews into review_items.
 *
 * DIFFERENCES from the presence orchestrator:
 *  - Writes per-review rows into review_items (NOT a single analytics_snapshots row),
 *    keyed (shop_id, external_review_id) so a re-run nets zero new rows (onConflict).
 *  - review_items.location_id is NOT NULL, so each shop's internal PRIMARY location_id
 *    is resolved first. A shop with NO internal location row is a DATA-GAP, not an auth
 *    failure: it is skipped + counted (flagged for the gate-batch backfill), the account
 *    is NOT flipped, and the batch continues.
 *  - A shop whose fetch returns [] (unverified / non-VoM / no reviews) is counted skipped;
 *    a thrown failure is contained per-shop and flips the account only on auth_failed.
 *
 * The per-shop ingest core (ingestShopReviews) is shared by the batch cron and the
 * single-shop on-demand route (syncGbpReviewsForShop) so both follow ONE code path.
 */

export type SyncResult = {
  synced: number; // total review rows upserted across all shops
  skipped: number; // shops skipped (no internal location, or zero reviews)
  failed: number; // shops whose ingest threw
};

export type GbpReviewsSyncOptions = {
  /** Test seam for the per-shop reviews fetch. */
  fetchReviews?: typeof fetchGbpReviews;
  /** Passed through to the real fetcher (deps seam). */
  fetchDeps?: FetchGbpReviewItemsDeps;
};

type LedgerHandle = { id: string } | null;

type LinkedGbpAccount = { id: string; shop_id: string };

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "gbp_reviews", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[gbp-reviews-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[gbp-reviews-sync] ledger close failed: ${error.message}`);
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

/** A per-shop ingest result. `skipped` = nothing written (no location OR zero reviews). */
type ShopIngest = { inserted: number; skipped: boolean };

/**
 * Resolve the shop's internal PRIMARY location_id, fetch its reviews, and upsert them.
 * THROWS on a fetch failure (mapped GoogleApiError) or an upsert DB error — the CALLER
 * contains it. A missing internal location or an empty fetch returns skipped (no throw).
 */
async function ingestShopReviews(
  service: SupabaseClient,
  account: LinkedGbpAccount,
  fetchReviews: typeof fetchGbpReviews,
  fetchDeps?: FetchGbpReviewItemsDeps
): Promise<ShopIngest> {
  const { data: loc, error: locError } = await service
    .from("locations")
    .select("id")
    .eq("shop_id", account.shop_id)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (locError) {
    throw new Error(`locations read failed: ${locError.message}`);
  }
  if (!loc) {
    // DATA-GAP, not an auth failure: no internal location to FK the review row to.
    console.error(
      `[gbp-reviews-sync] shop ${account.shop_id} has no internal location row — skipped (gate-batch backfill)`
    );
    return { inserted: 0, skipped: true };
  }

  const reviews = await fetchReviews(account.shop_id, fetchDeps);
  if (reviews.length === 0) {
    return { inserted: 0, skipped: true };
  }

  const rows = reviews.map((r) => ({
    shop_id: account.shop_id,
    location_id: (loc as { id: string }).id,
    platform: r.platform,
    rating: r.rating,
    text: r.text,
    author: r.author,
    reviewed_at: r.reviewed_at,
    external_review_id: r.external_review_id,
    updated_at: r.updated_at,
  }));

  const { error: upsertError } = await service
    .from("review_items")
    .upsert(rows, { onConflict: "shop_id,external_review_id" });
  if (upsertError) {
    throw new Error(`review_items upsert failed: ${upsertError.message}`);
  }
  return { inserted: rows.length, skipped: false };
}

/** Contain a per-shop failure: flip the account only on auth_failed, never rethrow. */
async function containFailure(
  accountId: string,
  shopId: string,
  err: unknown
): Promise<void> {
  const mapped = err instanceof GoogleApiError ? err : mapGoogleApiError(err);
  if (mapped.code === "auth_failed") {
    await markAccountError(accountId, mapped.message);
  }
  console.error(
    `[gbp-reviews-sync] shop ${shopId} failed: ${sanitizeLastError(mapped.message)}`
  );
}

export async function syncGbpReviews(
  service: SupabaseClient,
  options: GbpReviewsSyncOptions = {}
): Promise<SyncResult> {
  const fetchReviews = options.fetchReviews ?? fetchGbpReviews;
  const ledger = await openLedger(service);
  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    const { data: accounts, error } = await service
      .from("google_oauth_accounts")
      .select("id, shop_id")
      .eq("source", "gbp")
      .eq("status", "linked")
      .order("linked_at", { ascending: false });
    if (error) {
      throw new Error(`google_oauth_accounts read failed: ${error.message}`);
    }

    const eligible = dedupeByShop((accounts ?? []) as LinkedGbpAccount[]);
    for (const account of eligible) {
      try {
        const { inserted, skipped } = await ingestShopReviews(
          service,
          account,
          fetchReviews,
          options.fetchDeps
        );
        result.synced += inserted;
        if (skipped) result.skipped += 1;
      } catch (shopError) {
        result.failed += 1;
        await containFailure(account.id, account.shop_id, shopError);
      }
    }

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

/**
 * Single-shop on-demand ingest, reused by POST /api/reviews/ingest. Resolves the shop's
 * one linked gbp account, runs the SAME ingestShopReviews core as the batch, and returns
 * the { inserted, skipped, errors } shape the reviews UI consumes. A per-shop failure is
 * contained (auth_failed flips the account) and reported as errors:1, never thrown.
 */
export async function syncGbpReviewsForShop(
  service: SupabaseClient,
  shopId: string,
  options: GbpReviewsSyncOptions = {}
): Promise<{ inserted: number; skipped: number; errors: number }> {
  const fetchReviews = options.fetchReviews ?? fetchGbpReviews;
  const { data: account, error } = await service
    .from("google_oauth_accounts")
    .select("id, shop_id")
    .eq("source", "gbp")
    .eq("status", "linked")
    .eq("shop_id", shopId)
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`google_oauth_accounts read failed: ${error.message}`);
  }
  if (!account) {
    // No linked gbp account for this shop — nothing to ingest (not an error).
    return { inserted: 0, skipped: 1, errors: 0 };
  }

  try {
    const { inserted, skipped } = await ingestShopReviews(
      service,
      account as LinkedGbpAccount,
      fetchReviews,
      options.fetchDeps
    );
    return { inserted, skipped: skipped ? 1 : 0, errors: 0 };
  } catch (shopError) {
    await containFailure(
      (account as LinkedGbpAccount).id,
      shopId,
      shopError
    );
    return { inserted: 0, skipped: 0, errors: 1 };
  }
}
