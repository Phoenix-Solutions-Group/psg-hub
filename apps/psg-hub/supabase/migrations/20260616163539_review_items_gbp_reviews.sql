-- Phase 14 / 14-01 — per-review GBP ingest dedupe key + 'gbp_reviews' sync source.
-- 14-01's gbp-reviews-sync writes per-review rows into review_items (legacy v4
-- accounts.locations.reviews.list) and opens one analytics_sync_runs ledger row with
-- source='gbp_reviews'. Two additive changes, both idempotent + re-runnable:
--   1. review_items gains external_review_id (the v4 review resource name = the stable
--      per-review id) + updated_at (the v4 updateTime), plus UNIQUE(shop_id,
--      external_review_id) so the cron/on-demand ingest upserts idempotently
--      (onConflict). Mirrors the google_ads `unique(shop_id, external_id)` precedent.
--      The column is nullable: existing Places/Yelp rows keep NULL and never collide
--      (Postgres treats NULLs as DISTINCT in a unique index), and only gbp rows carry
--      a non-null key.
--   2. analytics_sync_runs source CHECK widened to admit 'gbp_reviews', PRESERVING the
--      full prior set (semrush, google_ads, ga4, gsc, ga4_dimensions, performance, gbp,
--      gbp_presence). analytics_snapshots is NOT touched — reviews land in review_items,
--      not analytics_snapshots, so no snapshot source is added.
--
-- AUTO-NAMED-CONSTRAINT TRAP (the 12-05a/b / 13-02a / 13-03a lesson): 20260605 declared
-- the analytics_sync_runs source CHECK as an INLINE column constraint, so Postgres
-- auto-named it; a `drop constraint if exists analytics_sync_runs_source_check` no-ops
-- silently if the live name differs. Prior migrations recreated it under the standard
-- name, but rather than ASSUME that held, this migration resolves + drops whatever CHECK
-- constrains `source` by its LIVE name (pg_constraint), then re-adds the standard-named
-- one. Verified on a local db reset.
--
-- AUTHORED ONLY — idempotent + re-runnable, but NOT applied to prod here. Prod apply is
-- the Phase-14 gate batch (mirrors 13-04, PROTOCOL-migration-safety.md: advisor baseline
-- + diff), behind Google Gate A + Gate B. ZERO data written.

-- 1. review_items: per-review dedupe key + updateTime.
alter table public.review_items
  add column if not exists external_review_id text,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_items'::regclass
      and conname = 'review_items_shop_external_review_key'
  ) then
    alter table public.review_items
      add constraint review_items_shop_external_review_key
      unique (shop_id, external_review_id);
  end if;
end$$;

-- 2. analytics_sync_runs: admit 'gbp_reviews'. Drop the LIVE-named source CHECK (resolve
-- via pg_constraint, never assume the auto-name), then re-add under the standard name.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'analytics_sync_runs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format(
      'alter table public.analytics_sync_runs drop constraint %I', cname
    );
  end loop;
end$$;

alter table public.analytics_sync_runs
  add constraint analytics_sync_runs_source_check
  check (
    source in (
      'semrush', 'google_ads', 'ga4', 'gsc', 'ga4_dimensions', 'performance',
      'gbp', 'gbp_presence', 'gbp_reviews'
    )
  );
