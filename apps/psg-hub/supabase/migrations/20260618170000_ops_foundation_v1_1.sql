-- Phase 15 / 15-00 — v1.1 Ops Foundation (spine). [PSG-25]
-- The internal-ops backbone every other ops milestone depends on. Greenfield from
-- the Advantage tech-design spec (projects/psg-hub/PLANNING.md §Ops backbone v1.1).
--
-- Builds on the v0.2 RBAC/RLS spine (06-02): default-deny RLS on every table.
-- Ops tables are gated by private.current_user_has_fn('<capability>') so a
-- psg_internal user only reaches a module their security profile grants; a
-- psg_superadmin passes every check; service-role bypasses RLS for ingestion.
--
-- Capability vocabulary used by these policies:
--   manage_companies  -> companies, employees, company_programs, repair_customers,
--                        repair_orders, estimates, import_templates
--   manage_sysconfig  -> products, items, vehicles, insurance_companies,
--                        insurance_agents  (System Configuration master data)
--
-- Security-profile reconciliation (naming): 06-02 shipped a PER-USER
-- public.security_profiles(profile_id, functions_jsonb) that the helper already
-- reads (the "legacy fast-path"). v1.1 adds the NAMED reusable-profile model the
-- Advantage spec calls for as public.security_profile_defs (catalog) +
-- public.user_security_profile_assignments (membership). current_user_has_fn is
-- extended below to honor BOTH the legacy per-user grant and any assigned named
-- profile — additive, non-breaking. v1.5 Superadmin Matrix builds its editor UI
-- on these two tables.
--
-- Idempotent (create if not exists / create or replace / drop-if-exists policy).
-- Rollback: drop the tables created here, drop trigger fn public.set_updated_at(),
--   and restore current_user_has_fn to its 06-02 (rbac_helpers) definition.

-- =========================================================================
-- 0. Shared updated_at trigger (reusable; ops tables are mutable in-hub).
-- =========================================================================
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- 1. Named security profiles (catalog + per-user assignment) + helper upgrade.
-- =========================================================================
create table if not exists public.security_profile_defs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_builtin boolean not null default false,
  functions_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.security_profile_defs enable row level security;

create table if not exists public.user_security_profile_assignments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  security_profile_id uuid not null references public.security_profile_defs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, security_profile_id)
);
alter table public.user_security_profile_assignments enable row level security;

-- Built-in Administrator profile: grants every v1.1 ops capability.
insert into public.security_profile_defs (name, is_builtin, functions_jsonb)
values (
  'Administrator',
  true,
  jsonb_build_object(
    'manage_companies', true,
    'manage_sysconfig', true,
    'manage_users', true,
    'manage_reports', true,
    'manage_production', true
  )
)
on conflict (name) do nothing;

-- Extend the ops capability check: superadmin OR (psg_internal AND
--   legacy per-user functions_jsonb ? fn OR any ASSIGNED named def ? fn).
-- Supersedes the 06-02 rbac_helpers definition (behavior is a strict superset).
create or replace function private.current_user_has_fn(fn text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.app_user_roles r
    where r.profile_id = (select auth.uid())
      and (
        r.role = 'psg_superadmin'
        or (
          r.role = 'psg_internal'
          and (
            -- legacy per-user fast-path (06-02)
            coalesce(
              (select sp.functions_jsonb
                 from public.security_profiles sp
                where sp.profile_id = (select auth.uid())) ? fn,
              false
            )
            -- assigned named profiles (v1.1)
            or exists (
              select 1
              from public.user_security_profile_assignments a
              join public.security_profile_defs d on d.id = a.security_profile_id
              where a.profile_id = (select auth.uid())
                and d.functions_jsonb ? fn
            )
          )
        )
      )
  )
$$;

-- =========================================================================
-- 2. Ops core entities.
-- =========================================================================
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete set null, -- optional link to the shops registry
  name text not null,
  address jsonb not null default '{}'::jsonb,
  phone text,
  contact text,
  status text not null default 'active' check (status in ('active', 'inactive', 'prospect')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.companies enable row level security;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employees enable row level security;

create table if not exists public.repair_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  address jsonb not null default '{}'::jsonb,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.repair_customers enable row level security;

-- =========================================================================
-- 3. System Configuration master data (referenced by repair_orders below).
-- =========================================================================
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (make, model)
);
alter table public.vehicles enable row level security;

create table if not exists public.insurance_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.insurance_companies enable row level security;

