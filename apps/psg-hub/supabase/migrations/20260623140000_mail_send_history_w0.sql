-- W0 Foundation / PSG-223 (PSG-115e, child of PSG-216) — Direct-mail send-history
-- spine. Implements spec docs/specs/002-mail-send-history-w0/spec.md §3.1.
--
-- One row per (shop, recipient, numbered piece, send-date): the empirical record
-- of who was mailed which legacy numbered piece, when, by which shop. This is the
-- send side the BSM direct-mail engine mines for trigger/A-B priors (PSG-216d) and
-- the suppression "already-mailed" derivation reads (PSG-216b).
--
-- Conventions mirror public.survey_dispatches (20260618200000_survey_attribution_v1_4):
--   * additive, forward-only, idempotent (create table if not exists / drop-if-
--     exists policy), ZERO data written;
--   * default-deny RLS gated by private.current_user_has_fn('manage_companies') —
--     no anon access; the service-role client bypasses for report reads + import
--     writes, exactly like repair_orders / survey_dispatches;
--   * deterministic natural key (send_ref) with a UNIQUE constraint so the
--     importer upserts ON CONFLICT (send_ref) and re-imports never double-count
--     (PSG webhook/import idempotency mandate).
--
-- PII posture (PSG-129/132/133 import controls, AC4): NO raw name/address is
-- persisted here. Only a salted recipient_hash + an address-derived household_key
-- (both opaque hex) land in the table. Raw PII stays in the import staging path
-- and is dropped after the record is built — the same control the RO importer uses.
--
-- Rollback: drop table public.mail_send_history.

create table if not exists public.mail_send_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  -- Stable shop key. Seeded from the production-center PSGID token (e.g. 'PS218');
  -- resolved to the friendly shop name through the shop directory at live-wire
  -- time (lib/ops/import/shops). Kept text (not an FK) to match survey_dispatches,
  -- which also keys on shop_name rather than companies.id.
  shop_name text not null,
  -- Resolved link to the relational spine when the recipient/RO is matchable;
  -- nullable because the legacy send log predates and may not join to an RO.
  repair_order_id uuid references public.repair_orders(id) on delete set null,
  ro_number text,
  -- The numbered legacy piece: 't','04','04b','07','10','10b','12'..'16','b'.
  piece_code text not null,
  -- Physical component the address was read from / that was sent:
  -- 'letter'|'envelope'|'warranty'|'survey' (nullable — a single send may bundle
  -- several components; the row represents the send, not one component).
  piece_variant text,
  sent_date date not null,
  -- PII-min: salted hash of normalized name+address. The raw values never land here.
  recipient_hash text not null,
  -- Address-only salted hash for household-level dedup / suppression.
  household_key text not null,
  -- Production-center batch id when known (e.g. '2021-09-07').
  batch_ref text,
  -- Deterministic idempotency key: '<shop>:<recipient_hash>:<piece_code>:<sent_date>'.
  -- UNIQUE → upsert ON CONFLICT (send_ref) is safe and re-import never duplicates.
  send_ref text not null,
  source text not null default 'filemaker',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (send_ref)
);

alter table public.mail_send_history enable row level security;

create index if not exists idx_mail_send_history_shop_date
  on public.mail_send_history (shop_name, sent_date);
create index if not exists idx_mail_send_history_piece
  on public.mail_send_history (piece_code);
create index if not exists idx_mail_send_history_household
  on public.mail_send_history (household_key);
create index if not exists idx_mail_send_history_repair_order
  on public.mail_send_history (repair_order_id);

-- Default-deny RLS — mirror repair_orders / survey_dispatches exactly.
drop policy if exists mail_send_history_ops_all on public.mail_send_history;
create policy mail_send_history_ops_all on public.mail_send_history
  for all to authenticated
  using (private.current_user_has_fn('manage_companies'))
  with check (private.current_user_has_fn('manage_companies'));

-- updated_at trigger (reuse public.set_updated_at from ops foundation).
drop trigger if exists set_updated_at_mail_send_history on public.mail_send_history;
create trigger set_updated_at_mail_send_history
  before update on public.mail_send_history
  for each row execute function public.set_updated_at();
