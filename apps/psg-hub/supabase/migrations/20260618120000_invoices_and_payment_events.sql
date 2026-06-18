-- v0.4 / 15-01 — Invoicing + Payments data model.
--
-- Three tables:
--   * invoices            — per-shop mirror of Invoiced.com invoices (+ Stripe one-off payment state).
--   * invoiced_events      — webhook idempotency ledger for the Invoiced webhook (event_id UNIQUE).
--   * stripe_events        — webhook idempotency ledger for the Stripe webhook (event_id UNIQUE).
--
-- `invoices` is the customer-facing read surface (RLS membership-clamped, mirroring review_sentiment /
-- bsm_campaigns: shop_id IN (SELECT user_shop_ids())). The two *_events tables are service-role-only
-- (default-deny RLS, no policies) — they exist purely so a replayed webhook is a no-op (PLANNING.md
-- §Security "Webhooks ... idempotent via event_id"; quality gate "every webhook handler has idempotency key").
--
-- PII-at-rest (v0.2-deferred, picked up here): invoices.raw holds the vendor payload for audit/re-mirror,
-- but we DO NOT persist payer card data or full billing addresses — only the minimum needed to render a
-- customer's own invoice list (number, amount, status, due date, a display customer_name, pdf_url). Payment
-- collection is delegated to Stripe-hosted Checkout, so no PAN/CVV ever touches this DB. retain_until lets a
-- future retention sweep purge mirrored rows on a schedule without dropping the table.
--
-- Additive + idempotent (run-once safe; create-if-not-exists / drop-then-create policies). AUTHORED ONLY —
-- NOT applied to prod here; prod apply is gated on G1 (prod deploy) + G3 (Invoiced vendor spend), mirroring
-- 13-04 / 14-03 (PROTOCOL-migration-safety.md). ZERO data written.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- Invoiced.com invoice id (the external system of record). UNIQUE so the webhook upserts by it.
  external_id text not null,
  -- Human-facing invoice number from Invoiced (e.g. "INV-0042"); distinct from the opaque external_id.
  number text,
  customer_name text,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  -- draft | open | paid | past_due | void | uncollectible — DB backstop; the app/zod is the primary gate.
  status text not null default 'open',
  due_date date,
  paid_at timestamptz,
  pdf_url text,
  -- Stripe one-off payment linkage (populated by the pay route + Stripe webhook coexistence path).
  payment_link_url text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  -- Vendor payload for audit / re-mirror. Minimized (no payer PII beyond display name) — see header note.
  raw jsonb,
  -- Retention horizon for a future PII-at-rest purge sweep; null = keep.
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One invoice row per Invoiced invoice: required for the webhook upsert's onConflict(external_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_external_id_key'
  ) then
    alter table public.invoices add constraint invoices_external_id_key unique (external_id);
  end if;
end$$;

-- Named status CHECK (DB backstop; zod enum is the app-side gate).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_status_check'
  ) then
    alter table public.invoices
      add constraint invoices_status_check
      check (status in ('draft', 'open', 'paid', 'past_due', 'void', 'uncollectible'));
  end if;
end$$;

-- RLS: membership-clamped, mirroring live review_items / bsm_campaigns policies.
-- Default-deny; the service-role webhook/pay worker bypasses RLS. Read-only for customers
-- (no insert/update/delete policies — writes are service-role-only, exactly like email_events).
alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (shop_id in (select public.user_shop_ids()));

create index if not exists invoices_shop_idx on public.invoices(shop_id);
create index if not exists invoices_shop_status_idx on public.invoices(shop_id, status);

-- ---------------------------------------------------------------------------
-- Webhook idempotency ledgers. Service-role-only: RLS enabled, NO policies =>
-- default-deny to every customer; the webhook writes via service role (bypasses RLS).
-- ---------------------------------------------------------------------------

create table if not exists public.invoiced_events (
  event_id text primary key,
  event_type text,
  invoice_external_id text,
  payload jsonb,
  received_at timestamptz not null default now()
);
alter table public.invoiced_events enable row level security;

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text,
  payload jsonb,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

-- ---------------------------------------------------------------------------
-- Invoiced customer -> shop matching (PLANNING.md "invoiced_customer_* shop matching tables").
-- The webhook resolves an invoice's shop_id via this map. Populated by ops when a shop is
-- onboarded to Invoiced (a per-invoice metadata.shop_id override is also honored by the route).
-- Service-role-managed; customers may READ their own mapping (RLS membership-clamped) but not write.
-- ---------------------------------------------------------------------------
create table if not exists public.invoiced_customer_map (
  invoiced_customer_id text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invoiced_customer_map_shop_idx
  on public.invoiced_customer_map(shop_id);

alter table public.invoiced_customer_map enable row level security;
drop policy if exists invoiced_customer_map_select on public.invoiced_customer_map;
create policy invoiced_customer_map_select on public.invoiced_customer_map
  for select using (shop_id in (select public.user_shop_ids()));