create table if not exists public.insurance_agents (
  id uuid primary key default gen_random_uuid(),
  insurance_company_ids uuid[] not null default '{}',
  name text not null,
  address jsonb not null default '{}'::jsonb,
  email text,
  phone text,
  mobile text,
  fax text,
  contacts_jsonb jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.insurance_agents enable row level security;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  requirements_jsonb jsonb not null default '{}'::jsonb,
  cost_cents integer not null default 0 check (cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.items enable row level security;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  items_jsonb jsonb not null default '[]'::jsonb,
  total_cost_cents integer not null default 0 check (total_cost_cents >= 0),
  selling_price_cents integer not null default 0 check (selling_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;

-- =========================================================================
-- 4. RO / Estimate per-incident records + per-company program enrollment.
-- =========================================================================
create table if not exists public.repair_orders (
  id uuid primary key default gen_random_uuid(),
  repair_customer_id uuid not null references public.repair_customers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ro_number text not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  insurance_company_id uuid references public.insurance_companies(id) on delete set null,
  insurance_agent_id uuid references public.insurance_agents(id) on delete set null,
  total_loss_flag boolean not null default false,
  status text not null default 'open' check (status in ('open', 'preview', 'cancelled', 'closed')),
  dates_json jsonb not null default '{}'::jsonb,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ro_number)
);
alter table public.repair_orders enable row level security;

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  repair_customer_id uuid not null references public.repair_customers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  estimate_number text not null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, estimate_number)
);
alter table public.estimates enable row level security;

create table if not exists public.company_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  customizations_jsonb jsonb not null default '{}'::jsonb, -- logo, header, footer, greeting
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_id)
);
alter table public.company_programs enable row level security;

-- =========================================================================
-- 5. RO / Estimate import templates (absorbs psg-import field-mapping logic).
-- =========================================================================
create table if not exists public.import_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('ro', 'estimate')),
  name text not null,
  field_mapping_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name)
);
alter table public.import_templates enable row level security;

-- =========================================================================
-- 6. Default-deny RLS policies — every ops/master table gated by capability.
--    for all to authenticated using/with check (current_user_has_fn(<cap>)).
--    No policy => no anon access; service-role bypasses RLS for ingestion.
-- =========================================================================
do $$
declare
  t text;
  manage_companies_tables text[] := array[
    'companies', 'employees', 'repair_customers', 'repair_orders',
    'estimates', 'company_programs', 'import_templates'
  ];
  manage_sysconfig_tables text[] := array[
    'products', 'items', 'vehicles', 'insurance_companies', 'insurance_agents'
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

  foreach t in array manage_sysconfig_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ops_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (private.current_user_has_fn(''manage_sysconfig'')) '
      || 'with check (private.current_user_has_fn(''manage_sysconfig''))',
      t || '_ops_all', t
    );
  end loop;
end $$;

-- Named-profile catalog + assignments: superadmin-only read/write from the app
-- (psg_internal reaches their effective capabilities via current_user_has_fn,
-- not by reading the catalog). v1.5 Superadmin Matrix manages these.
drop policy if exists security_profile_defs_superadmin on public.security_profile_defs;
create policy security_profile_defs_superadmin on public.security_profile_defs
  for all to authenticated
  using (private.current_user_role() = 'psg_superadmin')
  with check (private.current_user_role() = 'psg_superadmin');

drop policy if exists user_security_profile_assignments_superadmin on public.user_security_profile_assignments;
create policy user_security_profile_assignments_superadmin on public.user_security_profile_assignments
  for all to authenticated
  using (private.current_user_role() = 'psg_superadmin')
  with check (private.current_user_role() = 'psg_superadmin');

-- =========================================================================
-- 7. updated_at triggers on every mutable ops table.
-- =========================================================================
do $$
declare
  t text;
  all_tables text[] := array[
    'security_profile_defs', 'companies', 'employees', 'repair_customers',
    'repair_orders', 'estimates', 'company_programs', 'import_templates',
    'products', 'items', 'vehicles', 'insurance_companies', 'insurance_agents'
  ];
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

-- =========================================================================
-- 8. Helpful indexes for list/detail/search access paths.
-- =========================================================================
create index if not exists idx_employees_company on public.employees (company_id);
create index if not exists idx_repair_customers_company on public.repair_customers (company_id);
create index if not exists idx_repair_orders_company on public.repair_orders (company_id);
create index if not exists idx_repair_orders_customer on public.repair_orders (repair_customer_id);
create index if not exists idx_estimates_company on public.estimates (company_id);
create index if not exists idx_estimates_customer on public.estimates (repair_customer_id);
create index if not exists idx_company_programs_company on public.company_programs (company_id);
create index if not exists idx_import_templates_company on public.import_templates (company_id);
create index if not exists idx_user_secprofile_assign_profile on public.user_security_profile_assignments (profile_id);
