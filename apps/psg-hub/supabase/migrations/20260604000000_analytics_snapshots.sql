-- Phase 9 / 09-01 — Analytics foundation.
-- GROUNDED REFRAME (2026-06-04): `public.analytics_snapshots` ALREADY EXISTS on
-- prod (captured in 20260602105554_remote_schema.sql) — shop_id + location_id +
-- date + metrics jsonb + created_at, 0 rows, and it ALREADY has the right RLS:
--   analytics_snapshots_select  USING (shop_id IN user_shop_ids())
--   analytics_snapshots_insert  WITH CHECK (shop_id IN user_shop_ids() AND
--                                           location_id IN user_location_ids())
-- So this is an EXTEND (06-04 reviews precedent; 0 rows = zero data risk), NOT a
-- create. Make it source-agnostic so every v0.3 source (semrush/google_ads/ga4/
-- gsc) + the Phase-12 report share one table: add `source` + `period` + an
-- idempotency key. Writes are service-role (RLS bypassed); the existing
-- membership-scoped policies stay untouched.
--
-- Idempotent + re-runnable. Applied LOCAL-only during build; prod apply is the
-- Phase-9 operator-gate batch (PROTOCOL-migration-safety.md, advisor baseline+diff).

alter table public.analytics_snapshots
  add column if not exists source text,
  add column if not exists period text,
  add column if not exists synced_at timestamptz not null default now();

-- 09-02 amendment (caught at E2E seed): the inherited table has location_id
-- NOT NULL, but the 09-01 source-agnostic design stores SHOP-level snapshots
-- (location_id null — types.ts + snapshots.ts already model it nullable; the
-- 09-01 migration missed implementing it). Location-granular rows remain
-- supported; nullability matches the documented design. 0 rows on prod = zero
-- data risk; the location-scoped INSERT policy half only applies to non-null
-- location writes (ingest is service-role anyway).
alter table public.analytics_snapshots
  alter column location_id drop not null;

-- Source/period are nullable (other writers of this inherited table may not set
-- them); our ingest always sets both. CHECK allows null OR a known value.
alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_source_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_source_check
  check (source is null or source in ('semrush', 'google_ads', 'ga4', 'gsc'));

alter table public.analytics_snapshots
  drop constraint if exists analytics_snapshots_period_check;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_period_check
  check (period is null or period in ('daily', 'monthly'));

-- Idempotency key for upsert(onConflict) — one row per (shop, source, date,
-- period). NULL source/period are distinct in a unique index, which is fine:
-- our ingest always supplies both, and legacy null-source rows don't collide.
create unique index if not exists analytics_snapshots_shop_source_date_period_key
  on public.analytics_snapshots (shop_id, source, date, period);

create index if not exists analytics_snapshots_shop_source_date_idx
  on public.analytics_snapshots (shop_id, source, date);
