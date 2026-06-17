// Phase 9 / 09-01 — Analytics foundation types.
// Source-agnostic snapshot model: one row per (shop, source, metric_date, period),
// with source-specific metrics in the `metrics` jsonb. Per-source shapes documented here.

export type AnalyticsSource = "semrush" | "google_ads" | "ga4" | "gsc" | "gbp";
export type AnalyticsPeriod = "daily" | "monthly";

/**
 * Insert/storage-layer source key (Phase 12 / 12-05). SUPERSET of AnalyticsSource:
 * the GA4 dimensional ingest and (12-05b) performance ingest write monthly rows
 * under their own DB source values WITHOUT joining the four-source AnalyticsSource
 * union (which drives six exhaustive maps — render/rollup/report-data/prompt/schema/
 * SourceReportBlock; RESEARCH data-model section keeps it at four). These extra
 * sources live ONLY on the write/read path of analytics_snapshots + the ledger.
 */
export type SnapshotSource =
  | AnalyticsSource
  | "ga4_dimensions"
  | "performance"
  | "gbp_presence";

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

/**
 * Insert/upsert shape — id/synced_at/created_at default server-side. `source` is the
 * insert-layer SnapshotSource (superset of AnalyticsSource) so the monthly ga4_dimensions
 * / performance ingests upsert under their own source value; the daily callers pass an
 * AnalyticsSource, which is assignable (subset), so they stay type-valid unchanged.
 */
export type AnalyticsSnapshotInsert = {
  shop_id: string;
  location_id?: string | null;
  source: SnapshotSource;
  date: string;
  period: AnalyticsPeriod;
  metrics: Record<string, unknown>;
};

/**
 * A stored monthly snapshot whose `source` may be an extended SnapshotSource (e.g.
 * 'ga4_dimensions'). Used by the report's monthly reader path, which never enters the
 * four-source rollup; keeps AnalyticsSnapshot.source pinned to the AnalyticsSource union.
 */
export type MonthlySnapshotRow = Omit<AnalyticsSnapshot, "source"> & {
  source: SnapshotSource;
};

/**
 * One row of a GA4 secondary-dimension breakdown — Phase 12 / 12-05a. `users` is
 * totalUsers for the bucket; `engagement_rate` (0..1) is captured per row where the
 * section surfaces it (landing pages) and is ABSENT on the synthetic '(other)'
 * remainder row (a ratio cannot be summed). `sessions` is the reconciling metric: the
 * top-N rows plus '(other)' always sum to the dimension's month total.
 */
export type Ga4DimensionRow = {
  name: string;
  sessions: number;
  users: number;
  engagement_rate?: number; // 0..1 ratio — per row, omitted on '(other)'
};

/**
 * GA4 dimensional `metrics` jsonb shape — Phase 12 / 12-05a. Stored as ONE
 * period='monthly' analytics_snapshots row per (shop, 'ga4_dimensions', YYYY-MM-01).
 * Each array is top-N-by-sessions + a reconciling '(other)' row. `averageSessionDuration`
 * is the sessions-weighted month aggregate (GA4 metricAggregations TOTAL), in SECONDS —
 * a ratio-like average, aggregate-EXCLUDED (same class as engagement_rate). bounce_rate
 * is NOT stored: it is derived at report time as 1 - the monthly engagement_rate.
 */
