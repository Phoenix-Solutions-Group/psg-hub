-- Migration: close blanket-allow RLS on 12 shared multi-tenant public tables
-- Phase 8 / 08-02. Resolves D3 (deferred from 06-01).
--
-- WHY: each of the 12 tables below carried a pair of blanket policies
--   "Allow all for anon"          ALL  to anon          using(true) with check(true)
--   "Allow all for authenticated" ALL  to authenticated using(true) with check(true)
-- The `authenticated` half is a cross-tenant breach: any logged-in user could
-- read/write every shop's rows. This drops both, per the 06-01 PROTOCOL +
-- CHECKLIST, and installs scoped replacements where a live reader needs them.
--
-- VERDICT (operator 2026-06-03): deny-all-9 + profiles option A.
--   shops    -> drop blanket; retighten existing scoped survivors to authenticated
--   clients  -> drop blanket; default-deny (psg-hub writes via service-role only)
--   profiles -> drop blanket; self-row SELECT/UPDATE + psg_superadmin read
--   9 sibling/agentic tables (empty/stale, zero psg-hub refs, apps retired)
--            -> drop blanket; default-deny (RLS-on, no policy = service-role-only)
--
-- ROLLBACK (no auto-down). To restore a dropped blanket on table <t>:
--   create policy "Allow all for anon" on public.<t>
--     for all to anon using (true) with check (true);
--   create policy "Allow all for authenticated" on public.<t>
--     for all to authenticated using (true) with check (true);
-- To revert the scoped replacements, drop the policies created in sections
-- "shops scoped survivors" and "profiles self-row + superadmin" below.

-- =========================================================================
-- 1. Drop the blanket "Allow all" pair on all 12 in-scope tables
-- =========================================================================
drop policy if exists "Allow all for anon"          on public.shops;
drop policy if exists "Allow all for authenticated" on public.shops;
drop policy if exists "Allow all for anon"          on public.clients;
drop policy if exists "Allow all for authenticated" on public.clients;
drop policy if exists "Allow all for anon"          on public.profiles;
drop policy if exists "Allow all for authenticated" on public.profiles;
drop policy if exists "Allow all for anon"          on public.campaigns;
drop policy if exists "Allow all for authenticated" on public.campaigns;
drop policy if exists "Allow all for anon"          on public.configs;
drop policy if exists "Allow all for authenticated" on public.configs;
drop policy if exists "Allow all for anon"          on public.activity_log;
drop policy if exists "Allow all for authenticated" on public.activity_log;
drop policy if exists "Allow all for anon"          on public.discovery_briefs;
drop policy if exists "Allow all for authenticated" on public.discovery_briefs;
drop policy if exists "Allow all for anon"          on public.elements;
drop policy if exists "Allow all for authenticated" on public.elements;
drop policy if exists "Allow all for anon"          on public.pages;
drop policy if exists "Allow all for authenticated" on public.pages;
drop policy if exists "Allow all for anon"          on public.research_artifacts;
drop policy if exists "Allow all for authenticated" on public.research_artifacts;
drop policy if exists "Allow all for anon"          on public.skills;
drop policy if exists "Allow all for authenticated" on public.skills;
drop policy if exists "Allow all for anon"          on public.reviews;
drop policy if exists "Allow all for authenticated" on public.reviews;

-- =========================================================================
-- 2. Keep RLS enabled (default-deny) on every remediated table.
--    RLS was already enabled (the tables carried policies); these are
--    idempotent no-ops that guarantee no exposure window remains.
-- =========================================================================
alter table public.shops              enable row level security;
alter table public.clients            enable row level security;
alter table public.profiles           enable row level security;
alter table public.campaigns          enable row level security;
alter table public.configs            enable row level security;
alter table public.activity_log       enable row level security;
alter table public.discovery_briefs   enable row level security;
alter table public.elements           enable row level security;
alter table public.pages              enable row level security;
alter table public.research_artifacts enable row level security;
alter table public.skills             enable row level security;
alter table public.reviews            enable row level security;

-- =========================================================================
-- 3. shops — retighten the scoped survivors from {public} to {authenticated}
--    (same quals; member sees only shops in user_shop_ids(); anon denied)
--    Service-role reads bypass RLS. Onboarding INSERT is service-role -> no
--    scoped INSERT policy needed.
-- =========================================================================
drop policy if exists "shops_select" on public.shops;
create policy "shops_select" on public.shops
  for select to authenticated
  using (id in (select user_shop_ids()));

drop policy if exists "shops_update" on public.shops;
create policy "shops_update" on public.shops
  for update to authenticated
  using (id in (select user_shop_ids()))
  with check (id in (select user_shop_ids()));

-- =========================================================================
-- 4. profiles — self-row SELECT/UPDATE + psg_superadmin read (option A)
--    profiles.id == auth.uid() (W4). handle_new_user is SECURITY DEFINER
--    (bypasses RLS) -> no INSERT policy needed.
-- =========================================================================
drop policy if exists "profiles_select_self_or_superadmin" on public.profiles;
create policy "profiles_select_self_or_superadmin" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.current_user_role() = 'psg_superadmin'
  );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- clients: no replacement policy (default-deny; service-role only).
-- 9 sibling/agentic tables: no replacement policy (default-deny).
