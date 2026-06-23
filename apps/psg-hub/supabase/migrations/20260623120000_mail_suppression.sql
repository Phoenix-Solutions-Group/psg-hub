-- W0 / PSG-221 (PSG-115e, parent PSG-216) — direct-mail suppression / dedup list.
-- Spec: docs/specs/002-mail-send-history-w0/spec.md §3.2.
--
-- First-class, queryable do-not-mail / dedup artifact. The direct-mail engine
-- calls this (src/lib/ops/mail/suppression.ts → isSuppressed()) BEFORE any send.
-- This is the W0 deliverable that is NOT blocked by the missing send-log source
-- (§2): it ships now, parallel to W1, and touches no live-mail spend.
--
-- Convention: mirrors public.survey_dispatches (20260618200000_survey_attribution_v1_4)
-- exactly — company_id, default-deny RLS gated by manage_companies, a deterministic
-- `suppression_ref` natural key with a UNIQUE constraint so the seed/import upserts
-- ON CONFLICT (suppression_ref) and re-imports never duplicate rows (PSG import-
-- idempotency mandate).
--
-- PII posture (PSG-129/132/133): NO raw name/address is stored. Only the salted
-- `recipient_hash` (normalized name+address) and the address-derived `household_key`
-- — both produced by src/lib/ops/mail/household.ts and shared with mail_send_history
-- so a send-side "already_mailed (piece,household)" row dedups against the same key.
--
-- Idempotent + re-runnable (create table if not exists / drop-if-exists policy).
-- ZERO data written here. Rollback: drop table public.mail_suppression.

-- =========================================================================
-- mail_suppression — one row per suppression rule. Scope says what the rule
-- keys on; reason says why. The engine treats a rule as in-effect when
-- effective_from <= the send's as-of date.
--
--   scope='household'  -> never mail this household_key (any piece)
--   scope='recipient'  -> never mail this recipient_hash (any piece)
--   scope='piece'      -> never re-mail this piece_code to this household_key
--                         (the derived "already_mailed" dedup rows)
--
--   reason: opt_out | already_mailed | bad_address | deceased | manual
-- =========================================================================
create table if not exists public.mail_suppression (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  scope text not null
    check (scope in ('household', 'recipient', 'piece')),
  -- Address-derived dedup key (salted hash). Required for household/piece scope.
  household_key text,
  -- Salted hash of normalized name+address. Required for recipient scope.
  recipient_hash text,
  -- Set only when scope='piece' (never re-mail this piece to this household).
  piece_code text,
  reason text not null
    check (reason in ('opt_out', 'already_mailed', 'bad_address', 'deceased', 'manual')),
  -- The rule is in effect from this date forward (compared to the send as-of date).
  effective_from date not null,
  source text not null default 'filemaker',
  -- Deterministic idempotency key, e.g.
  --   'opt_out:recipient:<recipient_hash>'
  --   'already_mailed:<piece_code>:<household_key>'
  -- UNIQUE → seed/import upserts never duplicate a rule.
  suppression_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (suppression_ref),
  -- Each scope must carry the key(s) it is matched on (defence-in-depth so a
  -- malformed seed row can't create an un-matchable / over-broad rule).
  constraint mail_suppression_scope_keys check (
    (scope = 'household' and household_key is not null)
    or (scope = 'recipient' and recipient_hash is not null)
    or (scope = 'piece' and household_key is not null and piece_code is not null)
  )
);
alter table public.mail_suppression enable row level security;

create index if not exists idx_mail_suppression_household
  on public.mail_suppression (household_key);
create index if not exists idx_mail_suppression_recipient
  on public.mail_suppression (recipient_hash);
create index if not exists idx_mail_suppression_piece
  on public.mail_suppression (scope, piece_code);

-- =========================================================================
-- Default-deny RLS — gated by manage_companies (mirrors survey_dispatches /
-- repair_orders). No anon access; the engine reads + the seed writes go through
-- the service-role client (createServiceClient, which bypasses RLS).
-- =========================================================================
do $$
begin
  drop policy if exists mail_suppression_ops_all on public.mail_suppression;
  create policy mail_suppression_ops_all on public.mail_suppression
    for all to authenticated
    using (private.current_user_has_fn('manage_companies'))
    with check (private.current_user_has_fn('manage_companies'));
end $$;

-- =========================================================================
-- updated_at trigger (reuse public.set_updated_at from ops foundation).
-- =========================================================================
do $$
begin
  drop trigger if exists set_updated_at_mail_suppression on public.mail_suppression;
  create trigger set_updated_at_mail_suppression
    before update on public.mail_suppression
    for each row execute function public.set_updated_at();
end $$;
