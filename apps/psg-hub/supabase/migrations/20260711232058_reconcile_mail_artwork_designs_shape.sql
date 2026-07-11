-- PSG-1208 — reconcile production mail_artwork_designs with the saved-draft editor.
-- Production already had the PSG-870 foundation table shape from an earlier
-- migration, so the later create-table-if-missing migration did not add the
-- draft columns used by /api/ops/production/artwork.

alter table public.mail_artwork_designs
  add column if not exists name text not null default 'Draft',
  add column if not exists size text not null default '4x6',
  add column if not exists front_state jsonb not null default '{}'::jsonb,
  add column if not exists back_state jsonb not null default '{}'::jsonb,
  add column if not exists phase1_document jsonb not null default '{}'::jsonb,
  add column if not exists validation_status text not null default 'pass',
  add column if not exists validation_issues jsonb not null default '[]'::jsonb;

-- Earlier PSG-870 foundation columns were required for a template-version model.
-- Saved drafts do not carry those fields, so keep them for compatibility on
-- production while leaving clean databases with the newer table shape alone.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mail_artwork_designs'
      and column_name = 'company_id'
  ) then
    alter table public.mail_artwork_designs alter column company_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mail_artwork_designs'
      and column_name = 'template_key'
  ) then
    alter table public.mail_artwork_designs alter column template_key drop not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mail_artwork_designs_size_check'
      and conrelid = 'public.mail_artwork_designs'::regclass
  ) then
    alter table public.mail_artwork_designs
      add constraint mail_artwork_designs_size_check check (size in ('4x6', '6x9'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mail_artwork_designs_validation_status_check'
      and conrelid = 'public.mail_artwork_designs'::regclass
  ) then
    alter table public.mail_artwork_designs
      add constraint mail_artwork_designs_validation_status_check
      check (validation_status in ('pass', 'warn', 'blocked'));
  end if;
end $$;

alter table public.mail_artwork_designs enable row level security;

do $$
begin
  drop policy if exists mail_artwork_designs_owner_all on public.mail_artwork_designs;
  execute 'create policy mail_artwork_designs_owner_all on public.mail_artwork_designs for all to authenticated '
    || 'using (private.current_user_has_fn(''design_mail_artwork'')) '
    || 'with check (private.current_user_has_fn(''design_mail_artwork''))';
end $$;

grant select, insert, update, delete on table public.mail_artwork_designs to authenticated, service_role;

create index if not exists idx_mail_artwork_designs_profile_updated
  on public.mail_artwork_designs (created_by_profile_id, updated_at desc);

do $$
begin
  drop trigger if exists set_updated_at_mail_artwork_designs on public.mail_artwork_designs;
  execute 'create trigger set_updated_at_mail_artwork_designs before update on public.mail_artwork_designs '
    || 'for each row execute function public.set_updated_at()';
end $$;
