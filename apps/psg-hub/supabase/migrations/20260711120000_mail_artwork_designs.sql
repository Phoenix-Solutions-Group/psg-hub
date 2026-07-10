-- PSG-870 — persist freeform mail-artwork design drafts.
-- Stores editor snapshots and a parallel Phase-1 design document payload so PSG-only
-- artwork work can resume after a refresh and feed the existing renderer pipeline.

create table if not exists public.mail_artwork_designs (
  id uuid primary key default gen_random_uuid(),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  name text not null default 'Draft',
  size text not null default '4x6' check (size in ('4x6', '6x9')),
  front_state jsonb not null default '{}'::jsonb,
  back_state jsonb not null default '{}'::jsonb,
  phase1_document jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pass'
    check (validation_status in ('pass', 'warn', 'blocked')),
  validation_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mail_artwork_designs enable row level security;

-- PSG users with the design_mail_artwork capability can list their saved drafts,
-- create new draft rows, and update/delete their own as needed by the editor.
-- Service-role is still required for schema-changing tooling, and keeps RLS bypass.
do $$
begin
  drop policy if exists mail_artwork_designs_owner_all on public.mail_artwork_designs;
  execute 'create policy mail_artwork_designs_owner_all on public.mail_artwork_designs for all to authenticated '
    || 'using (private.current_user_has_fn(''design_mail_artwork'')) '
    || 'with check (private.current_user_has_fn(''design_mail_artwork''))';
end $$;

create index if not exists idx_mail_artwork_designs_profile_updated
  on public.mail_artwork_designs (created_by_profile_id, updated_at desc);

-- Keep mutable timestamp current.
do $$
begin
  drop trigger if exists set_updated_at_mail_artwork_designs on public.mail_artwork_designs;
  execute 'create trigger set_updated_at_mail_artwork_designs before update on public.mail_artwork_designs '
    || 'for each row execute function public.set_updated_at()';
end $$;
