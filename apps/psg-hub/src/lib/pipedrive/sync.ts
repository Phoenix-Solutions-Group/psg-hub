// PSG-446 — Pipedrive deals sync (durable mirror ingestion, PSG-434).
// Fetches the live deal set via the typed client and UPSERTs it into
// `public.pipedrive_deals` (conflict target `deal_id`), then writes one
// `public.pipedrive_sync_runs` row recording health (ok / open_deals / total_deals /
// error). Uses the service-role client (bypasses RLS — ingestion is cross-tenant).
//
// Idempotent: UPSERT on the natural key means re-running converges the mirror to the
// live set; a run that fetches nothing leaves prior rows intact and logs ok=true,0.
// Both the client and the Supabase service handle are injected so the orchestration
// is unit-tested with no live token and no database.

import type { PipedriveClient } from "./client";
import { createPipedriveClient } from "./client";
import type { PipedriveDeal } from "./types";

/** Minimal shape of the service-role Supabase client this module needs. */
export interface SyncSupabase {
  from(table: string): {
    upsert(
      rows: Record<string, unknown>[],
      options?: { onConflict?: string },
    ): Promise<{ error: { message: string } | null }>;
    insert(
      rows: Record<string, unknown>[],
    ): Promise<{ error: { message: string } | null }>;
  };
}

export interface SyncDeps {
  client?: PipedriveClient;
  service: SyncSupabase;
  /** Pull won/lost updated on/after this ISO date for churn/YoY (default: skip). */
  closedUpdatedSince?: string;
  /** Injectable timestamp for the run log + synced_at (deterministic in tests). */
  now?: () => Date;
}

export interface SyncResult {
  ok: boolean;
  openDeals: number;
  totalDeals: number;
  error?: string;
}

const DEALS_TABLE = "pipedrive_deals";
const RUNS_TABLE = "pipedrive_sync_runs";

/** Map a mirrored deal onto the `pipedrive_deals` column shape (snake_case). */
export function toDealRow(
  deal: PipedriveDeal,
  syncedAt: string,
): Record<string, unknown> {
  return {
    deal_id: deal.dealId,
    title: deal.title,
    value: deal.value,
    currency: deal.currency,
    status: deal.status,
    pipeline_id: deal.pipelineId,
    stage_id: deal.stageId,
    stage_name: deal.stageName,
    win_probability: deal.winProbability,
    org_id: deal.orgId,
    org_name: deal.orgName,
    person_id: deal.personId,
    owner_id: deal.ownerId,
    owner_name: deal.ownerName,
    expected_close_date: deal.expectedCloseDate,
    close_date: deal.closeDate,
    last_activity_date: deal.lastActivityDate,
    raw: deal,
    synced_at: syncedAt,
  };
}

/**
 * Run one sync: fetch → UPSERT → log. Never throws for an expected failure (a fetch
 * or DB error is captured into the run log and returned as `ok:false`); the run-log
 * write itself is best-effort.
 */
export async function syncPipedriveDeals(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const client = deps.client ?? createPipedriveClient();

  let openCount = 0;
  let totalCount = 0;
  let ok = false;
  let error: string | undefined;

  try {
    const open = await client.fetchOpenDeals();
    const closed = deps.closedUpdatedSince
      ? [
          ...(await client.fetchDealsByStatus("won", deps.closedUpdatedSince)),
          ...(await client.fetchDealsByStatus("lost", deps.closedUpdatedSince)),
        ]
      : [];

    // De-dupe by deal_id (a deal could appear in more than one pull); last wins.
    const byId = new Map<number, PipedriveDeal>();
    for (const d of [...open, ...closed]) byId.set(d.dealId, d);
    const deals = [...byId.values()];

    openCount = open.length;
    totalCount = deals.length;

    if (deals.length > 0) {
      const syncedAt = now().toISOString();
      const rows = deals.map((d) => toDealRow(d, syncedAt));
      const { error: upsertError } = await deps.service
        .from(DEALS_TABLE)
        .upsert(rows, { onConflict: "deal_id" });
      if (upsertError) throw new Error(upsertError.message);
    }
    ok = true;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  // Best-effort run-log write — a logging failure must not mask the sync result.
  try {
    await deps.service.from(RUNS_TABLE).insert([
      {
        started_at: startedAt.toISOString(),
        finished_at: now().toISOString(),
        ok,
        open_deals: openCount,
        total_deals: totalCount,
        error: error ?? null,
      },
    ]);
  } catch {
    // swallow — the SyncResult is the source of truth for the caller.
  }

  return { ok, openDeals: openCount, totalDeals: totalCount, error };
}
