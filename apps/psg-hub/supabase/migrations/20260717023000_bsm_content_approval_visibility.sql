-- PSG-1717 — BSM content approval visibility and permission rules.
--
-- Business rule: customer/shop users may only see approval records attached to
-- their own shop, and they must never see PSG-private notes. PSG internal users
-- can see the full approval record for operational review.
--
-- First-release visibility vocabulary:
--   - shop         = visible to the customer group for the content item's shop
--   - psg_internal = PSG/admin-only; hidden from shop/account users
--
-- The same visibility rule is applied to every approval-adjacent record type so
-- future API routes inherit tenant-safe defaults instead of re-implementing the
-- rule in each handler.

create schema if not exists private;

create or replace function private.current_user_is_psg()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(private.current_user_role(), '') in ('psg_internal', 'psg_superadmin')
$$;

create or replace function private.user_can_read_content_approval_record(
  target_content_item_id uuid,
  record_visibility text
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    private.current_user_is_psg()
    or (
      record_visibility = 'shop'
      and exists (
        select 1
        from public.content_items ci
        where ci.id = target_content_item_id
          and ci.shop_id in (select public.user_shop_ids())
      )
    )
$$;

revoke all on function private.current_user_is_psg() from public;
revoke all on function private.user_can_read_content_approval_record(uuid, text) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_user_is_psg() to authenticated, service_role;
grant execute on function private.user_can_read_content_approval_record(uuid, text) to authenticated, service_role;

create table if not exists public.content_approval_files (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  file_name text not null,
  file_url text not null,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_approval_comments (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  body text not null check (length(trim(body)) > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  decision text not null check (decision in ('approved', 'changes_requested', 'rejected', 'restored', 'archived')),
  decision_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);

create table if not exists public.content_approval_versions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  version_number integer not null check (version_number > 0),
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_item_id, version_number)
);

create table if not exists public.content_approval_restore_requests (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  requested_version_id uuid references public.content_approval_versions(id) on delete set null,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed')),
  requested_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.content_approval_archives (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  approved_decision_id uuid references public.content_approval_decisions(id) on delete set null,
  visibility text not null default 'shop'
    check (visibility in ('shop', 'psg_internal')),
  archived_payload jsonb not null default '{}'::jsonb,
  archived_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz not null default now()
);

create index if not exists idx_content_approval_files_item
  on public.content_approval_files (content_item_id, created_at desc);
create index if not exists idx_content_approval_comments_item
  on public.content_approval_comments (content_item_id, created_at desc);
create index if not exists idx_content_approval_decisions_item
  on public.content_approval_decisions (content_item_id, decided_at desc);
create index if not exists idx_content_approval_versions_item
  on public.content_approval_versions (content_item_id, version_number desc);
create index if not exists idx_content_approval_restore_requests_item
  on public.content_approval_restore_requests (content_item_id, requested_at desc);
create index if not exists idx_content_approval_archives_item
  on public.content_approval_archives (content_item_id, archived_at desc);

alter table public.content_approval_files enable row level security;
alter table public.content_approval_comments enable row level security;
alter table public.content_approval_decisions enable row level security;
alter table public.content_approval_versions enable row level security;
alter table public.content_approval_restore_requests enable row level security;
alter table public.content_approval_archives enable row level security;

drop policy if exists content_approval_files_select on public.content_approval_files;
create policy content_approval_files_select on public.content_approval_files
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

drop policy if exists content_approval_comments_select on public.content_approval_comments;
create policy content_approval_comments_select on public.content_approval_comments
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

drop policy if exists content_approval_decisions_select on public.content_approval_decisions;
create policy content_approval_decisions_select on public.content_approval_decisions
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

drop policy if exists content_approval_versions_select on public.content_approval_versions;
create policy content_approval_versions_select on public.content_approval_versions
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

drop policy if exists content_approval_restore_requests_select on public.content_approval_restore_requests;
create policy content_approval_restore_requests_select on public.content_approval_restore_requests
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

drop policy if exists content_approval_archives_select on public.content_approval_archives;
create policy content_approval_archives_select on public.content_approval_archives
  for select using (private.user_can_read_content_approval_record(content_item_id, visibility));

-- Writes stay PSG-owned for this first release. Customer decision actions still
-- go through the existing checked routes, and service-role jobs can create the
-- durable approval records after those route-level checks pass.
drop policy if exists content_approval_files_psg_write on public.content_approval_files;
create policy content_approval_files_psg_write on public.content_approval_files
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop policy if exists content_approval_comments_psg_write on public.content_approval_comments;
create policy content_approval_comments_psg_write on public.content_approval_comments
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop policy if exists content_approval_decisions_psg_write on public.content_approval_decisions;
create policy content_approval_decisions_psg_write on public.content_approval_decisions
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop policy if exists content_approval_versions_psg_write on public.content_approval_versions;
create policy content_approval_versions_psg_write on public.content_approval_versions
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop policy if exists content_approval_restore_requests_psg_write on public.content_approval_restore_requests;
create policy content_approval_restore_requests_psg_write on public.content_approval_restore_requests
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop policy if exists content_approval_archives_psg_write on public.content_approval_archives;
create policy content_approval_archives_psg_write on public.content_approval_archives
  for all using (private.current_user_is_psg()) with check (private.current_user_is_psg());

drop trigger if exists set_updated_at_content_approval_comments on public.content_approval_comments;
create trigger set_updated_at_content_approval_comments
  before update on public.content_approval_comments
  for each row execute function public.set_updated_at();

grant select on public.content_approval_files to authenticated;
grant select on public.content_approval_comments to authenticated;
grant select on public.content_approval_decisions to authenticated;
grant select on public.content_approval_versions to authenticated;
grant select on public.content_approval_restore_requests to authenticated;
grant select on public.content_approval_archives to authenticated;

grant all on public.content_approval_files to service_role;
grant all on public.content_approval_comments to service_role;
grant all on public.content_approval_decisions to service_role;
grant all on public.content_approval_versions to service_role;
grant all on public.content_approval_restore_requests to service_role;
grant all on public.content_approval_archives to service_role;
