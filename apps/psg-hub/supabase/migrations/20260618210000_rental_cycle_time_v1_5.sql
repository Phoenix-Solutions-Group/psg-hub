-- Phase 15 / v1.5 — Rental + cycle-time data source for rental-car-analysis. [PSG-96]
-- The last unwired Survey & CSI report (rental-car-analysis, columns:
-- shop, insurer, rentalDays, cycleTime, cost) needs a data source that neither
-- PSG-25 (ops spine) nor PSG-89 (survey attribution, 20260618200000_survey_attribution_v1_4)
-- provides. This migration lands it so the report can flip off sample data in
-- src/lib/ops/reports/live/survey.ts (rentalCarAnalysisRun).
--
-- Where each column comes from after this lands:
--   shop       -> repair_orders.company_id  -> companies.name           (spine, PSG-25)
--   insurer    -> repair_orders.insurance_company_id -> insurance_companies.name (spine, PSG-25)
--   rentalDays -> public.rental_assignments.rental_days   (THIS migration)
--   cost       -> public.rental_assignments.rental_cost   (THIS migration)
--   cycleTime  -> DERIVED from repair_orders.dates_json (date_in / date_out) — see §2.
--
-- Model rationale (rental_assignments table, NOT columns on repair_orders):
-- a rental is an insurer/rental-side fact that exists for only SOME ROs (DRP /
-- rental-eligible jobs), carries its own provider + dates + charge, and an RO can
-- in principle have more than one assignment (extension / swap). A normalized
-- table keyed by repair_order_id is therefore the right shape — the same call
-- v1.4 made for repair_order_employees / survey_dispatches — and keeps the hot
-- repair_orders row lean. Cycle time needs NO new storage: the RO in/out dates
-- already live in repair_orders.dates_json (written by the ops import,
-- src/lib/ops/import/index.ts: keys `date_in` / `date_out`).
--
-- RLS posture: rental_assignments mirrors repair_orders / v1.4 exactly —
-- default-deny, gated by private.current_user_has_fn('manage_companies'). Reports
-- read it through the service-role client (createServiceClient, bypasses RLS)
-- behind requireOpsFn('manage_reports') routes; direct authenticated access is
-- capability-scoped.
--
-- Import idempotency (PSG mandate): rental_assignments carries a deterministic
-- `rental_ref` natural key with a UNIQUE constraint, so the rental-import upserts
-- ON CONFLICT (rental_ref) and re-imports never duplicate rental days/cost.
--
-- Idempotent + re-runnable (create table if not exists / drop-if-exists policy).
-- ZERO data written — pilot rows live in the dedicated seed
-- apps/psg-hub/supabase/seeds/rental_cycle_time_pilot.sql.
-- Rollback: drop table public.rental_assignments.

-- =========================================================================
-- 1. rental_assignments — one row per rental issued against an RO.
--    rental_days  = billed rental duration (the insurer/rental-side number; may
--                   differ from the shop cycle time, which is the whole point of
--                   the report).
--    rental_cost  = total rental charge for the assignment (currency, 2dp).
--    start_date   = rental pickup date (NOT NULL — the period-scoping date, the
--                   same role survey_dispatches.sent_date plays in v1.4).
--    end_date     = rental return date (nullable: open / not-yet-returned).
--    company_id   = denormalized shop link for convenience/scoping; the
--                   authoritative shop is still repair_orders.company_id.
-- =========================================================================
create table if not exists public.rental_assignments (
  id uuid primary key default gen_random_uuid(),
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  rental_provider text,
  rental_days integer not null default 0 check (rental_days >= 0),
  rental_cost numeric(12, 2) not null default 0 check (rental_cost >= 0),
  start_date date not null,
  end_date date,
  -- Deterministic idempotency key for the rental import (e.g.
  -- '<ro_number>:<start_date>'). UNIQUE → upsert never double-counts.
  rental_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_ref)
);
alter table public.rental_assignments enable row level security;

create index if not exists idx_rental_assignments_repair_order
  on public.rental_assignments (repair_order_id);
create index if not exists idx_rental_assignments_company_start
  on public.rental_assignments (company_id, start_date);

-- =========================================================================
-- 2. Cycle time — DERIVED, no storage. repair_orders.dates_json (jsonb) carries
--    the in/out dates the ops import writes:
--        { "date_in": "YYYY-MM-DD", "date_out": "YYYY-MM-DD" }
--    cycleTime (days in shop) = (date_out - date_in). The report computes this in
--    JS (rentalCarAnalysisRun) so a missing/partial pair simply yields a null
--    cycle time for that RO without dropping its rental days/cost. This block is
--    documentation only — it asserts the keys exist on the jsonb shape and makes
--    the contract greppable; it writes nothing.
-- =========================================================================
comment on column public.repair_orders.dates_json is
  'RO milestone dates (jsonb). Keys: date_in / date_out (YYYY-MM-DD). '
  'cycleTime for rental-car-analysis (PSG-96) = date_out - date_in (days).';

-- =========================================================================
-- 3. Default-deny RLS — gated by manage_companies (mirrors repair_orders in
--    20260618170000_ops_foundation_v1_1 and the v1.4 attribution tables). No
--    anon access; service-role bypasses for report reads + import writes.
-- =========================================================================
do $$
declare
  t text;
  manage_companies_tables text[] := array['rental_assignments'];
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
-- 4. updated_at trigger (reuse public.set_updated_at from ops foundation).
-- =========================================================================
do $$
declare
  t text;
  all_tables text[] := array['rental_assignments'];
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
