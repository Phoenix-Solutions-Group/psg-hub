-- Phase 6 / 06-02 — Authorization tables (default-deny).
-- path-A: shared project, public schema, no hook. All tables RLS-on with ZERO
-- anon/authenticated policies => service-role-only default-deny. Phase 8 may add
-- scoped read policies after the per-app anon-read audit. Idempotent; run-once safe.
-- Rollback: drop table app_user_roles, security_profiles, superadmin_emails; drop schema private if empty.

-- Helper home (NOT in the PostgREST exposed list: public, graphql_public).
create schema if not exists private;

-- The first CHECK-constrained role vocabulary (W1: none existed before).
create table if not exists public.app_user_roles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'customer'
    check (role in ('customer', 'psg_internal', 'psg_superadmin')),
  created_at timestamptz not null default now()
);
alter table public.app_user_roles enable row level security;

-- Ops capability gate (W2: greenfield). functions_jsonb keys are checked by current_user_has_fn().
create table if not exists public.security_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  functions_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.security_profiles enable row level security;

-- Superadmin allowlist (drives bootstrap + handle_new_user on signup).
create table if not exists public.superadmin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.superadmin_emails enable row level security;
