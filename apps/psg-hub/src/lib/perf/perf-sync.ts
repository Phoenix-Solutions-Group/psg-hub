import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type {
  AnalyticsSnapshotInsert,
  PerformanceMetrics,
} from "@/lib/analytics/types";
import { fetchPsi, psiConfigured, type FetchPsiDeps } from "./psi";
import {
  fetchGtmetrix,
  gtmetrixConfigured,
  type FetchGtmetrixDeps,
} from "./gtmetrix";

/**
 * Website-performance ingest orchestrator (Phase 12 / 12-05b). One run = ONE idempotent
 * period='monthly' analytics_snapshots row (source='performance') per url-bearing shop, plus one
 * analytics_sync_runs ledger row. Mirrors semrush/sync.ts (shops.url eligibility, url-less SKIPPED,
 * contained per-shop failure) and ga4-dims-sync.ts (monthly single-row, idempotent upsert).
 *
 * PSI is the always-present floor; GTMetrix is optional enrichment, bounded by scope (limit/ids)
 * because its in-loop poll (~60s/shop) on top of PSI (~20s/shop) can exceed the 300s Fluid
 * invocation across many shops (12-05c scopes it to the pilot). When PSI is unconfigured the run is
 * a designed NO-OP (no torn ledger) and the report degrades gracefully (no perf block).
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type PerformanceSyncOptions = {
  /** Injectable "today" (UTC ISO date) — derives the report month when `month` absent. */
  today?: string;
  /** Explicit report month 'YYYY-MM' (12-05c injects this); overrides `today`. */
  month?: string;
  /** Test seams for the per-shop fetches. */
  fetchPsiFn?: typeof fetchPsi;
  fetchGtmetrixFn?: typeof fetchGtmetrix;
  psiDeps?: FetchPsiDeps;
  gtmetrixDeps?: FetchGtmetrixDeps;
  /** Bound GTMetrix to the first N url-shops (PSI still runs for all). */
  gtmetrixShopLimit?: number;
  /** Bound GTMetrix to an explicit shop-id allowlist (takes precedence over the limit). */
  gtmetrixShopIds?: string[];
};

type LedgerHandle = { id: string } | null;
type ShopRow = { id: string; url: string | null };

/** Report month 'YYYY-MM' from an explicit override or the month containing `today`. */
export function reportMonth(options: PerformanceSyncOptions): string {
  if (options.month) return options.month;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  return today.slice(0, 7);
}

/** Full https homepage URL from a stored shop url; null when empty. */
export function toHttpsUrl(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/+/, "")}`;
}

async function openLedger(service: SupabaseClient): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "performance", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[perf-sync] ledger open failed: ${error?.message}`);
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
    console.error(`[perf-sync] ledger close failed: ${error.message}`);
  }
}

export async function syncPerformance(
  service: SupabaseClient,
  options: PerformanceSyncOptions = {}
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  // Configured guard FIRST: PSI is the required floor. A test seam (fetchPsiFn) bypasses the env
  // check; in prod with no PAGESPEED_API_KEY this is a designed no-op (no ledger opened).
  const configured = options.fetchPsiFn !== undefined || psiConfigured();
  if (!configured) {
    console.warn("[perf-sync] PAGESPEED_API_KEY unset — skipping (designed no-op)");
    return result;
  }

  const fetchPsiFn = options.fetchPsiFn ?? fetchPsi;
  const fetchGtmetrixFn = options.fetchGtmetrixFn ?? fetchGtmetrix;
  const gtmetrixEnabled =
    options.fetchGtmetrixFn !== undefined || gtmetrixConfigured();
  const month = reportMonth(options);
  const rowDate = `${month}-01`;
  const ledger = await openLedger(service);

  try {
    const { data: shops, error } = await service.from("shops").select("id, url");
    if (error) {
      throw new Error(`shops read failed: ${error.message}`);
    }

    let gtmetrixCount = 0;
    const rows: AnalyticsSnapshotInsert[] = [];
    for (const shop of (shops ?? []) as ShopRow[]) {
      const url = toHttpsUrl(shop.url);
      if (!url) {
        result.skipped += 1;
        continue;
      }

      const runGtmetrix =
        gtmetrixEnabled && inGtmetrixScope(shop.id, gtmetrixCount, options);

      try {
        // PSI is the REQUIRED floor — a PSI failure contains the shop.
        const psi = await fetchPsiFn(url, options.psiDeps);
        // GTMetrix is OPTIONAL enrichment — its failure (timeout / 429 / credit exhaustion,
        // the flaky source) must NOT discard the floor PSI row; degrade to lab-only (gtmetrix=null).
        let gtmetrix: PerformanceMetrics["gtmetrix"] = null;
        if (runGtmetrix) {
          try {
            gtmetrix = await fetchGtmetrixFn(url, options.gtmetrixDeps);
            gtmetrixCount += 1;
          } catch (gtmetrixError) {
            console.error(
              `[perf-sync] shop ${shop.id} (${url}) GTMetrix failed (keeping PSI): ${
                gtmetrixError instanceof Error
                  ? gtmetrixError.message
                  : String(gtmetrixError)
              }`
            );
          }
        }
        const metrics: PerformanceMetrics = {
          psi,
          gtmetrix,
          strategy: "mobile",
          tested_url: url,
        };
        rows.push({
          shop_id: shop.id,
          source: "performance",
          period: "monthly",
          date: rowDate,
          metrics,
        });
      } catch (shopError) {
        // Contained per-shop failure (no bare catch). No OAuth account to flip; batch continues.
        result.failed += 1;
        console.error(
          `[perf-sync] shop ${shop.id} (${url}) failed: ${
            shopError instanceof Error ? shopError.message : String(shopError)
          }`
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
    const message =
      runError instanceof Error ? runError.message : String(runError);
    await closeLedger(service, ledger, {
      status: "error",
      rows_written: result.synced,
      error: message,
    });
    throw runError;
  }
}

/** Whether this shop gets a GTMetrix run: allowlist wins, else the first-N limit, else all. */
function inGtmetrixScope(
  shopId: string,
  gtmetrixCount: number,
  options: PerformanceSyncOptions
): boolean {
  if (options.gtmetrixShopIds) return options.gtmetrixShopIds.includes(shopId);
  if (typeof options.gtmetrixShopLimit === "number") {
    return gtmetrixCount < options.gtmetrixShopLimit;
  }
  return true;
}
