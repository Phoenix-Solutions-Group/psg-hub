-- Phase 15 / v1.4 — Survey attribution + response-rate/recommend data model. [PSG-89]
-- Adds the survey-side joins + capture fields the remaining 5 Survey & CSI
-- reports (estimator-csi, body-tech-performance, painter-performance,
-- performance-dashboard, rental-car-analysis denominators) need before they can
-- be wired off sample data in src/lib/ops/reports/live/survey.ts (PSG-80).
--
-- Background: PSG-25 (20260618170000_ops_foundation_v1_1) landed the relational
-- spine — companies / employees / repair_orders(ro_number) / estimates — but
-- public.survey_responses (legacy, 20260602105554_remote_schema: bigint id keyed
-- on shop_name text) carries NO join column to that spine. This migration adds
-- the missing edges:
--
--   1. survey_responses → repair_orders         (survey_responses.repair_order_id)
--   2. repair_orders   → employees (by role)    (public.repair_order_employees)
--   3. surveys SENT (response-rate denominator)  (public.survey_dispatches)
--   4. would_recommend capture                  (survey_responses.would_recommend)
--
-- Attribution model rationale: an RO has up to one estimator + one body tech +
-- one painter (and possibly a CSR), and the reports group CSI/jobs BY that role,
-- so a normalized (repair_order_id, employee_id, role) bridge is the right shape
-- rather than three nullable FKs on repair_orders. The per-row `rework` flag is
-- the single source for both the body-tech "comeback rate" and painter "redo
-- rate" (same concept, viewed per role).
--
-- RLS posture: repair_order_employees + survey_dispatches mirror repair_orders
-- exactly — default-deny, gated by private.current_user_has_fn('manage_companies').
-- Reports read them through the service-role client (createServiceClient, which
-- bypasses RLS) behind requireOpsFn('manage_reports') routes; direct authenticated
-- access is capability-scoped. survey_responses keeps its existing legacy RLS
-- (portal_users-based, 20260602105554) — this migration only ADDS columns to it.
--
-- Import idempotency (PSG mandate): survey_dispatches carries a deterministic
-- `dispatch_ref` natural key with a UNIQUE constraint, so the survey-send import
-- upserts ON CONFLICT (dispatch_ref) and re-imports never duplicate denominators.
--
-- Idempotent + re-runnable (add column if not exists / create table if not exists
-- / drop-if-exists policy). ZERO data written — pilot rows live in the dedicated
-- seed apps/psg-hub/supabase/seeds/survey_attribution_pilot.sql.
-- Rollback: drop public.survey_dispatches; drop public.repair_order_employees;
--   alter table public.survey_responses drop column would_recommend, ro_number,
--   repair_order_id.

-- =========================================================================
-- 1. survey_responses: survey → RO link + recommend capture.
--    repair_order_id is the authoritative resolved edge (FK to the spine);
--    ro_number is the human-readable echo carried from the survey source so the
--    link is verifiable even before/without resolution. would_recommend backs
--    the performance-dashboard "Would Recommend" rate (nullable: not every
--    survey answers it).
-- =========================================================================
alter table public.survey_responses
  add column if not exists repair_order_id uuid
    references public.repair_orders(id) on delete set null;
alter table public.survey_responses
  add column if not exists ro_number text;
alter table public.survey_responses
  add column if not exists would_recommend boolean;

create index if not exists idx_survey_responses_repair_order
  on public.survey_responses (repair_order_id);
create index if not exists idx_survey_responses_ro_number
  on public.survey_responses (ro_number);

-- =========================================================================
-- 2. repair_order_employees — RO ↔ employee attribution bridge (by role).
--    estimator-csi      -> role = 'estimator'
--    body-tech-perf     -> role = 'body_tech' (jobs = count, comeback = rework)
--    painter-perf       -> role = 'painter'   (jobs = count, redo     = rework)
--    PK (repair_order_id, role, employee_id) permits >1 employee per role per RO
--    while keeping a given (RO, role, employee) edge unique → idempotent upsert.
-- =========================================================================
create table if not exists public.repair_order_employees (
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text not null
    check (role in ('estimator', 'body_tech', 'painter', 'csr', 'other')),
  -- This employee's work on this RO required rework (body-tech comeback /
  -- painter redo). Single source for both report rates.
  rework boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repair_order_id, role, employee_id)
);
alter table public.repair_order_employees enable row level security;

create index if not exists idx_repair_order_employees_employee
  on public.repair_order_employees (employee_id);
create index if not exists idx_repair_order_employees_role
  on public.repair_order_employees (role);

-- =========================================================================
-- 3. survey_dispatches — one row per survey SENT (the surveys_sent denominator).
--    Response rate (performance-dashboard) = returned (count of survey_responses)
--    / sent (count of survey_dispatches), grouped by shop_name over the period.
--    Keyed on shop_name to match survey_responses (which keys on shop_name, not
--    companies.id); company_id/repair_order_id are optional resolved links.
-- =========================================================================
create table if not exists public.survey_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  shop_name text not null,
  repair_order_id uuid references public.repair_orders(id) on delete set null,
  ro_number text,
  sent_date date not null,
  channel text not null default 'email'
    check (channel in ('email', 'sms', 'mail', 'other')),
  -- Set once/if a response arrives; matches survey_responses.response_id.
  response_id text,
  -- Deterministic idempotency key for the survey-send import (e.g.
  -- '<shop>:<ro_number>:<sent_date>'). UNIQUE → upsert never double-counts.
  dispatch_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_ref)
);
alter table public.survey_dispatches enable row level security;

create index if not exists idx_survey_dispatches_shop_date
  on public.survey_dispatches (shop_name, sent_date);
create index if not exists idx_survey_dispatches_repair_order
  on public.survey_dispatches (repair_order_id);

-- =========================================================================
-- 4. Default-deny RLS — both new tables gated by manage_companies (mirrors
--    repair_orders in 20260618170000_ops_foundation_v1_1). No anon access;
--    service-role bypasses for report reads + import writes.
-- =========================================================================
do $$
declare
  t text;
  manage_companies_tables text[] := array[
    'repair_order_employees', 'survey_dispatches'
  ];
begin
  foreach t in array manage_companies_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ops_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (private.current_user_has_fn(''manage_companies'')) '
      || 'with check (private.current_user_has_fn(''manage_companies''))',
      t || '_ops_all', t
    );
  end loop;
end $$;

-- =========================================================================
-- 5. updated_at triggers (reuse public.set_updated_at from ops foundation).
-- =========================================================================
do $$
declare
  t text;
  all_tables text[] := array['repair_order_employees', 'survey_dispatches'];
begin
  foreach t in array all_tables loop
    execute format('drop trigger if exists %I on public.%I', 'set_updated_at_' || t, t);
    execute format(
      'create trigger %I before update on public.%I '
      || 'for each row execute function public.set_updated_at()',
      'set_updated_at_' || t, t
    );
  end loop;
end $$;
