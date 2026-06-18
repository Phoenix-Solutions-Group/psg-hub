-- v0.4 / Phase 15 — Stripe-native Invoicing + Payments data model.
--
-- REWORKED for PSG-58: the operator decision (2026-06-18) is invoicing is Stripe-native and
-- Invoiced.com is dropped. The earlier draft of this migration mirrored Invoiced.com invoices
-- (`invoices.external_id`) and carried two now-superseded tables (`invoiced_events`,
-- `invoiced_customer_map`) plus a `stripe_events` ledger that duplicated the spine's
-- `stripe_webhook_events` (20260618000000). All of that is removed here. This migration was
-- AUTHORED-NOT-APPLIED, so rewriting the file is the "drop" — those tables were never created.
--
-- Single Stripe billing surface. Two tables:
--   * invoices  — per-shop mirror of Stripe Invoice objects (subscription + one-off), PK is the
--                 Stripe invoice id so the webhook upserts by it. Customer-facing read surface.
--   * payments  — per-shop mirror of Stripe PaymentIntent objects, PK is the PaymentIntent id.
--
-- Shop ↔ Stripe linkage is `shops.stripe_customer_id` (set by the existing billing spine); the
-- webhook resolves shop_id from the Stripe customer. No Invoiced customer-map table is needed.
--
-- Both tables are the customer-facing read surface: RLS membership-clamped, mirroring live
-- review_items / bsm_campaigns (shop_id IN (SELECT user_shop_ids())). Writes are service-role-only
-- (no insert/update/delete policies) — the Stripe webhook (idempotent via stripe_webhook_events)
-- and any backfill worker write via createServiceClient() (bypasses RLS).
--
-- PII-at-rest (PLANNING.md §Security; plan §3): payment collection is delegated to Stripe-hosted
-- Checkout / hosted-invoice pages (PCI SAQ A) — NO PAN/CVV ever touches this DB. We keep the
-- financial RECORD cleartext (amounts/currency/dates, plus card brand + last4, which are not PAN)
-- for the customer's own invoice/payment history; billing IDENTITY (name/email/address) is NOT
-- stored here in cleartext — the hosted Stripe page renders it. `raw` holds a minimized Stripe
-- payload for audit/re-mirror (no payer PII beyond what the customer already sees). retain_until
-- backs a future 7-yr IRS retention sweep (redact-don't-delete) without dropping the table.
--
-- Build-local: the Stripe invoice/payment webhook handlers + UI land in Phase 17 (PSG-59); this
-- migration only authors the schema they target. The Stripe webhook route (route.ts) does not yet
-- write these tables.
--
-- Additive + idempotent (run-once safe; create-if-not-exists / guarded constraints). AUTHORED ONLY
-- — NOT applied to prod here; prod apply is the Phase-15/18 gate batch (mirrors 13-04 / 14-04)
-- under PROTOCOL-migration-safety.md with an advisor baseline+diff. ZERO data written.

-- ---------------------------------------------------------------------------
-- invoices — mirror of Stripe Invoice objects.
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  -- Stripe invoice id ("in_..."): the external system of record, and the upsert key.
  stripe_invoice_id text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- Stripe customer ("cus_..."); resolves to a shop via shops.stripe_customer_id.
  stripe_customer_id text,
  -- Set for subscription invoices; null for one-off invoices.
  stripe_subscription_id text,
  -- Human-facing Stripe invoice number (e.g. "ABCD-0001"); distinct from the opaque id.
  number text,
  -- Stripe invoice status: draft | open | paid | uncollectible | void (DB backstop; zod is primary).
  status text not null default 'draft',
  amount_due integer not null default 0,
  amount_paid integer not null default 0,
  currency text not null default 'usd',
  -- Stripe-hosted invoice page + PDF — the UI CTA (no in-app charge route, no Invoiced PDF).
  hosted_invoice_url text,
  invoice_pdf text,
  -- Billing period this invoice covers (subscription invoices).
  period_start timestamptz,
  period_end timestamptz,
  -- Stripe object creation time (distinct from our mirror's created_at).
  created timestamptz,
  -- Minimized Stripe payload for audit / re-mirror (no payer PII beyond what the customer sees).
  raw jsonb,
  -- Retention horizon for a future PII-at-rest purge sweep; null = keep.
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Named status CHECK (DB backstop; zod enum is the app-side gate). Stripe's canonical
-- invoice statuses — note there is no "past_due" (that is a subscription state, not an invoice one).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_status_check'
  ) then
    alter table public.invoices
      add constraint invoices_status_check
      check (status in ('draft', 'open', 'paid', 'uncollectible', 'void'));
  end if;
end$$;

-- RLS: membership-clamped read, mirroring live review_items / bsm_campaigns. Default-deny;
-- the service-role webhook/backfill worker bypasses RLS. Read-only for customers (no
-- insert/update/delete policies — writes are service-role-only, exactly like email_events).
alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (shop_id in (select public.user_shop_ids()));

create index if not exists invoices_shop_idx on public.invoices(shop_id);
create index if not exists invoices_shop_status_idx on public.invoices(shop_id, status);
create index if not exists invoices_subscription_idx on public.invoices(stripe_subscription_id);

-- ---------------------------------------------------------------------------
-- payments — mirror of Stripe PaymentIntent objects (one-off + invoice payments).
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  -- Stripe PaymentIntent id ("pi_..."): the upsert key.
  stripe_payment_intent_id text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- The invoice this payment settles, when applicable (one-off payments have none).
  stripe_invoice_id text references public.invoices(stripe_invoice_id) on delete set null,
  -- Latest Stripe charge ("ch_..."), for receipt/refund lookups.
  stripe_charge_id text,
  amount integer not null default 0,
  amount_received integer not null default 0,
  currency text not null default 'usd',
  -- Stripe PaymentIntent status (DB backstop; zod is primary).
  status text not null default 'requires_payment_method',
  -- Financial record (NOT PAN): card brand + last4 are safe to store for receipt display.
  payment_method_brand text,
  payment_method_last4 text,
  -- Minimized Stripe payload for audit; no PAN/CVV ever (Stripe-hosted Checkout, PCI SAQ A).
  raw jsonb,
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_status_check'
  ) then
    alter table public.payments
      add constraint payments_status_check
      check (status in (
        'requires_payment_method', 'requires_confirmation', 'requires_action',
        'processing', 'requires_capture', 'canceled', 'succeeded'
      ));
  end if;
end$$;

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (shop_id in (select public.user_shop_ids()));

create index if not exists payments_shop_idx on public.payments(shop_id);
create index if not exists payments_invoice_idx on public.payments(stripe_invoice_id);
