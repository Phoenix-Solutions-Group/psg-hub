-- PSG-617 (parent PSG-614) — CAPTURE-ONLY: 4 prod-only "invoicer" tables.
--
-- WHY THIS EXISTS: production carries these four tables but NO repo migration
-- creates them, so a from-scratch rebuild (`supabase db reset`) would silently
-- drop them — a disaster-recovery gap (PSG-614 finding, Workstream B).
-- They are left over from an earlier billing/invoicing effort that now lives in a
-- SEPARATE database (Supabase project `psg-invoicer`). ZERO code in psg-hub reads
-- or writes them today (verified static trace, 2026-07-07). We capture them here
-- AS-IS so a rebuild reproduces production exactly; we do NOT wire them to any
-- feature. A follow-up decision (keep vs. drop from prod) is tracked with Ada.
--
-- ALREADY PRESENT IN PROD: do not "apply" this to production — the objects exist
-- there. This file is `create ... if not exists` / `create or replace` throughout,
-- so it is safe to re-run and is a no-op against prod; its real job is to let a
-- clean rebuild (or the code-built staging clone) reproduce these objects.
--
-- Captured faithfully from prod `gylkkzmcmbdftxieyabw` (localreach) on 2026-07-07:
-- columns, defaults, CHECKs, primary keys, indexes, RLS (service_role-only), and
-- the dedicated updated_at trigger functions. These tables are internal caches
-- reached only by a service-role backend — RLS is enabled with a single
-- service_role policy, which is default-deny for every tenant/anon/authenticated
-- user (satisfies the tenant-isolation gate).
-- Idempotent + re-runnable. Rollback: drop the four tables + their three functions.

-- =========================================================================
-- Trigger functions (dedicated per prod). billing_run_history additionally
-- stamps saved_at on update; the two invoiced_* caches share one function.
-- =========================================================================
create or replace function public.set_billing_memory_decisions_updated_at()
returns trigger language plpgsql as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.set_billing_run_history_updated_at()
returns trigger language plpgsql as $function$
begin
  new.updated_at = now();
  new.saved_at = now();
  return new;
end;
$function$;

