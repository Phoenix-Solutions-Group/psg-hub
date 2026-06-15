-- Phase 13 / 13-02a — admit the GBP daily-insights ingest source.
-- 13-02b's daily gbp-sync writes period='daily' analytics_snapshots rows with source='gbp'
-- (Performance API action counts) and opens one analytics_sync_runs ledger row with
-- source='gbp'. Both tables carry a source CHECK, so BOTH must learn 'gbp' or the daily
-- write / ledger insert fails on prod (the 12-05a/b lesson, handled in-plan here).
--
-- 'gbp' is added to BOTH CHECKs, PRESERVING the full prior set (the 12-05a 'ga4_dimensions'
-- and 12-05b 'performance' values — the recreate must list the complete set). Unlike those
-- two SnapshotSource-only values, 'gbp' IS promoted into the AnalyticsSource TS union (it is
-- daily FLOW, summable — RESEARCH §Data-model), so it earns the panel/report/rollup; that
-- TS promotion is 13-02a Task 2, separate from this DB migration.
--
-- NOT added here: 'gbp_presence' (monthly point-in-time STOCK presence + star rating). It is
-- 13-03's SnapshotSource-only value and lands in 13-03's own migration. Adding it now would
-- pre-admit an unused source ahead of its ingest.
--
-- AUTHORED ONLY — drop-and-recreate is idempotent and re-runnable, but this file is NOT applied
-- to prod here. Prod apply is the Phase-13 gate batch (13-04, PROTOCOL-migration-safety.md:
-- advisor baseline + diff), behind Google Gate A + Gate B. No data migration; the idempotency
-- key unique(shop_id, source, date, period) already accommodates a daily gbp row.

-- analytics_snapshots: keep the four flat sources + 'ga4_dimensions' (12-05a) + 'performance'
-- (12-05b), add 'gbp', preserve the NULL allowance (other writers of this inherited table may
-- not set source).
alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_source_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_source_check
  check (
    source is null
    or source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance', 'gbp'
    )
  );

-- analytics_sync_runs: source is NOT NULL here (every ledger row names its run).
-- Same auto-named-constraint note as 12-05a/b: 20260605 declared this as an INLINE column
-- CHECK, so Postgres auto-named it. The drop assumes the standard `<table>_<column>_check`
-- name; VERIFY at apply (`\d+ public.analytics_sync_runs`) that the CHECK is
-- `analytics_sync_runs_source_check` before trusting the widen (this exact drop-if-exists path
-- succeeded on prod in 12-05c), then confirm a 'gbp' ledger insert succeeds.
alter table public.analytics_sync_runs
  drop constraint if exists analytics_sync_runs_source_check;
alter table public.analytics_sync_runs
  add constraint analytics_sync_runs_source_check
  check (
    source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance', 'gbp'
    )
  );
