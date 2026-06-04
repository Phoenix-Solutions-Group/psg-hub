-- Phase 6 / 06-02 — Superadmin bootstrap (Nick only) + new-signup role default.
-- Operator decision (06-02 review): superadmins = Nick, Tina, Brian. Claire REMOVED
-- (not granted; her vestigial profiles.role='admin' is NOT rewritten, D5).
-- Brian (bfinn@) has no auth.users row yet -> the bootstrap join won't grant him now;
-- handle_new_user grants him psg_superadmin on signup (allowlist match). Tina has an
-- auth row -> granted immediately by step 2.
-- Idempotent: on conflict guards make re-runs no-ops.
-- Rollback: delete from superadmin_emails where email in (...); (app_user_roles rows persist by design);
--           restore handle_new_user to its pre-06-02 single-insert body.

-- 1) Allowlist (email-keyed; survives account recreation).
insert into public.superadmin_emails (email)
values
  ('nick@phoenixsolutionsgroup.net'),
  ('tina@phoenixsolutionsgroup.net'),
  ('bfinn@phoenixsolutionsgroup.net')
on conflict (email) do nothing;

-- 2) Grant psg_superadmin to existing profiles whose auth email is allowlisted.
insert into public.app_user_roles (profile_id, role)
select p.id, 'psg_superadmin'
from public.profiles p
join auth.users u on u.id = p.id
where u.email in (select email from public.superadmin_emails)
on conflict (profile_id) do update set role = excluded.role;

-- 3) Extend handle_new_user: keep the profiles insert; add the role grant on signup.
--    psg_superadmin if the new email is allowlisted, else customer.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = 'public'
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));

  insert into public.app_user_roles (profile_id, role)
  values (
    new.id,
    case
      when new.email in (select email from public.superadmin_emails)
      then 'psg_superadmin'
      else 'customer'
    end
  )
  on conflict (profile_id) do nothing;

  return new;
end;
$$;
