-- Phase 12 / 12-05a — admit the GA4 dimensional ingest source.
-- The monthly GA4 secondary-dimension ingest writes ONE period='monthly'
-- analytics_snapshots row per (shop, 'ga4_dimensions', YYYY-MM-01) and opens one
-- analytics_sync_runs ledger row with source='ga4_dimensions'. Both tables carry a
-- source CHECK that currently admits only the four flat sources, so BOTH must learn
-- the new value or the monthly write/ledger insert fails on prod.
--
-- 'ga4_dimensions' is added to BOTH CHECKs here (12-05a). 'performance' (12-05b) is
-- deliberately NOT added yet — its migration ships with that plan. AnalyticsSource
-- (the TS union) is untouched by design; this is a DB/insert-layer source only
-- (SnapshotSource), so the six exhaustive maps stay unchanged (RESEARCH data-model).
--
-- AUTHORED ONLY — drop-and-recreate is idempotent and re-runnable, but this file is
-- NOT applied to prod here. Prod apply happens at the 12-05c operator gate batch
-- (PROTOCOL-migration-safety.md: advisor baseline + diff). No data migration; the
-- idempotency key unique(shop_id, source, date, period) already accommodates a
-- monthly row at date=YYYY-MM-01 with no key change.

-- analytics_snapshots: keep the four flat sources, add 'ga4_dimensions', preserve the
-- NULL allowance (other writers of this inherited table may not set source).
alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_source_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_source_check
  check (
    source is null
    or source in ('semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions')
  );

-- analytics_sync_runs: source is NOT NULL here (every ledger row names its run).
-- NOTE for the 12-05c apply: 20260605 declared this as an INLINE column CHECK
-- (`source text not null check (...)`), so Postgres AUTO-NAMED it. The drop below
-- assumes the standard single-column name `<table>_<column>_check`. That naming is
-- deterministic for a column-level constraint, but it cannot be eyeballed from the SQL
-- — VERIFY at apply: `\d+ public.analytics_sync_runs` (or query pg_constraint) shows a
-- CHECK named `analytics_sync_runs_source_check`. If the live name differs, the
-- IF-EXISTS drop silently no-ops and the OLD four-value constraint keeps rejecting
-- 'ga4_dimensions'. Confirm the ledger insert + a snapshots insert both accept
-- 'ga4_dimensions' post-apply before the live dims-sync smoke.
alter table public.analytics_sync_runs
  drop constraint if exists analytics_sync_runs_source_check;
alter table public.analytics_sync_runs
  add constraint analytics_sync_runs_source_check
  check (source in ('semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions'));
