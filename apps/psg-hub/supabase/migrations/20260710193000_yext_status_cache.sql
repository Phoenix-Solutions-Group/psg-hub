-- PSG-1080 — Yext listings + review status cache.
--
-- Purpose: read-only Yext export/import storage for BSM shops. The first client
-- batch can be mapped by shop_id -> Yext entity/account without storing API keys
-- or customer secrets in Postgres. Writes are service-role only through an
-- ops-gated import route; customer reads are clamped by shop membership RLS.

create table if not exists public.yext_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  yext_account_id text,
  yext_entity_id text not null,
  status text not null default 'mapped'
    check (status in ('mapped', 'active', 'inactive', 'error')),
  api_key_ref text,
  last_sync_at timestamptz,
  last_sync_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id),
  unique (yext_entity_id)
);

create table if not exists public.yext_listings_cache (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  yext_entity_id text not null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  summary_jsonb jsonb not null default '{}'::jsonb,
  cached_at timestamptz not null default now(),
  ttl_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id)
);

create table if not exists public.yext_reviews_cache (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  yext_entity_id text not null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  summary_jsonb jsonb not null default '{}'::jsonb,
  cached_at timestamptz not null default now(),
  ttl_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id)
);

create index if not exists yext_accounts_shop_id_idx
  on public.yext_accounts (shop_id);

create index if not exists yext_listings_cache_shop_cached_idx
  on public.yext_listings_cache (shop_id, cached_at desc);

create index if not exists yext_reviews_cache_shop_cached_idx
  on public.yext_reviews_cache (shop_id, cached_at desc);

alter table public.yext_accounts enable row level security;
alter table public.yext_listings_cache enable row level security;
alter table public.yext_reviews_cache enable row level security;

drop policy if exists yext_accounts_select on public.yext_accounts;
create policy yext_accounts_select
  on public.yext_accounts
  for select
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists yext_listings_cache_select on public.yext_listings_cache;
create policy yext_listings_cache_select
  on public.yext_listings_cache
  for select
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists yext_reviews_cache_select on public.yext_reviews_cache;
create policy yext_reviews_cache_select
  on public.yext_reviews_cache
  for select
  using (shop_id in (select public.user_shop_ids()));
