-- Phase 12 — Atomic delivery claim for monthly reports (idempotency hardening).
-- AUTHORED NOT APPLIED. Per PROTOCOL-migration-safety.md: build-local only; the prod
-- apply (advisor baseline + diff) is an operator-gate batch, NOT this plan. The cron's
-- claimForSend dep is inert until this migration lands (the RPC must exist first).
--
-- WHY: the prior gate was a non-atomic read (alreadySent: emailed_at IS NULL) followed,
-- much later, by markEmailed AFTER the SendGrid send. Two overlapping runs (cron + a
-- manual trigger, or a Vercel retry) could both read "not sent", both render, and both
-- email the customer the same report. A send-then-mark-fail also left the next retry
-- eligible to re-send. This migration replaces that read with a server-side atomic
-- claim taken BEFORE the send, so exactly one run delivers under overlap.
--
-- Idempotent + re-runnable: add column if not exists, create or replace function.

-- ── 1. claim bookkeeping column ─────────────────────────────────────────────
-- claimed_at marks when a run took the exclusive send slot. emailed_at (existing)
-- still marks a COMPLETED send. A row in (claimed_at set, emailed_at null) state is
-- "in flight or crashed" and is reclaimable only after the stale window.
alter table public.monthly_reports
  add column if not exists claimed_at timestamptz;

-- ── 2. atomic claim RPC ─────────────────────────────────────────────────────
-- Returns TRUE iff this caller won the exclusive claim. The whole decision is a single
-- conditional UPDATE: concurrent callers serialize on the row lock and re-evaluate the
-- WHERE against the committed row, so at most one matches. The row must already exist
-- (recordReport upserts it just before the claim).
--
-- Win condition, reasoned through every case:
--   (p_force OR emailed_at IS NULL)                    -- force re-sends a delivered report;
--                                                      -- non-force only an undelivered one
--   AND (claimed_at IS NULL OR claimed_at < stale)     -- exclusivity: a fresh claim blocks
--                                                      -- all others until the stale window
-- On a win: stamp claimed_at = now(); when forced, also clear emailed_at so a forced
-- re-send is uniformly "unsent until markEmailed re-stamps it".
--
--   concurrent force + non-force on a sent row  -> exactly one wins (loser sees fresh claimed_at)
--   force on a sent row (claim stale)           -> wins, clears emailed_at, re-sends
--   non-force on a sent row                      -> loses (emailed_at set, not forced) -> skip
--   crash/mark-fail after claim                  -> reclaimable only after stale window (>= retry)
--
-- NOTE: not SECURITY DEFINER. Only the service client (RLS-bypass) calls this; monthly_reports
-- has no INSERT/UPDATE policy, so any non-service caller hits default-deny -> 0 rows -> false.
create or replace function public.claim_monthly_report(
  p_shop_id uuid,
  p_period_month text,
  p_force boolean default false,
  p_stale_minutes integer default 15
) returns boolean
language sql
as $$
  update public.monthly_reports
  set claimed_at = now(),
      emailed_at = case when p_force then null else emailed_at end
  where shop_id = p_shop_id
    and period_month = p_period_month
    and (p_force or emailed_at is null)
    and (claimed_at is null or claimed_at < now() - make_interval(mins => p_stale_minutes))
  returning true;
$$;

comment on function public.claim_monthly_report(uuid, text, boolean, integer) is
  'Atomic exclusive claim of a monthly report send slot. TRUE = caller won (proceed to send). See 20260613000000.';
