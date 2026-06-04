import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyticsSnapshot,
  AnalyticsSnapshotInsert,
  AnalyticsSource,
  AnalyticsPeriod,
} from "./types";

const TABLE = "analytics_snapshots";

/**
 * Idempotent upsert of analytics snapshots. MUST be called with a service-role
 * client — `analytics_snapshots` has no INSERT/UPDATE RLS policy (writes are
 * service-role only). Conflicts on the (shop_id, source, metric_date, period)
 * idempotency key, so re-running an ingest nets zero new rows. Returns the
 * number of rows written. Throws on error (no bare catch — resilience constraint).
 */
export async function upsertSnapshots(
  service: SupabaseClient,
  rows: AnalyticsSnapshotInsert[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await service
    .from(TABLE)
    .upsert(rows, {
      onConflict: "shop_id,source,date,period",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`upsertSnapshots failed: ${error.message}`);
  }
  return rows.length;
}

export type GetSnapshotsArgs = {
  shopId: string;
  source: AnalyticsSource;
  period: AnalyticsPeriod;
  /** inclusive ISO date (YYYY-MM-DD) */
  from: string;
  /** inclusive ISO date (YYYY-MM-DD) */
  to: string;
};

/**
 * Read snapshots for one shop + source + period over a date range. Call with the
 * REQUEST's user-session client so RLS clamps the read to authorized shops
 * (`shop_id IN user_shop_ids()`) — never the service client for a customer read.
 * Returns [] for a no-data shop (never throws on empty); throws on a real error.
 */
export async function getSnapshots(
  client: SupabaseClient,
  { shopId, source, period, from, to }: GetSnapshotsArgs
): Promise<AnalyticsSnapshot[]> {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("shop_id", shopId)
    .eq("source", source)
    .eq("period", period)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`getSnapshots failed: ${error.message}`);
  }
  return (data ?? []) as AnalyticsSnapshot[];
}
