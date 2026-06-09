// Phase 9 / 09-01 — Analytics foundation types.
// Source-agnostic snapshot model: one row per (shop, source, metric_date, period),
// with source-specific metrics in the `metrics` jsonb. Per-source shapes documented here.

export type AnalyticsSource = "semrush" | "google_ads" | "ga4" | "gsc";
export type AnalyticsPeriod = "daily" | "monthly";

/**
 * A stored analytics snapshot row (public.analytics_snapshots).
 * Column names match the inherited table (extended in 09-01): the date column is
 * `date`; `location_id` is nullable (shop-level snapshots leave it null).
 */
export type AnalyticsSnapshot = {
  id: string;
  shop_id: string;
  location_id: string | null;
  source: AnalyticsSource;
  date: string; // ISO date (YYYY-MM-DD)
  period: AnalyticsPeriod;
  metrics: Record<string, unknown>;
  synced_at: string;
  created_at: string;
};

/** Insert/upsert shape — id/synced_at/created_at default server-side. */
export type AnalyticsSnapshotInsert = {
  shop_id: string;
  location_id?: string | null;
  source: AnalyticsSource;
  date: string;
  period: AnalyticsPeriod;
  metrics: Record<string, unknown>;
};

/**
 * First documented `metrics` shape — SEMrush organic-SEO (Phase 9 / 09-03).
 * Stored in `metrics` jsonb so adding sources never changes the schema.
 * Later sources (google_ads, ga4, gsc) document their own shapes alongside this.
 */
export type SemrushMetrics = {
  organic_keywords: number;
  organic_traffic: number;
  organic_traffic_cost: number; // USD
  backlinks: number;
  authority_score: number; // 0-100
  position_distribution?: {
    top3?: number;
    top10?: number;
    top20?: number;
    top100?: number;
  };
};

/**
 * Google Ads paid-marketing `metrics` shape — Phase 10 / 10-02. One row per
 * (shop, date) account-level daily total. `spend = cost_micros / 1_000_000`;
 * `cpl = spend / conversions` (null on zero conversions — true "no data", not a
 * real 0). `cost_micros` retained raw for audit. NOTE: cpl is a RATIO — never
 * surface it from a cross-shop aggregate (a summed ratio lies; the page excludes
 * it from the MSO KPIs, mirroring authority_score).
 */
export type GoogleAdsMetrics = {
  spend: number; // USD
  clicks: number; // INT64
  impressions: number; // INT64
  conversions: number; // DOUBLE (can be fractional)
  cpl: number | null; // spend / conversions, null when conversions = 0
  cost_micros: number; // raw, for audit
};

/**
 * GA4 website-traffic `metrics` shape — Phase 11 / 11-02. One row per (shop, date)
 * account-level daily total from a single runReport (dimensions=[date]). `key_events`
 * is the 2024 conversions rename (NOT the deprecated `conversions`). NOTE:
 * engagement_rate is a RATIO (0..1) — never surface it from a cross-shop aggregate
 * (a summed ratio lies; the page excludes it from the MSO KPIs, like cpl/authority_score).
 */
export type Ga4Metrics = {
  sessions: number;
  total_users: number;
  active_users: number;
  new_users: number;
  engaged_sessions: number;
  key_events: number; // conversions (keyEvents — the 2024 rename)
  engagement_rate: number; // 0..1 ratio — aggregate-excluded
};

/** Ingest audit ledger row (public.analytics_sync_runs). */
export type AnalyticsSyncRun = {
  id: string;
  shop_id: string | null;
  source: AnalyticsSource;
  status: "running" | "success" | "error";
  rows_written: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
