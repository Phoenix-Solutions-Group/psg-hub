// PSG-446 (TODO #4) — Durable mirror READ path: `public.pipedrive_deals` → export.
// The sync (sync.ts) WRITES the mirror; this is the read side the report/cron consumes.
// Reads the mirror table → reconstructs `PipedriveDeal[]` → feeds `buildDealsExport`.
//
// CRITICAL (Tess's QA round-trip assert, PSG-447): reconstruct each deal by returning
// `row.raw as PipedriveDeal`, NOT a column-by-column rebuild. Only `revenue_type` is
// promoted to its own column; every other non-promoted field — notably `monthlyValue`
// (the normalized monthly MRR basis John nets in §2.1) — lives ONLY inside the `raw`
// jsonb. A column rebuild would silently drop `monthlyValue → null` on every mirror-read
// export and quietly break the MRR tie-out. So we trust `raw` as the source of truth.
//
// RLS: this helper is client-agnostic by design (mirrors src/lib/ccc/account-store.ts).
// The CALLER chooses the Supabase handle and the row-level policy does the gating:
//   • cron / ingestion / reporting job → service-role client (RLS bypassed);
//   • a user-facing read → that user's client, subject to the `view_sales_pipeline`
//     SELECT policy on `public.pipedrive_deals` (default-deny otherwise).
// The query is identical either way; only the injected client differs.

import { buildDealsExport, type DealsExport, type DealsExportOptions } from "./export";
import type { PipedriveDeal } from "./types";

const DEALS_TABLE = "pipedrive_deals";
// We only need `raw` (it carries EVERY field, promoted or not) plus `deal_id` for a
// stable order + diagnostics. We deliberately do NOT select the promoted columns: `raw`
// is the reconstruction source, and pulling columns would invite an accidental rebuild.
const MIRROR_COLUMNS = "deal_id, raw";

/** One mirror row as this read path needs it. `raw` is the full `PipedriveDeal` payload. */
export interface MirrorDealRow {
  deal_id: number;
  /** Full deal payload written by the sync (`toDealRow`'s `raw`); null if absent/corrupt. */
  raw: PipedriveDeal | null;
}

/**
 * Minimal read seam over the mirror table — just `.from(table).select(columns)` resolving
 * to `{ data, error }` (the awaitable PostgrestFilterBuilder shape). Injected so this is
 * unit-tested with an in-memory fake; in production it's a real `SupabaseClient` (service-
 * role for cron, or a `view_sales_pipeline`-gated user client).
 */
export interface MirrorSupabase {
  from(table: string): {
    select(columns: string): Promise<{
      data: MirrorDealRow[] | null;
      error: { message: string } | null;
    }>;
  };
}

/**
 * Read the durable mirror → `PipedriveDeal[]`. Reconstructs each deal from `row.raw`
 * (see file header: NEVER a column rebuild). Rows with a null/missing `raw` can't be
 * reconstructed faithfully and are skipped rather than silently emitting a lossy deal.
 */
export async function readMirrorDeals(db: MirrorSupabase): Promise<PipedriveDeal[]> {
  const { data, error } = await db.from(DEALS_TABLE).select(MIRROR_COLUMNS);
  if (error) {
    throw new Error(`pipedrive mirror read failed: ${error.message}`);
  }
  const deals: PipedriveDeal[] = [];
  for (const row of data ?? []) {
    // CRITICAL: trust the jsonb payload verbatim. `monthlyValue` and any other
    // non-promoted field exist ONLY here; a column rebuild would drop them.
    if (row.raw == null) continue;
    deals.push(row.raw as PipedriveDeal);
  }
  return deals;
}

/**
 * The durable read path the report/cron consumes: mirror → `PipedriveDeal[]` → export.
 * Pass the appropriate Supabase client (service-role or `view_sales_pipeline`-gated) and
 * the same `DealsExportOptions` the pure `buildDealsExport` takes (`asOf`, reconcile
 * window, revenue-type field key, etc.).
 */
export async function buildDealsExportFromMirror(
  db: MirrorSupabase,
  opts: DealsExportOptions,
): Promise<DealsExport> {
  const deals = await readMirrorDeals(db);
  return buildDealsExport(deals, opts);
}
