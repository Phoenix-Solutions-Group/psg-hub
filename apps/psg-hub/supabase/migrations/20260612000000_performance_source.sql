-- Phase 12 / 12-05b — admit the website-performance ingest source.
-- The monthly perf-sync writes ONE period='monthly' analytics_snapshots row per url-bearing
-- shop with source='performance' and opens one analytics_sync_runs ledger row with
-- source='performance'. Both tables carry a source CHECK, so BOTH must learn 'performance'
-- or the monthly write / ledger insert fails on prod (the 12-05a lesson, handled in-plan here).
--
-- 'performance' is added to BOTH CHECKs, PRESERVING the 12-05a 'ga4_dimensions' value (the
-- recreate must list the full set). AnalyticsSource (the TS union) is untouched by design —
-- this is a DB/insert-layer source only (SnapshotSource), so the six exhaustive maps stay
-- unchanged (RESEARCH data-model).
--
-- AUTHORED ONLY — drop-and-recreate is idempotent and re-runnable, but this file is NOT applied
-- to prod here. Prod apply is the 12-05c operator gate batch (PROTOCOL-migration-safety.md:
-- advisor baseline + diff), alongside the 12-05a migration. No data migration; the idempotency
-- key unique(shop_id, source, date, period) already accommodates a monthly row at date=YYYY-MM-01.

-- analytics_snapshots: keep the four flat sources + 'ga4_dimensions' (12-05a), add 'performance',
-- preserve the NULL allowance (other writers of this inherited table may not set source).
alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_source_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_source_check
  check (
    source is null
    or source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance'
    )
  );

-- analytics_sync_runs: source is NOT NULL here (every ledger row names its run).
-- Same auto-named-constraint note as 12-05a: 20260605 declared this as an INLINE column CHECK,
-- so Postgres auto-named it. The drop assumes the standard `<table>_<column>_check` name; VERIFY
-- at apply (`\d+ public.analytics_sync_runs`) that the CHECK is `analytics_sync_runs_source_check`
-- before trusting the widen, then confirm a 'performance' ledger insert succeeds.
alter table public.analytics_sync_runs
  drop constraint if exists analytics_sync_runs_source_check;
alter table public.analytics_sync_runs
  add constraint analytics_sync_runs_source_check
  check (
    source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance'
    )
  );
