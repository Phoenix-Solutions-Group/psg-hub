-- Phase 13 / 13-01 — widen the shared Google OAuth account model for GBP.
-- GROUNDING (13-gbp-presence/13-RESEARCH.md): Google Business Profile presence +
-- insights authorize under a SEPARATE `business.manage` consent (Option B), but
-- persist into the SAME generic google_oauth_accounts table as a third source row
-- (source='gbp'), exactly as GA4/GSC do — the table is deliberately source-agnostic
-- (20260609183451_google_oauth_accounts.sql). This migration ONLY widens that
-- table; the insights/presence ingest (analytics_snapshots + analytics_sync_runs
-- source CHECKs) is widened in 13-02, NOT here.
--
-- TWO additive changes:
--   1. source CHECK ('ga4','gsc') -> ('ga4','gsc','gbp').
--   2. external_parent_id text (nullable) — for source='gbp' it stores the parent
--      `accounts/{id}` resource name. external_account_id stores the BARE
--      `locations/{id}` (the Performance API keys off that), but the legacy v4
--      Reviews API (Phase 14) and the 13-03 star-rating aggregate key off the
--      combined `accounts/{aid}/locations/{lid}` form — so capture the account id
--      now to avoid a re-enumeration later. Null for ga4/gsc rows.
--
-- AUTO-NAMED CONSTRAINT TRAP (the 12-05a/b lesson): the source CHECK in
-- 20260609183451 was written INLINE (`source text not null check (...)`), so
-- Postgres auto-named it. A blind `drop constraint if exists
-- google_oauth_accounts_source_check` silently no-ops if the live name differs,
-- leaving the old 2-value CHECK to reject 'gbp'. So resolve the LIVE constraint
-- name from pg_constraint by its definition and drop it by that real name first.
--
-- RLS is UNTOUCHED: the membership SELECT policy clamps by shop_id (not source),
-- so it already covers gbp rows. Writes stay service-role. NO touch to ga4/gsc
-- data, google_ads_*, or the snapshot/ledger layer.
--
-- Idempotent + re-runnable (the DO block drops whatever source CHECK exists,
-- incl. the new one, then re-adds; `add column if not exists`). LOCAL-applied
-- during build (supabase db reset); PROD apply is the Phase-13 gate batch (13-04)
-- under PROTOCOL-migration-safety.md with advisor baseline+diff. ZERO data written.

do $$
declare
  cname text;
begin
  select conname
    into cname
    from pg_constraint
   where conrelid = 'public.google_oauth_accounts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source%'
   limit 1;

  if cname is not null then
    execute format(
      'alter table public.google_oauth_accounts drop constraint %I', cname
    );
  end if;
end $$;

alter table public.google_oauth_accounts
  add constraint google_oauth_accounts_source_check
  check (source in ('ga4', 'gsc', 'gbp'));

alter table public.google_oauth_accounts
  add column if not exists external_parent_id text;

comment on column public.google_oauth_accounts.external_parent_id is
  'Parent resource for source=''gbp'': the My Business `accounts/{id}` whose location is stored in external_account_id (bare `locations/{id}`). Null for ga4/gsc. Pre-stages the Phase-14 v4 Reviews + 13-03 star-rating calls, which key off accounts/{aid}/locations/{lid}.';
