-- Phase 11 / 11-01 — Transient OAuth state + pending-link carry for GA4 + GSC.
-- Mirrors public.google_ads_oauth_states (20260608000000_google_ads_tables.sql) +
-- the 10-04 pending-carry columns (20260609000000_google_ads_oauth_pending.sql),
-- generalized for the two new sources. The link flow is two steps: the combined
-- consent enumerates BOTH the user's GA4 properties AND GSC sites under the fresh
-- refresh token, then the user picks one of each. The encrypted refresh token and
-- the enumerated lists must survive between the `callback` GET and the `/select`
-- POST. We stash them transiently on this default-deny row (service-role only;
-- never read by a customer session) and consume on select.
--
-- DIFFERENCES from google_ads_oauth_states:
--   + `source` column (the flow can target ga4/gsc/both; informational).
--   + `pending_accounts jsonb` carries BOTH enumerated lists as {ga4:[...],gsc:[...]}.
--   - DROPS the ads-only `pending_login_customer_id` (no MCC concept for GA4/GSC).
--
-- The state_token is the HMAC-signed value (src/lib/google-oauth/state.ts, reusing
-- ADS_STATE_SECRET); PK = the unique lookup key. Atomic anti-replay consume via
-- `.is('consumed_at', null)`; lazy expiry GC.
--
-- RLS: enabled, NO policy = default-deny (service-role only), mirroring
-- google_ads_oauth_states. Idempotent + re-runnable. LOCAL-applied; PROD apply is
-- the Phase-11 gate batch. ZERO data written here.

create table if not exists public.google_oauth_pending_states (
  state_token text primary key,
  user_id uuid not null,
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- The source(s) this flow targets. The combined GA4+GSC link uses 'google'.
  source text not null default 'google',
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- Transient pending-link carry (callback -> select). Nullable: an unconsumed
  -- pre-stash row simply has them null.
  pending_encrypted_token text,
  pending_key_version integer,
  pending_scope text,
  -- {ga4: [{id,name}], gsc: [{id,name}]} — the offered sets for anti-tamper.
  pending_accounts jsonb,
  created_at timestamptz not null default now()
);

create index if not exists google_oauth_pending_states_expires_at_idx
  on public.google_oauth_pending_states (expires_at);

-- RLS enabled, NO policy = default-deny (service-role only; no customer read path).
alter table public.google_oauth_pending_states enable row level security;
