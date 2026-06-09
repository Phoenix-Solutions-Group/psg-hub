-- Phase 11 / 11-01 — Shared Google OAuth account model for GA4 + GSC.
-- GROUNDING (11-ga4-gsc/RESEARCH.md): GA4 (Analytics) and GSC (Search Console)
-- are authorized in ONE combined-scope consent (analytics.readonly +
-- webmasters.readonly) yielding ONE refresh token usable for both APIs. The
-- chosen GA4 property and GSC site are persisted as TWO rows here, sharing that
-- single encrypted refresh token. A GENERIC per-source table (not two mirror
-- tables) follows the codebase's strongest precedent — analytics_snapshots is
-- deliberately source-agnostic — and saves RLS/types/migration boilerplate at
-- zero logic cost. The ads-only `login_customer_id` (MCC) is correctly absent.
--
-- ENCRYPTION DECISION (operator, 2026-06-08; recorded in 20260608000000_google_ads_tables.sql):
-- refresh tokens use the built app-level AES-256-GCM (src/lib/google-ads/crypto.ts,
-- shared ADS_ENCRYPTION_KEY) -> `encrypted_refresh_token bytea` + `key_version`.
-- That migration explicitly binds Phase 11: "Phase 11 (GA4+GSC) inherits this
-- choice for refresh-token consistency." Reused as-is here; NO pgsodium, NO re-key.
-- bytea round-trip trap (10-01 finding): the write side stores Postgres `\x<hex>`
-- TEXT form (a raw Buffer JSON-serializes wrong over PostgREST); the read side
-- decodes `\x`-prefixed strings back to Buffer before decrypt.
--
-- RLS (mirrors google_ads_accounts exactly): membership SELECT
-- (shop_id IN user_shop_ids()); writes are service-role (RLS bypass). No
-- customer write path; the link routes use the service client.
--
-- The snapshot/ledger layer needs NO migration: analytics_snapshots /
-- analytics_sync_runs source CHECKs already admit 'ga4' and 'gsc'
-- (20260604000000_analytics_snapshots.sql, 20260605000000_analytics_sync_runs.sql).
-- This migration does NOT touch google_ads_* (shipped + in the prod pipeline).
--
-- Idempotent + re-runnable. LOCAL-applied during build (supabase db reset);
-- PROD apply is the Phase-11 operator gate batch under PROTOCOL-migration-safety.md
-- with advisor baseline+diff. ZERO data written here.

create table if not exists public.google_oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  source text not null
    check (source in ('ga4', 'gsc')),
  -- GA4: 'properties/<numeric>'; GSC: 'sc-domain:<host>' or 'https://.../'.
  external_account_id text not null,
  display_name text,
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
  -- accounts.ts upsert onConflict target: reconnect/re-pick after revoke.
  unique (shop_id, source, external_account_id)
);

-- RLS: membership SELECT only (mirrors google_ads_accounts). Writes service-role.
alter table public.google_oauth_accounts enable row level security;

drop policy if exists google_oauth_accounts_select on public.google_oauth_accounts;
create policy google_oauth_accounts_select
  on public.google_oauth_accounts
  for select
  using (shop_id in (select public.user_shop_ids()));