create or replace function public.set_invoiced_cache_updated_at()
returns trigger language plpgsql as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- =========================================================================
-- billing_memory_decisions — remembered per-run billing adjustments.
-- =========================================================================
create table if not exists public.billing_memory_decisions (
  id text primary key,
  kind text not null
    check (kind in ('consolidation', 'manual_addon', 'manual_credit', 'mso_rollup', 'whm_no_submission', 'item_override')),
  billing_month text not null,
  psg_ids text[] not null,
  customer_name text,
  group_name text,
  target_invoiced_customer_id bigint,
  catalog_item_id text,
  item_name text,
  quantity numeric,
  amount numeric,
  description text,
  line_id text,
  reason text,
  approved_by text,
  approved_at timestamptz,
  source_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_memory_decisions enable row level security;
create index if not exists billing_memory_decisions_billing_month_idx
  on public.billing_memory_decisions using btree (billing_month desc);
create index if not exists billing_memory_decisions_kind_idx
  on public.billing_memory_decisions using btree (kind);
create index if not exists billing_memory_decisions_psg_ids_idx
  on public.billing_memory_decisions using gin (psg_ids);
do $$
begin
  drop policy if exists "billing memory service role only" on public.billing_memory_decisions;
  create policy "billing memory service role only" on public.billing_memory_decisions
    for all to service_role using (true) with check (true);
  drop trigger if exists set_billing_memory_decisions_updated_at on public.billing_memory_decisions;
  create trigger set_billing_memory_decisions_updated_at
    before update on public.billing_memory_decisions
    for each row execute function public.set_billing_memory_decisions_updated_at();
end $$;

-- =========================================================================
-- billing_run_history — one row per billing run (status + counters + payloads).
-- =========================================================================
create table if not exists public.billing_run_history (
  run_id text primary key,
  billing_month text not null,
  status text not null
    check (status in ('draft', 'plan_approved', 'sandbox_created', 'sandbox_verified', 'live_created', 'needs_review')),
  source_file_name text,
  source_file_hash text,
  approved_fingerprint text,
  sandbox_plan_fingerprint text,
  live_plan_fingerprint text,
  approved_by text,
  approved_at timestamptz,
  approved_count integer not null default 0,
  candidate_count integer not null default 0,
  source_record_count integer not null default 0,
  invoice_total numeric not null default 0,
  sandbox_created integer not null default 0,
  sandbox_failed integer not null default 0,
  sandbox_skipped integer not null default 0,
  sandbox_pending integer not null default 0,
  live_created integer not null default 0,
  live_failed integer not null default 0,
  live_skipped integer not null default 0,
  live_pending integer not null default 0,
  run_config jsonb not null default '{}'::jsonb,
  invoice_results jsonb not null default '{}'::jsonb,
  payload_summary jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_run_history enable row level security;
create index if not exists billing_run_history_billing_month_idx
  on public.billing_run_history using btree (billing_month desc);
create index if not exists billing_run_history_saved_at_idx
  on public.billing_run_history using btree (saved_at desc);
create index if not exists billing_run_history_status_idx
  on public.billing_run_history using btree (status);
do $$
begin
  drop policy if exists "billing run history service role only" on public.billing_run_history;
  create policy "billing run history service role only" on public.billing_run_history
    for all to service_role using (true) with check (true);
  drop trigger if exists set_billing_run_history_updated_at on public.billing_run_history;
  create trigger set_billing_run_history_updated_at
    before update on public.billing_run_history
    for each row execute function public.set_billing_run_history_updated_at();
end $$;

-- =========================================================================
-- invoiced_catalog_items — cache of the Invoiced catalog, keyed per environment.
-- =========================================================================
create table if not exists public.invoiced_catalog_items (
  environment text not null
    check (environment in ('sandbox', 'live')),
  item_id text not null,
  name text not null,
  type text,
  description text,
  unit_cost numeric,
  archived boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, item_id)
);
alter table public.invoiced_catalog_items enable row level security;
create index if not exists invoiced_catalog_items_environment_synced_at_idx
  on public.invoiced_catalog_items using btree (environment, synced_at desc);
do $$
begin
  drop policy if exists "invoiced catalog cache service role only" on public.invoiced_catalog_items;
  create policy "invoiced catalog cache service role only" on public.invoiced_catalog_items
    for all to service_role using (true) with check (true);
  drop trigger if exists set_invoiced_catalog_items_updated_at on public.invoiced_catalog_items;
  create trigger set_invoiced_catalog_items_updated_at
    before update on public.invoiced_catalog_items
    for each row execute function public.set_invoiced_cache_updated_at();
end $$;

-- =========================================================================
-- invoiced_customer_cache — cache of Invoiced customers, keyed per environment.
-- =========================================================================
create table if not exists public.invoiced_customer_cache (
  environment text not null
    check (environment in ('sandbox', 'live')),
  invoiced_id bigint not null,
  psg_id text not null,
  name text not null,
  city text,
  state text,
  name_rate numeric,
  advantage_product_id text,
  web_hosting_id text,
  web_hosting_price numeric,
  web_hosting_discount numeric,
  dont_add_whm boolean,
  custom_pricing_product_id text,
  parent_invoiced_id bigint,
  monthly_billing_mso_rollup boolean,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, invoiced_id)
);
alter table public.invoiced_customer_cache enable row level security;
create index if not exists invoiced_customer_cache_environment_psg_id_idx
  on public.invoiced_customer_cache using btree (environment, psg_id);
create index if not exists invoiced_customer_cache_environment_synced_at_idx
  on public.invoiced_customer_cache using btree (environment, synced_at desc);
do $$
begin
  drop policy if exists "invoiced customer cache service role only" on public.invoiced_customer_cache;
  create policy "invoiced customer cache service role only" on public.invoiced_customer_cache
    for all to service_role using (true) with check (true);
  drop trigger if exists set_invoiced_customer_cache_updated_at on public.invoiced_customer_cache;
  create trigger set_invoiced_customer_cache_updated_at
    before update on public.invoiced_customer_cache
    for each row execute function public.set_invoiced_cache_updated_at();
end $$;
