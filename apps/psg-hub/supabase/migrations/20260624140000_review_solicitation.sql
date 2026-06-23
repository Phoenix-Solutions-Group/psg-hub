-- PSG-248 / Wave 2 (G-c) — Proactive review solicitation (SMS + email).
--
-- Two append-only tables backing the solicitation flow:
--
--   1. solicitation_opt_outs     — the do-not-contact list. One IMMUTABLE row per
--      STOP / START / unsubscribe event (current status = latest event for a
--      contact). Compliance-critical, so it is append-only and provable: you can
--      always show WHEN and HOW a contact opted out. Idempotent on event_ref so a
--      replayed SMS webhook / unsubscribe click never duplicates.
--
--   2. review_solicitation_sends — the SEND AUDIT. One immutable row per
--      (approval, channel, contact) attempt — sent, failed, or skipped (with the
--      skip reason). Idempotent on (approval_id, channel, contact_hash) so a
--      retried publish cannot double-contact a customer.
--
-- PII posture: contacts are matched on a salted HMAC (em_… / ph_…), never stored
-- in the clear (mirrors mail_suppression / household_key).
--
-- Tenant isolation:
--   - solicitation_opt_outs is contact-keyed (no shop) → RLS default-deny, NO
--     policy: service-role only (the webhook / unsubscribe route + the publisher).
--   - review_solicitation_sends is per-shop → RLS SELECT for shop members
--     (shop_id in select public.user_shop_ids()), mirroring approval_queue.
-- Both are append-only: a private trigger raises on UPDATE/DELETE for ALL roles
-- (service_role included), backed by REVOKE update/delete — exactly like
-- access_audit (20260618130000).
--
-- Idempotent (create-if-not-exists / drop-then-create). Rollback: drop both tables
-- + the private function.

-- =========================================================================
-- 1. solicitation_opt_outs — append-only do-not-contact event log.
-- =========================================================================
create table if not exists public.solicitation_opt_outs (
  id uuid primary key default gen_random_uuid(),
  -- Which channel the contact opted out of (email / sms are independent).
  channel text not null check (channel in ('email', 'sms')),
  -- Salted HMAC of the normalized contact (em_… / ph_…). Never raw PII.
  contact_hash text not null,
  -- Latest event for a (channel, contact) is the live status.
  state text not null check (state in ('opted_out', 'opted_in')),
  reason text not null
    check (reason in ('sms_stop', 'sms_start', 'email_unsubscribe', 'manual')),
  -- Provenance: sms_webhook | unsubscribe_link | manual | ….
  source text not null,
  -- Stable idempotency key (provider message id / signed token) — UNIQUE.
  event_ref text not null,
  -- Optional company scoping (no FK — kept loose like mail_suppression).
  company_id uuid,
  created_at timestamptz not null default now()
);

-- One row per opt-out/opt-in event; replays collapse on the ref.
create unique index if not exists solicitation_opt_outs_event_ref_key
  on public.solicitation_opt_outs (event_ref);

-- "Is this contact opted out right now?" — newest event per (channel, contact).
create index if not exists solicitation_opt_outs_contact_idx
  on public.solicitation_opt_outs (channel, contact_hash, created_at desc);

alter table public.solicitation_opt_outs enable row level security;
-- No policy on purpose: contact-keyed compliance data is service-role only.

-- =========================================================================
-- 2. review_solicitation_sends — append-only per-channel send audit.
-- =========================================================================
create table if not exists public.review_solicitation_sends (
  id uuid primary key default gen_random_uuid(),
  -- Tenant: the shop the solicitation belongs to.
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- The approval_queue row that governed this send (the human gate).
  approval_id uuid not null references public.approval_queue(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  -- Salted HMAC of the recipient contact (may be '' when there was no contact).
  contact_hash text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  -- Why a channel was skipped (suppressed | opted_out | no_consent | no_contact).
  skip_reason text,
  -- Provider reference on success (SendGrid x-message-id / Twilio SID).
  provider_ref text,
  -- Provider error message on failure.
  error text,
  company_id uuid,
  created_at timestamptz not null default now()
);

-- Idempotency: at most one audited attempt per (approval, channel, contact).
create unique index if not exists review_solicitation_sends_unique
  on public.review_solicitation_sends (approval_id, channel, contact_hash);

-- The shop's send history newest-first.
create index if not exists review_solicitation_sends_shop_idx
  on public.review_solicitation_sends (shop_id, created_at desc);

alter table public.review_solicitation_sends enable row level security;

-- Shop members read their own send audit; writes are service-role (no write policy).
drop policy if exists review_solicitation_sends_select on public.review_solicitation_sends;
create policy review_solicitation_sends_select on public.review_solicitation_sends
  for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- =========================================================================
-- 3. Append-only enforcement — reject every UPDATE/DELETE, all roles.
--    Lives in `private` (not PostgREST-exposed), empty search_path.
-- =========================================================================
create or replace function private.reject_solicitation_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists solicitation_opt_outs_no_mutate on public.solicitation_opt_outs;
create trigger solicitation_opt_outs_no_mutate
  before update or delete on public.solicitation_opt_outs
  for each row execute function private.reject_solicitation_mutation();

drop trigger if exists review_solicitation_sends_no_mutate on public.review_solicitation_sends;
create trigger review_solicitation_sends_no_mutate
  before update or delete on public.review_solicitation_sends
  for each row execute function private.reject_solicitation_mutation();

-- Defense in depth: no grantee may even attempt update/delete.
revoke update, delete on public.solicitation_opt_outs from anon, authenticated;
revoke update, delete on public.review_solicitation_sends from anon, authenticated;
