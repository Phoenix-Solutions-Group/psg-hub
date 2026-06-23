-- CCC Secure Share — Phase 1A foundation. [PSG-260, child of PSG-252]
-- Builds against the PUBLIC CIECA BMS spec only — no live surface, no external
-- dependency. This migration provisions the credential-vault + audit spine the
-- Phase-1B ingest/link code will read/write. ZERO data written here.
--
-- GROUNDING: mirrors the Google Ads account/credential pattern exactly
-- (20260608000000_google_ads_tables.sql + src/lib/google-ads/crypto.ts). The CCC
-- Secure Share auth scheme is still being confirmed in Phase 0 (PSG-251:
-- OAuth-refresh-token / API-key / cert), so the stored credential is kept SHAPE-
-- ABSTRACT: a generic `encrypted_credential bytea` blob + a `credential_kind`
-- discriminator. When Phase 0 lands the real scheme we set credential_kind and
-- start writing the blob — no re-migration.
--
-- ENCRYPTION DECISION: inherits the recorded google-ads deviation — credentials
-- use app-level AES-256-GCM (src/lib/ccc-secure-share/crypto.ts) with versioned
-- env keys -> `encrypted_credential bytea` + `key_version integer`. This is the
-- documented deviation from PROJECT.md's "pgsodium at rest" constraint: the
-- google-ads precedent is built + unit-tested with versioned app-key GCM (genuine
-- encryption-at-rest); re-doing it as pgsodium is pure risk for no security gain.
--
-- RLS (per-table verdict):
--   ccc_accounts      -> membership SELECT (shop_id IN user_shop_ids()) AND the
--     capability gate private.current_user_has_fn('manage_ccc_integration');
--     writes are service-role (RLS bypass) for the link/ingest path. This is a
--     STRICTER policy than google_ads_accounts (which gates on membership only) —
--     credential rows are operator-managed, so they additionally require the
--     manage_ccc_integration capability to be visible.
--   ccc_api_call_log  -> RLS enabled, NO policy (default-deny; service-role only),
--     mirroring ads_api_call_log — an audit/rate-limit ledger never read by a
--     customer session.
--
-- Idempotent + re-runnable (create if not exists / drop-if-exists policy / jsonb
-- merge). LOCAL-applied during build; PROD apply stays behind the operator gate
-- (NOT auto-applied by the pipeline — PROTOCOL-migration-safety.md).
--
-- Rollback: drop table public.ccc_api_call_log, public.ccc_accounts; remove the
--   'manage_ccc_integration' key from the Administrator security_profile_defs row.

-- ── ccc_accounts ─────────────────────────────────────────────────────────────
create table if not exists public.ccc_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- CCC Secure Share account / facility identifier (e.g. the CIECA trading-partner
  -- or facility id the BMS event-sink is scoped to). Text — the canonical form is
  -- confirmed in Phase 0 (PSG-251).
  ccc_account_id text not null,
  facility_id text,
  -- Credential blob + the scheme discriminator. Kept abstract until Phase 0
  -- confirms the auth scheme. 'unconfirmed' is the scaffold default; once the
  -- scheme lands we write 'oauth_refresh_token' | 'api_key' | 'certificate'.
  credential_kind text not null default 'unconfirmed'
    check (credential_kind in ('unconfirmed', 'oauth_refresh_token', 'api_key', 'certificate')),
  encrypted_credential bytea,
  key_version integer,
  status text not null default 'linked'
    check (status in ('linked', 'revoked', 'error')),
  linked_by uuid,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  -- upsert onConflict target for the future link path.
  unique (shop_id, ccc_account_id)
);

-- ── ccc_api_call_log ─────────────────────────────────────────────────────────
-- Audit + rate-limit ledger (rolling 60-min window count by
-- (shop_id, method, created_at)). Mirrors public.ads_api_call_log.
create table if not exists public.ccc_api_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  shop_id uuid references public.shops (id) on delete set null,
  account_id uuid references public.ccc_accounts (id) on delete set null,
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

-- Composite index for the rolling-window rate-limit COUNT.
create index if not exists ccc_api_call_log_shop_method_created_idx
  on public.ccc_api_call_log (shop_id, method, created_at);

-- ── Capability: manage_ccc_integration on the built-in Administrator ──────────
-- Additive jsonb merge — `||` sets the new key without clobbering existing ones,
-- and is idempotent (re-running just re-sets true). Administrator is seeded by
-- 20260618170000_ops_foundation_v1_1.sql, which orders before this migration.
update public.security_profile_defs
set
  functions_jsonb = functions_jsonb || jsonb_build_object('manage_ccc_integration', true),
  updated_at = now()
where name = 'Administrator';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.ccc_accounts     enable row level security;
alter table public.ccc_api_call_log enable row level security;

-- ccc_accounts: membership AND capability gate for SELECT. Writes stay
-- service-role (RLS bypass). Drop-then-create so the migration is re-runnable.
drop policy if exists ccc_accounts_select on public.ccc_accounts;
create policy ccc_accounts_select
  on public.ccc_accounts
  for select
  to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and private.current_user_has_fn('manage_ccc_integration')
  );

-- ccc_api_call_log: NO policy = default-deny. Service-role (ingest/client)
-- bypasses RLS; no customer read path.
