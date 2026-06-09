-- Phase 10 / 10-04 — MCC account-selection: transient pending-link carry.
-- The OAuth link becomes two steps when the authenticating Google account can
-- reach >1 Google Ads client (PSG is an MCC): consent -> pick account -> persist.
-- The refresh token (already AES-256-GCM encrypted) and the enumerated account
-- list must survive between the `callback` GET and the `/select` POST. We stash
-- them transiently on the existing default-deny `google_ads_oauth_states` row
-- (service-role only; never read by a customer session) and clear them on
-- consume. No new table; columns are nullable so the single-customer path and
-- legacy rows are unaffected.
--
-- Idempotent + re-runnable. Rollback: drop the 5 columns below.
-- Prod apply: 10-04 under PROTOCOL-migration-safety.md (advisor baseline+diff).

alter table public.google_ads_oauth_states
  add column if not exists pending_encrypted_token text,
  add column if not exists pending_key_version integer,
  add column if not exists pending_scope text,
  add column if not exists pending_login_customer_id text,
  add column if not exists pending_customers jsonb;
