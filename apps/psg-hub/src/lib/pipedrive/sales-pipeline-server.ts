// PSG-594 — server-only data loader shared by the /ops/sales-pipeline page and its
// /api/ops/sales-pipeline export route. Reads the durable mirror (RLS-gated by the
// caller's Supabase client) → the finished `DealsExport` → the page view model, plus the
// latest `pipedrive_sync_runs` row for freshness. All forecast math is the QA-passed pure
// lib (PSG-446); this file only wires the mirror read + freshness, never recomputes.
//
// Degrades gracefully BEFORE go-live (PSG-592): if the mirror tables are absent or empty
// the read throws / returns no rows, and we surface a `dataError` / empty view instead of
// crashing the page. Real numbers appear the moment the sync tables land + first sync runs.

import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  buildDealsExportFromMirror,
  type MirrorSupabase,
} from "./mirror";
import type { DealsExport } from "./export";
import {
  buildSalesPipelineView,
  type SalesPipelineView,
  type SyncRunFreshness,
} from "./view";

/** The user-scoped Supabase server client (RLS applies as the authoritative gate). */
export type SalesPipelineDb = Awaited<ReturnType<typeof createClient>>;

const SYNC_RUNS_TABLE = "pipedrive_sync_runs";

export interface SalesPipelineLoad {
  /** The display view model, or null when the mirror could not be read. */
  view: SalesPipelineView | null;
  /** The raw `DealsExport` (for the CSV/JSON export route), or null on read failure. */
  export: DealsExport | null;
  /** Human-readable reason the data is unavailable (pre-go-live / RLS / missing table). */
  dataError: string | null;
}

/**
 * Load the sales-pipeline export + freshness for `asOf` using the given RLS-scoped client.
 * Never throws: a mirror/table error is captured as `dataError` so callers can render an
 * "awaiting first sync" state rather than a 500.
 */
export async function loadSalesPipeline(
  db: SalesPipelineDb,
  asOf: Date,
): Promise<SalesPipelineLoad> {
  let exp: DealsExport;
  try {
    // Cast: the real Supabase client is structurally a MirrorSupabase (from().select()
    // resolves to { data, error }). The mirror read reconstructs deals from row.raw.
    exp = await buildDealsExportFromMirror(db as unknown as MirrorSupabase, { asOf });
  } catch (err) {
    return {
      view: null,
      export: null,
      dataError: err instanceof Error ? err.message : String(err),
    };
  }

  const syncRun = await readLatestSyncRun(db);
  return {
    view: buildSalesPipelineView(exp, syncRun),
    export: exp,
    dataError: null,
  };
}

/**
 * Latest sync-run row for the freshness line. Tolerant: any error (missing table pre
 * go-live, RLS) resolves to null freshness rather than failing the whole load.
 */
async function readLatestSyncRun(
  db: SalesPipelineDb,
): Promise<SyncRunFreshness | null> {
  try {
    const { data, error } = await db
      .from(SYNC_RUNS_TABLE)
      .select("started_at, finished_at, ok, open_deals, total_deals")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      started_at: string | null;
      finished_at: string | null;
      ok: boolean | null;
      open_deals: number | null;
      total_deals: number | null;
    };
    return {
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      ok: row.ok,
      openDeals: row.open_deals,
      totalDeals: row.total_deals,
    };
  } catch {
    return null;
  }
}
