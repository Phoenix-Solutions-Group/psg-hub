-- Phase 10 / 10-01 — Google Ads tables provision.
-- GROUNDING (v0.3 re-plan 2026-06-04, re-verified 2026-06-08): the Google Ads
-- OAuth/client/campaigns lib (src/lib/google-ads/*), the 7 /api/ads/google/*
-- routes, and the full /dashboard/ads UI are ALREADY BUILT, but every table they
-- read/write is absent from prod, from every prior migration, AND from the
-- 20260602105554_remote_schema.sql dump. This migration creates them so the
-- blind-built code can run. Column shapes are derived from the authoritative
-- read/write sites (types.ts GoogleAdsAccountRow/GoogleAdsCampaignRow;
-- oauth.ts/client.ts/callback insert+select; sync route select/update).
--
-- ENCRYPTION DECISION (operator, 2026-06-08): refresh tokens use the built
-- app-level AES-256-GCM (src/lib/google-ads/crypto.ts) -> `encrypted_refresh_token
-- bytea` + `key_version integer`. This is a RECORDED DEVIATION from PROJECT.md's
-- "pgsodium encryption at rest for OAuth refresh tokens" constraint: the inherited
-- code is built + unit-tested with versioned app-key GCM (genuine encryption-at-
-- rest); re-doing it as pgsodium is pure risk for no security gain. Phase 11
-- (GA4+GSC) inherits this choice for refresh-token consistency.
--
-- RLS (per-table verdict, mirrors 20260604000000_analytics_snapshots.sql +
-- 20260605000000_analytics_sync_runs.sql):
--   google_ads_accounts / google_ads_campaigns -> membership SELECT
--     (shop_id IN user_shop_ids()); writes are service-role (RLS bypass).
--   google_ads_oauth_states / ads_api_call_log -> RLS enabled, NO policy
--     (default-deny; service-role only) — transient OAuth state + audit log,
--     never read by a customer session (the analytics_sync_runs / llm_call_log
--     precedent).
--
-- Idempotent + re-runnable. LOCAL-applied during build; PROD apply is the Phase-10
-- operator gate batch (10-03) under PROTOCOL-migration-safety.md with advisor
-- baseline+diff. ZERO data written here.

-- ── google_ads_accounts ──────────────────────────────────────────────────────
create table if not exists public.google_ads_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id text not null,
  login_customer_id text,
  encrypted_refresh_token bytea not null,
  key_version integer not null,
  scope text not null,
  status text not null default 'linked'
    check (status in ('linked', 'revoked', 'error')),
  linked_by uuid,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  -- callback upsert onConflict target (callback/route.ts l.145)
  unique (shop_id, customer_id)
);

-- ── google_ads_campaigns ─────────────────────────────────────────────────────
create table if not exists public.google_ads_campaigns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null references public.google_ads_accounts (id) on delete cascade,
  external_resource_name text not null,
  external_id text not null,
  name text not null,
  template_id text,
  campaign_type text not null,
  status text not null
    check (status in ('paused', 'enabled', 'removed')),
  daily_budget_micros bigint not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  metrics_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, external_id)
);

-- ── google_ads_oauth_states ──────────────────────────────────────────────────
-- Transient HMAC-signed OAuth state (oauth.ts: insert l.85, atomic consume
-- l.133, expiry GC l.128). PK = state_token (the unique lookup key).
create table if not exists public.google_ads_oauth_states (
  state_token text primary key,
  user_id uuid not null,
  shop_id uuid not null references public.shops (id) on delete cascade,
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_ads_oauth_states_expires_at_idx
  on public.google_ads_oauth_states (expires_at);

-- ── ads_api_call_log ─────────────────────────────────────────────────────────
-- Audit + rate-limit ledger (client.ts: insert l.76, rate-limit count by
-- (shop_id, method, created_at) l.41-46).
create table if not exists public.ads_api_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  shop_id uuid references public.shops (id) on delete set null,
  account_id uuid references public.google_ads_accounts (id) on delete set null,
  endpoint text not null,
  method text not null
    check (method in ('GET', 'MUTATE', 'SEARCH', 'REVOKE')),
  resource_name text,
  latency_ms integer,
  result text not null
    check (result in ('success', 'error', 'timeout', 'rate_limited', 'auth_failed')),
  error_code text,
  created_at timestamptz not null default now()
);

-- Composite index for the rolling-window rate-limit COUNT (client.ts l.41-46).
create index if not exists ads_api_call_log_shop_method_created_idx
  on public.ads_api_call_log (shop_id, method, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.google_ads_accounts  enable row level security;
alter table public.google_ads_campaigns enable row level security;
alter table public.google_ads_oauth_states enable row level security;
alter table public.ads_api_call_log     enable row level security;

-- Membership SELECT on the two customer-readable tables (accounts route reads via
-- the user-session client; "RLS enforces tenancy"). Writes stay service-role.
-- Drop-then-create so the migration is re-runnable (no CREATE POLICY IF NOT EXISTS).
drop policy if exists google_ads_accounts_select on public.google_ads_accounts;
create policy google_ads_accounts_select
  on public.google_ads_accounts
  for select
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists google_ads_campaigns_select on public.google_ads_campaigns;
create policy google_ads_campaigns_select
  on public.google_ads_campaigns
  for select
  using (shop_id in (select public.user_shop_ids()));

-- google_ads_oauth_states + ads_api_call_log: NO policy = default-deny.
-- Service-role (callback/client/oauth) bypasses RLS; no customer read path.
