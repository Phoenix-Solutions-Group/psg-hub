-- PSG-1709 — Google Ads metrics import fallback ledger.
--
-- Direct Google Ads API linking can lag customer onboarding. This ledger records
-- manual/export imports with a caller-supplied idempotency key so replaying the
-- same batch is visible and does not duplicate dashboard snapshots. The imported
-- metrics still land in public.analytics_snapshots under source='google_ads',
-- preserving the existing shop-scoped customer read path.
--
-- Service-role-only by design: RLS enabled with NO policy. Customers read only
-- the resulting analytics_snapshots rows through the existing
-- analytics_snapshots_select policy (shop_id IN user_shop_ids()).

create table if not exists public.google_ads_import_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source text not null default 'google_ads_import',
  status text not null check (status in ('running', 'success', 'error')),
  rows_received integer not null default 0,
  rows_written integer not null default 0,
  rows_skipped integer not null default 0,
  error text,
  imported_by_profile_id uuid references public.profiles (id) on delete set null,
  imported_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists google_ads_import_batches_imported_at_idx
  on public.google_ads_import_batches (imported_at desc);

alter table public.google_ads_import_batches enable row level security;
