import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert } from "@/lib/analytics/types";
import {
  fetchShopMetrics,
  normalizeDomain,
  redactApiKey,
  type SemrushClientOptions,
} from "./client";

/**
 * SEMrush ingest orchestrator (09-03). One run = one snapshot row per
 * url-bearing shop (source='semrush', period='daily', date = today UTC) via the
 * idempotent 09-01 upsert — same-day re-runs net zero new rows. Shops without a
 * url are SKIPPED (their designed no-data state stands). A single shop's
 * failure is contained: it counts as failed and the batch continues.
 *
 * PERIOD NOTE (plan grounding #2): daily rows, not the research's monthly —
 * the 09-02 surface reads period='daily' over a trailing-30-day window; each
 * sync day contributes one time-series point. Phase 12 derives rollups.
 */

export type SyncResult = {
  synced: number;
  skipped: number;
  failed: number;
};

export type SyncOptions = Omit<SemrushClientOptions, "apiKey"> & {
  apiKey: string;
  /** Injectable "today" (ISO date) — clock stays out of callers' render paths. */
  today?: string;
  /** Test seam for the per-shop metrics fetch. */
  fetchMetrics?: typeof fetchShopMetrics;
};

type LedgerHandle = { id: string } | null;

async function openLedger(
  service: SupabaseClient
): Promise<LedgerHandle> {
  const { data, error } = await service
    .from("analytics_sync_runs")
    .insert({ source: "semrush", status: "running" })
    .select("id")
    .single();
  if (error || !data) {
    // The ledger is observability, not the sync itself — log and carry on.
    console.error(`[semrush-sync] ledger open failed: ${error?.message}`);
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
    // Never let a ledger-finalize failure mask the sync result.
    console.error(`[semrush-sync] ledger close failed: ${error.message}`);
  }
}

export async function syncSemrushSnapshots(
  service: SupabaseClient,
  options: SyncOptions
): Promise<SyncResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const fetchMetrics = options.fetchMetrics ?? fetchShopMetrics;
  const ledger = await openLedger(service);

  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 };

  try {
    const { data: shops, error } = await service.from("shops").select("id, url");
    if (error) {
      throw new Error(`shops read failed: ${error.message}`);
    }

    const rows: AnalyticsSnapshotInsert[] = [];
    // First per-shop failure reason (redacted), surfaced in the ledger so a
    // dark run names its own cause (e.g. an expired key's `ERROR 120`) instead
    // of only whispering it to the function logs.
    let firstShopError: string | undefined;
    for (const shop of shops ?? []) {
      const domain = normalizeDomain(shop.url as string | null);
      if (!domain) {
        result.skipped += 1;
        continue;
      }
      try {
        const metrics = await fetchMetrics(domain, options);
        rows.push({
          shop_id: shop.id as string,
          source: "semrush",
          period: "daily",
          date: today,
          metrics,
        });
      } catch (shopError) {
        // Contained per-shop failure — recorded, batch continues (no bare catch).
        result.failed += 1;
        // redactApiKey: an upstream fetch error could embed the request URL
        // (and SEMrush auth is query-param-only) — never log the key.
        const redacted = redactApiKey(
          shopError instanceof Error ? shopError.message : String(shopError)
        );
        if (!firstShopError) firstShopError = redacted;
        console.error(`[semrush-sync] shop ${shop.id} (${domain}) failed: ${redacted}`);
      }
    }

    result.synced = await upsertSnapshots(service, rows);

    // Observability guard (PSG-534): a run where every eligible (url-bearing)
    // shop failed and NOTHING was written must not masquerade as `success`.
    // Before this, an invalid/expired/quota-exhausted API key produced a
    // healthy-looking `status=success, rows_written=0` row — indistinguishable
    // from the legitimate "no shops to sync" case — so the source went silently
    // dark for days. Skips alone (no failures) stay success: that is the
    // designed no-data state, not an error.
    if (result.failed > 0 && result.synced === 0) {
      await closeLedger(service, ledger, {
        status: "error",
        rows_written: 0,
        error:
          `all ${result.failed} eligible shop(s) failed; 0 snapshots written ` +
          `(${result.skipped} skipped for no url). first error: ${firstShopError ?? "unknown"}`,
      });
      return result;
    }

    await closeLedger(service, ledger, {
      status: "success",
      rows_written: result.synced,
    });
    return result;
  } catch (runError) {
    const message = redactApiKey(
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
