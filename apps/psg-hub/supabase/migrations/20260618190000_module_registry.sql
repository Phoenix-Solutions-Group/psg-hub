-- v1.5 / 06-18 — Module registry + access-matrix grants (PSG-29 phase 2 data layer).
-- The access-matrix editor toggles module visibility per role / shop / user on
-- top of a tier-driven default. Spec: PLANNING.md §Data model `modules` +
-- `module_access_grants` (precedence profile > shop > role > tier default).
--
-- ADAPTED TO THE SHIPPED SPINE: the implemented RBAC uses a role ENUM
-- (app_user_roles.role in customer|psg_internal|psg_superadmin), not a `roles`
-- table. So grants carry a nullable `role` text (the enum value) rather than a
-- role_id FK. Tier slugs match src/lib/tier/gate.ts (essentials<growth<performance).
--
-- Writes are audited at the app layer via recordAuditEvent() (access_audit).
-- Idempotent. Rollback: drop table module_access_grants, modules.

-- =========================================================================
-- 1. modules — the curated registry. Seeded via the admin UI (no speculative
--    rows here: slugs/audience/tier are product decisions made in-app).
-- =========================================================================
create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  audience text not null default 'customer'
    check (audience in ('customer', 'ops', 'both')),
  -- null => no tier floor. Otherwise the customer shop tier must meet this.
  min_tier_slug text
    check (min_tier_slug is null or min_tier_slug in ('essentials', 'growth', 'performance')),
  default_visibility text not null default 'visible'
    check (default_visibility in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);
alter table public.modules enable row level security;

-- =========================================================================
-- 2. module_access_grants — explicit overrides. Exactly one scope column is
--    set per row (profile > shop > role precedence resolved in app code).
-- =========================================================================
create table if not exists public.module_access_grants (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  role text check (role is null or role in ('customer', 'psg_internal', 'psg_superadmin')),
  effect text not null check (effect in ('allow', 'deny')),
  granted_by uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  -- exactly one scope target
  constraint module_access_grants_one_scope check (
    (case when profile_id is not null then 1 else 0 end)
    + (case when shop_id is not null then 1 else 0 end)
    + (case when role is not null then 1 else 0 end) = 1
  )
);
alter table public.module_access_grants enable row level security;

-- One grant per (module, scope-target). Partial uniques per scope dimension.
create unique index if not exists module_access_grants_profile_uniq
  on public.module_access_grants (module_id, profile_id) where profile_id is not null;
create unique index if not exists module_access_grants_shop_uniq
  on public.module_access_grants (module_id, shop_id) where shop_id is not null;
create unique index if not exists module_access_grants_role_uniq
  on public.module_access_grants (module_id, role) where role is not null;

-- =========================================================================
-- 3. RLS — superadmins manage everything; authenticated may READ the module
--    catalog (needed to render nav). Grants are superadmin-only (resolution
--    runs server-side via service-role, like the other access tables).
-- =========================================================================
drop policy if exists "modules_read_authenticated" on public.modules;
create policy "modules_read_authenticated" on public.modules
  for select to authenticated using (true);

drop policy if exists "modules_write_superadmin" on public.modules;
create policy "modules_write_superadmin" on public.modules
  for all to authenticated
  using (private.current_user_role() = 'psg_superadmin')
  with check (private.current_user_role() = 'psg_superadmin');

drop policy if exists "module_access_grants_superadmin" on public.module_access_grants;
create policy "module_access_grants_superadmin" on public.module_access_grants
  for all to authenticated
  using (private.current_user_role() = 'psg_superadmin')
  with check (private.current_user_role() = 'psg_superadmin');
