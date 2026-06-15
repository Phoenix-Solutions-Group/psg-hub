-- Phase 13 / 13-03a — admit the GBP monthly presence + star-rating source.
-- 13-03b's monthly gbp-presence-sync writes period='monthly' analytics_snapshots rows with
-- source='gbp_presence' (Business Information location state + the v4 reviews lifetime
-- averageRating / totalReviewCount aggregate) and opens one analytics_sync_runs ledger row
-- with source='gbp_presence'. Both tables carry a source CHECK, so BOTH must learn
-- 'gbp_presence' or the monthly write / ledger insert fails on prod (the 12-05a/b lesson).
--
-- 'gbp_presence' is added to BOTH CHECKs, PRESERVING the full prior set (semrush, google_ads,
-- ga4, gsc, ga4_dimensions [12-05a], performance [12-05b], gbp [13-02a]) — the recreate must
-- list the complete set. Unlike 'gbp', 'gbp_presence' is point-in-time STOCK (a monthly
-- location-state + lifetime rating snapshot), so it stays a SnapshotSource-only value and is
-- NOT promoted into the AnalyticsSource TS union (forcing it in would fabricate a fake daily
-- rollup on STOCK data — RESEARCH §Data-model). This is the third and final CHECK-widening
-- migration for Phase 13.
--
-- AUTHORED ONLY — drop-and-recreate is idempotent and re-runnable, but this file is NOT applied
-- to prod here. Prod apply is the Phase-13 gate batch (13-04, PROTOCOL-migration-safety.md:
-- advisor baseline + diff), behind Google Gate A + Gate B. No data migration; the idempotency
-- key unique(shop_id, source, date, period) already accommodates a monthly gbp_presence row.

-- analytics_snapshots: keep the prior set, add 'gbp_presence', preserve the NULL allowance
-- (other writers of this inherited table may not set source).
alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_source_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_source_check
  check (
    source is null
    or source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance', 'gbp', 'gbp_presence'
    )
  );

-- analytics_sync_runs: source is NOT NULL here (every ledger row names its run).
-- Same auto-named-constraint note as 12-05a/b/13-02a: 20260605 declared this as an INLINE
-- column CHECK, so Postgres auto-named it. The drop assumes the standard `<table>_<column>_check`
-- name; this exact drop-if-exists path succeeded on prod in 12-05c and locally in 13-02a. VERIFY
-- at apply (`\d+ public.analytics_sync_runs`) that the CHECK is `analytics_sync_runs_source_check`,
-- then confirm a 'gbp_presence' ledger insert succeeds.
alter table public.analytics_sync_runs
  drop constraint if exists analytics_sync_runs_source_check;
alter table public.analytics_sync_runs
  add constraint analytics_sync_runs_source_check
  check (
    source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance', 'gbp', 'gbp_presence'
    )
  );