export type Ga4DimensionsMetrics = {
  topChannels: Ga4DimensionRow[];
  topLandingPages: Ga4DimensionRow[];
  devices: Ga4DimensionRow[];
  newVsReturning: Ga4DimensionRow[];
  averageSessionDuration: number; // seconds — aggregate-excluded
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

/**
 * GSC search-performance `metrics` shape — Phase 11 / 11-03. One row per (shop, date)
 * site-level daily total from a single searchanalytics.query (dimensions=['date']).
 * NOTE: BOTH ctr (0..1) and position (average rank) are RATIOS/averages — never
 * surface either from a cross-shop aggregate (a summed ratio lies; the page excludes
 * both from the MSO KPIs, like engagement_rate/cpl/authority_score). clicks and
 * impressions sum honestly.
 */
export type GscMetrics = {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1 ratio — aggregate-excluded
  position: number; // average position — aggregate-excluded
};

/**
 * GBP local-presence `metrics` shape — Phase 13 / 13-02. One row per (shop, date)
 * location-level daily total from a single Business Profile Performance API
 * fetchMultiDailyMetricsTimeSeries call (RESEARCH §Presence insights). Every field is
 * a FLOW action/impression count that sums honestly across the month and across shops —
 * there is NO ratio/average here, so (unlike ga4 engagement_rate / gsc ctr+position /
 * ads cpl) NOTHING is aggregate-excluded from the MSO KPIs. impressions_total is the
 * per-day sum of the four impression splits, DERIVED at ingest by 13-02b's parser (it
 * is NOT a Performance API DailyMetric enum value — sending it as a metric 400s). The
 * eight enum-backed counts map from BUSINESS_IMPRESSIONS_DESKTOP_MAPS / _DESKTOP_SEARCH /
 * _MOBILE_MAPS / _MOBILE_SEARCH, BUSINESS_CONVERSATIONS, BUSINESS_DIRECTION_REQUESTS,
 * CALL_CLICKS, WEBSITE_CLICKS. (BOOKINGS / FOOD_ORDERS / FOOD_MENU_CLICKS are N/A for
 * collision repair and intentionally not wired.) NOTE: impressions are de-duplicated per
 * unique user per day, so a monthly sum is an upper bound, not unique visitors.
 */
export type GbpMetrics = {
  impressions_desktop_maps: number;
  impressions_desktop_search: number;
  impressions_mobile_maps: number;
  impressions_mobile_search: number;
  impressions_total: number; // derived-at-ingest: sum of the four impression splits
  website_clicks: number;
  call_clicks: number;
  direction_requests: number;
  conversations: number;
};

/**
 * GBP monthly presence + star-rating `metrics` shape — Phase 13 / 13-03. Stored as ONE
 * period='monthly' analytics_snapshots row per (shop, 'gbp_presence', YYYY-MM-01), read via
 * getMonthlySnapshot. Point-in-time STOCK (a snapshot of the listing's current state + the
 * location's LIFETIME review aggregate), NEVER rolled up and NEVER in the AnalyticsSource union —
 * it is a SnapshotSource-only value (the same class as 'performance' / 'ga4_dimensions'). The
 * presence fields come from the Business Information v1 location state (13-03b); the rating pair
 * comes from the legacy v4 reviews aggregate (`ListReviewsResponse.averageRating` /
 * `totalReviewCount`, 13-03-RESEARCH §Aggregate). average_rating is the LIFETIME mean (scale 1-5),
 * NOT a month window. BOTH rating fields are nullable: a shop with no reviews has no average, and
 * the monthly orchestrator writes the presence row even when the v4 call fails or the location is
 * unverified (so a missing rating stays null, never a false 0).
 */
export type GbpPresenceMetrics = {
  open_status: string; // openInfo.status: OPEN | CLOSED_PERMANENTLY | CLOSED_TEMPORARILY
  primary_category: string | null;
  categories: string[];
  has_hours: boolean;
  website_uri: string | null;
  has_description: boolean;
  phone_present: boolean;
  completeness_score?: number; // optional derived 0-100 listing-completeness
  maps_uri?: string | null; // metadata.mapsUri — the public Google Maps listing link (per-location)
  average_rating: number | null; // v4 reviews lifetime mean (1-5), null when no reviews / unavailable
  total_review_count: number | null; // v4 reviews total, null when unavailable
};

/**
 * CrUX real-user FIELD metrics for a page/origin — Phase 12 / 12-05b. Parsed from the
 * PSI response's `loadingExperience` (URL) or `originLoadingExperience` (origin) — best-effort,
 * each field null when its CrUX key is absent (low-traffic origins miss the popularity
 * threshold entirely). All are point-in-time STOCK / ratio-like, aggregate-EXCLUDED.
 */
export type PsiFieldMetrics = {
  lcp_ms: number | null; // LARGEST_CONTENTFUL_PAINT_MS percentile (ms)
  inp_ms: number | null; // INTERACTION_TO_NEXT_PAINT percentile (ms, no _MS suffix in the key)
  cls: number | null; // CUMULATIVE_LAYOUT_SHIFT_SCORE percentile, integer ×100 -> real value
  fcp_ms: number | null; // FIRST_CONTENTFUL_PAINT_MS percentile (ms)
  ttfb_ms: number | null; // EXPERIMENTAL_TIME_TO_FIRST_BYTE percentile (ms)
  overall_category: string | null; // 'FAST' | 'AVERAGE' | 'SLOW'
};

/**
 * PSI (PageSpeed Insights v5) result — Phase 12 / 12-05b. `lighthouseResult` LAB is always
 * present; `field` (CrUX, from the same PSI call's loadingExperience/originLoadingExperience)
 * is null when CrUX has no data (the collision-shop default). `perf_score` is 0..100
 * (categories.performance.score ×100). All point-in-time STOCK — never rolled up.
 */
export type PsiResult = {
  perf_score: number | null; // 0..100
  lab_lcp_ms: number | null;
  lab_cls: number | null;
  lab_tbt_ms: number | null;
  lab_fcp_ms: number | null;
  lab_speed_index_ms: number | null;
  lab_ttfb_ms: number | null; // server-response-time audit
  field: PsiFieldMetrics | null; // CrUX, render-if-present
  origin_field: boolean; // true when field came from the origin fallback
};

/**
 * GTMetrix report fields (API v2.0 `/reports/{id}` data.attributes) — Phase 12 / 12-05b.
 * Optional enrichment beyond PSI (page weight, request count, backend_duration, grade). null
 * fields where the report omits them. `gtmetrix_grade` is a letter; the rest are numeric.
 */
export type GtmetrixResult = {
  fully_loaded_time: number | null;
  onload_time: number | null;
  time_to_first_byte: number | null;
  backend_duration: number | null;
  page_bytes: number | null;
  html_bytes: number | null;
  page_requests: number | null;
  redirect_duration: number | null;
  connect_duration: number | null;
  largest_contentful_paint: number | null;
  total_blocking_time: number | null;
  cumulative_layout_shift: number | null;
  speed_index: number | null;
  time_to_interactive: number | null;
  gtmetrix_grade: string | null;
  gtmetrix_score: number | null;
  performance_score: number | null;
  structure_score: number | null;
};

/**
 * Website-performance `metrics` jsonb shape — Phase 12 / 12-05b. Stored as ONE
 * period='monthly' analytics_snapshots row per (shop, 'performance', YYYY-MM-01). PSI is the
 * always-present floor; gtmetrix is null when its key is unset or the shop is out of GTMetrix
 * scope. Point-in-time STOCK — read on a separate path, NEVER enters METRIC_REGISTRY/rollupMonth.
 */
export type PerformanceMetrics = {
  psi: PsiResult;
  gtmetrix: GtmetrixResult | null;
  strategy: "mobile";
  tested_url: string;
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
