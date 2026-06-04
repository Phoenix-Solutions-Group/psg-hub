-- Phase 6 / 06-02 — No-hook role resolver helpers + harden existing helpers.
-- D2 = in-DB security-definer subquery (no project-global token hook).
-- All security-definer functions live in `private` (not PostgREST-exposed) with a
-- fixed empty search_path and fully-qualified refs. Idempotent (create or replace).
-- Rollback: drop function private.current_user_role(), private.current_user_has_fn(text);
--           the 3 public helpers revert by re-running their pre-06-02 definitions.

-- Global identity resolver. NULL when the user has no app_user_roles row.
create or replace function private.current_user_role()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select role from public.app_user_roles where profile_id = (select auth.uid())
$$;

-- Ops capability check: psg_superadmin OR (psg_internal AND functions_jsonb ? fn).
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
          and coalesce(
            (select sp.functions_jsonb
               from public.security_profiles sp
              where sp.profile_id = (select auth.uid())) ? fn,
            false
          )
        )
      )
  )
$$;

-- Least-privilege: callable by authenticated (RLS policies + middleware) and service_role only.
revoke all on function private.current_user_role() from public;
revoke all on function private.current_user_has_fn(text) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_user_role() to authenticated, service_role;
grant execute on function private.current_user_has_fn(text) to authenticated, service_role;

-- Harden the 3 existing helpers: add a fixed empty search_path + fully-qualify refs.
-- Behavior is unchanged (auth.uid() wrapped as (select auth.uid()) is equivalent).
-- Clears advisor function_search_path_mutable for these three.
create or replace function public.user_shop_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select shop_id from public.shop_users where user_id = (select auth.uid())
$$;

create or replace function public.user_location_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select l.id
  from public.locations l
  where l.shop_id in (select public.user_shop_ids())
$$;

create or replace function public.user_is_shop_owner(target_shop_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_users
    where user_id = (select auth.uid())
      and shop_id = target_shop_id
      and role = 'owner'
  );
$$;
