import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyticsSnapshot,
  AnalyticsSnapshotInsert,
  AnalyticsSource,
  AnalyticsPeriod,
  SnapshotSource,
  MonthlySnapshotRow,
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

/**
 * Read snapshots across MANY shops (MSO aggregate view). Same contract as
 * getSnapshots but clamps with an EXPLICIT membership-derived id list
 * (`.in("shop_id", shopIds)`) — defense in depth on top of the RLS backstop
 * (`shop_id IN user_shop_ids()`), mirroring the `.eq(shop_id)` page pattern.
 * Call with the request's user-session client. [] on empty input or no data.
 */
export async function getSnapshotsForShops(
  client: SupabaseClient,
  {
    shopIds,
    source,
    period,
    from,
    to,
  }: Omit<GetSnapshotsArgs, "shopId"> & { shopIds: string[] }
): Promise<AnalyticsSnapshot[]> {
  if (shopIds.length === 0) return [];

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .in("shop_id", shopIds)
    .eq("source", source)
    .eq("period", period)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`getSnapshotsForShops failed: ${error.message}`);
  }
  return (data ?? []) as AnalyticsSnapshot[];
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

export type GetMonthlySnapshotArgs = {
  shopId: string;
  /** SnapshotSource superset — admits the monthly-only 'ga4_dimensions' / 'performance'. */
  source: SnapshotSource;
  /** Report month 'YYYY-MM'; the stored row's date is `${month}-01`. */
  month: string;
};

/**
 * Read the ONE period='monthly' snapshot row for a shop + extended source + month
 * (Phase 12 / 12-05c). Distinct from getSnapshots because the monthly sources
 * ('ga4_dimensions', 'performance') are deliberately NOT in the four-value
 * AnalyticsSource union getSnapshots is typed to — they are insert-layer
 * SnapshotSources. Returns null for no row (never throws on empty); throws on a real
 * error. Bound by the print route to assembleReportData's optional monthly readers.
 */
export async function getMonthlySnapshot(
  client: SupabaseClient,
  { shopId, source, month }: GetMonthlySnapshotArgs
): Promise<MonthlySnapshotRow | null> {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("shop_id", shopId)
    .eq("source", source)
    .eq("period", "monthly")
    .eq("date", `${month}-01`)
    .maybeSingle();

  if (error) {
    throw new Error(`getMonthlySnapshot failed: ${error.message}`);
  }
  return (data as MonthlySnapshotRow) ?? null;
}

/**
 * Read the LATEST period='monthly' snapshot row for a shop + extended source (Phase 13
 * / 13-03b). Orders date desc + limit 1 so the dashboard presence header survives the
 * cron-timing / month-boundary blank a fixed-month read would show (the row lands at
 * {prior-month}-01, not the current month). Returns null for no row (never throws on
 * empty); throws on a real error. Call with the REQUEST's user-session client so RLS
 * clamps the read; per-shop only (an MSO cross-shop rating average is a lie).
 */
export async function getLatestMonthlySnapshot(
  client: SupabaseClient,
  { shopId, source }: { shopId: string; source: SnapshotSource }
): Promise<MonthlySnapshotRow | null> {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("shop_id", shopId)
    .eq("source", source)
    .eq("period", "monthly")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`getLatestMonthlySnapshot failed: ${error.message}`);
  }
  return (data as MonthlySnapshotRow) ?? null;
}
