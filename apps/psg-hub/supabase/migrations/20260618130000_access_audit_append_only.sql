-- v1.5 / 06-18 — Superadmin Matrix audit spine: append-only access_audit.
-- PSG-29 phase 3 foundation. Every admin/superadmin write (role grant/revoke,
-- shop assign, tier change, module visibility, module_access grant/deny,
-- security-profile fn grant/revoke, superadmin allowlist add/remove) records
-- one row here. Spec: PLANNING.md §Data model `access_audit` (append-only) +
-- §Security "audit log: access_audit append-only".
--
-- WHY append-only matters: an audit trail an admin can rewrite is not an audit
-- trail. RLS alone is insufficient because the app writes via SERVICE-ROLE,
-- which bypasses RLS. Append-only is therefore enforced by a TRIGGER that
-- raises on UPDATE/DELETE — triggers fire for service_role too — backed up by
-- REVOKE of update/delete from every grantee. Inserts only, forever.
--
-- Idempotent: create-if-not-exists + create-or-replace + drop-then-create
-- policies/triggers. Run-once safe.
--
-- Rollback (no auto-down):
--   drop trigger access_audit_no_mutate on public.access_audit;
--   drop function private.reject_audit_mutation();
--   drop table public.access_audit;

-- =========================================================================
-- 1. Table — actor + target(profile|shop) + action + payload + ts.
--    Both targets nullable: some actions target a profile (role grant),
--    some a shop (shop visibility), some both (assign user to shop).
-- =========================================================================
create table if not exists public.access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete set null,
  target_shop_id uuid references public.shops(id) on delete set null,
  action text not null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);

-- Audit-browser query shapes: newest-first, by-actor, by-target-user.
create index if not exists access_audit_ts_idx on public.access_audit (ts desc);
create index if not exists access_audit_actor_idx on public.access_audit (actor_profile_id, ts desc);
create index if not exists access_audit_target_profile_idx
  on public.access_audit (target_profile_id, ts desc)
  where target_profile_id is not null;

alter table public.access_audit enable row level security;

-- =========================================================================
-- 2. Append-only enforcement — reject every UPDATE/DELETE, all roles.
--    Lives in `private` (not PostgREST-exposed), empty search_path.
-- =========================================================================
create or replace function private.reject_audit_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception 'access_audit is append-only; % is not permitted', tg_op
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists access_audit_no_mutate on public.access_audit;
create trigger access_audit_no_mutate
  before update or delete on public.access_audit
  for each row execute function private.reject_audit_mutation();

-- Defense in depth: no grantee may even attempt update/delete.
revoke update, delete on public.access_audit from anon, authenticated;

-- =========================================================================
-- 3. RLS — superadmins read the trail in the `access_audit` UI; nobody else.
--    Writes go through service-role (bypasses RLS) via recordAuditEvent();
--    no INSERT policy is granted to authenticated on purpose.
-- =========================================================================
drop policy if exists "access_audit_select_superadmin" on public.access_audit;
create policy "access_audit_select_superadmin" on public.access_audit
  for select to authenticated
  using (private.current_user_role() = 'psg_superadmin');
