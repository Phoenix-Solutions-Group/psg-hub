-- Phase 27 / v1.3 — Production Module data model (Lob path). [PSG-27]
-- PSG's core-revenue mail program, in-hub: companies with a program → repair
-- customers → batches of print-ready documents → mailed via a vendor (Lob now,
-- in-house fast-follow) → moved to historical → reprintable with audit.
--
-- Builds on the v1.1 Ops Foundation spine (20260618170000): default-deny RLS on
-- every table, gated by private.current_user_has_fn('manage_production') — the
-- capability the Administrator built-in profile already grants. service-role
-- bypasses RLS for webhook ingestion (the Lob status callback writes vendor jobs
-- with the service client, exactly like the SendGrid/Twilio event tables).
--
-- Vendor dual-adapter (PLANNING.md Decision 53 / Q4): mail_vendor_jobs.vendor is
-- ('lob' | 'inhouse'); the shared MailAdapter interface (src/lib/production/) is
-- vendor-agnostic and selection is per-template / per-shop.
--
-- Idempotent (create if not exists / drop-if-exists policy). Reuses the shared
-- public.set_updated_at() trigger fn from the ops-foundation migration.
-- Rollback: drop the four tables created here (children first).

-- =========================================================================
-- 1. Production batches — a named print run for one company's program.
-- =========================================================================
create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  -- draft → queued → printing → historical (terminal happy path); cancelled.
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'printing', 'historical', 'cancelled')),
  -- Vendor chosen for the batch (per-shop/per-template selection); nullable until queued.
  vendor text check (vendor in ('lob', 'inhouse')),
  document_count integer not null default 0 check (document_count >= 0),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.production_batches enable row level security;

-- =========================================================================
-- 2. Production documents — one mail piece per repair customer in a batch.
-- =========================================================================
create table if not exists public.production_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  repair_customer_id uuid references public.repair_customers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  piece_type text not null default 'postcard' check (piece_type in ('postcard', 'letter')),
  -- Snapshot of the to/from addresses at print time (customer rows can change later).
  to_address jsonb not null default '{}'::jsonb,
  from_address jsonb not null default '{}'::jsonb,
  -- Canonical MailJobStatus (src/lib/production/types.ts). 'created' until a vendor job exists.
  status text not null default 'created'
    check (status in ('created', 'rendered', 'mailed', 'in_transit', 'in_local_area',
                      'processed_for_delivery', 'delivered', 're_routed',
                      'returned_to_sender', 'failed', 'cancelled', 'unknown')),
  vendor text check (vendor in ('lob', 'inhouse')),
  -- Vendor job id (Lob psc_/ltr_) — fast lookup target for inbound webhooks.
  external_id text,
  -- Rendered print-ready asset (Sanity mail-merge → PDF) + vendor proof URL.
  rendered_url text,
  proof_url text,
  expected_delivery_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.production_documents enable row level security;

-- =========================================================================
-- 3. Mail vendor jobs — append-style lifecycle log per document (webhook sink).
--    UNIQUE(external_id, status): one job legitimately spans multiple lifecycle
--    rows (created/mailed/delivered), while a replayed (external_id, status)
--    dedupes — the same idempotency shape as the Twilio sms_events table.
-- =========================================================================
create table if not exists public.mail_vendor_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.production_documents(id) on delete cascade,
  vendor text not null check (vendor in ('lob', 'inhouse')),
  external_id text not null,
  status text not null,
  event_type text,
  occurred_at timestamptz,
  raw_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (external_id, status)
);
alter table public.mail_vendor_jobs enable row level security;
create index if not exists idx_mail_vendor_jobs_document on public.mail_vendor_jobs (document_id);
create index if not exists idx_mail_vendor_jobs_external on public.mail_vendor_jobs (external_id);

-- =========================================================================
-- 4. Production reprint log — dedicated audit trail (PLANNING §Production model).
--    Every reprint writes a row (who/when/why) — the production audit gate.
-- =========================================================================
create table if not exists public.production_reprint_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.production_documents(id) on delete cascade,
  reprinted_by_profile_id uuid references public.profiles(id) on delete set null,
  reason text,
  reprinted_at timestamptz not null default now()
);
alter table public.production_reprint_log enable row level security;
create index if not exists idx_reprint_log_document on public.production_reprint_log (document_id);

-- =========================================================================
-- 5. RLS — every production table gated by manage_production (default-deny).
--    service-role bypasses RLS (webhook ingestion writes mail_vendor_jobs).
-- =========================================================================
do $$
declare
  t text;
  production_tables text[] := array[
    'production_batches', 'production_documents', 'mail_vendor_jobs', 'production_reprint_log'
  ];
begin
  foreach t in array production_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ops_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (private.current_user_has_fn(''manage_production'')) '
      || 'with check (private.current_user_has_fn(''manage_production''))',
      t || '_ops_all', t
    );
  end loop;
end $$;

-- =========================================================================
-- 6. updated_at triggers on the mutable production tables.
-- =========================================================================
do $$
declare
  t text;
  mutable_tables text[] := array['production_batches', 'production_documents'];
begin
  foreach t in array mutable_tables loop
    execute format('drop trigger if exists %I on public.%I', 'set_updated_at_' || t, t);
    execute format(
      'create trigger %I before update on public.%I '
      || 'for each row execute function public.set_updated_at()',
      'set_updated_at_' || t, t
    );
  end loop;
end $$;

-- =========================================================================
-- 7. Indexes for historical search (by batch name, external id, company,
--    product, repair customer) — the v1.3 Historical Production access paths.
-- =========================================================================
create index if not exists idx_production_batches_company on public.production_batches (company_id);
create index if not exists idx_production_batches_status on public.production_batches (status);
create index if not exists idx_production_batches_name on public.production_batches (lower(name));
create index if not exists idx_production_documents_batch on public.production_documents (batch_id);
create index if not exists idx_production_documents_company on public.production_documents (company_id);
create index if not exists idx_production_documents_customer on public.production_documents (repair_customer_id);
create index if not exists idx_production_documents_external on public.production_documents (external_id);
create index if not exists idx_production_documents_status on public.production_documents (status);
