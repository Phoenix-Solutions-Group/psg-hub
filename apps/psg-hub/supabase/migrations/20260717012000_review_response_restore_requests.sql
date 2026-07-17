-- PSG-1719 — Review response version history and PSG-approved restores.
-- Customers can request an older review response version, but only PSG staff can
-- approve the restore. Approval creates a new active version instead of
-- overwriting history.

alter table public.review_responses
  add column if not exists restored_from_request_id uuid,
  add column if not exists restored_from_version integer,
  add column if not exists restored_by uuid,
  add column if not exists restored_at timestamptz;

create table if not exists public.review_response_versions (
  id uuid primary key default gen_random_uuid(),
  review_response_id uuid not null references public.review_responses(id) on delete cascade,
  review_item_id uuid not null references public.review_items(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  version integer not null,
  draft_text text,
  status text not null,
  tone_preset text,
  model_id text,
  prompt_version text,
  safety_flags text[] not null default '{}'::text[],
  safety_overridden boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  restored_from_request_id uuid,
  restored_from_version integer,
  restored_by uuid,
  restored_at timestamptz,
  recorded_at timestamptz not null default now(),
  unique (review_response_id, version)
);

create table if not exists public.review_response_restore_requests (
  id uuid primary key default gen_random_uuid(),
  review_response_id uuid not null references public.review_responses(id) on delete cascade,
  review_item_id uuid not null references public.review_items(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  requested_version integer not null,
  status text not null default 'pending',
  reason text,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_response_restore_requests_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create unique index if not exists review_response_restore_requests_one_pending
  on public.review_response_restore_requests (review_response_id, requested_version)
  where status = 'pending';

create index if not exists review_response_versions_review_item_idx
  on public.review_response_versions (review_item_id, version desc);

create index if not exists review_response_restore_requests_shop_status_idx
  on public.review_response_restore_requests (shop_id, status, requested_at desc);

create or replace function public.snapshot_review_response_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.review_response_versions (
    review_response_id,
    review_item_id,
    shop_id,
    version,
    draft_text,
    status,
    tone_preset,
    model_id,
    prompt_version,
    safety_flags,
    safety_overridden,
    approved_by,
    approved_at,
    restored_from_request_id,
    restored_from_version,
    restored_by,
    restored_at,
    recorded_at
  )
  values (
    new.id,
    new.review_item_id,
    new.shop_id,
    new.version,
    new.draft_text,
    new.status,
    new.tone_preset,
    new.model_id,
    new.prompt_version,
    coalesce(new.safety_flags, '{}'::text[]),
    coalesce(new.safety_overridden, false),
    new.approved_by,
    new.approved_at,
    new.restored_from_request_id,
    new.restored_from_version,
    new.restored_by,
    new.restored_at,
    now()
  )
  on conflict (review_response_id, version) do update set
    draft_text = excluded.draft_text,
    status = excluded.status,
    tone_preset = excluded.tone_preset,
    model_id = excluded.model_id,
    prompt_version = excluded.prompt_version,
    safety_flags = excluded.safety_flags,
    safety_overridden = excluded.safety_overridden,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    restored_from_request_id = excluded.restored_from_request_id,
    restored_from_version = excluded.restored_from_version,
    restored_by = excluded.restored_by,
    restored_at = excluded.restored_at,
    recorded_at = excluded.recorded_at;

  return new;
end;
$$;

drop trigger if exists review_responses_version_snapshot on public.review_responses;
create trigger review_responses_version_snapshot
after insert or update on public.review_responses
for each row execute function public.snapshot_review_response_version();

drop trigger if exists review_response_restore_requests_updated_at on public.review_response_restore_requests;
create trigger review_response_restore_requests_updated_at
before update on public.review_response_restore_requests
for each row execute function public.set_updated_at();

alter table public.review_response_versions enable row level security;
alter table public.review_response_restore_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'review_response_versions'
      and policyname = 'review_response_versions_select'
  ) then
    create policy review_response_versions_select
      on public.review_response_versions
      for select
      using (shop_id in (select public.user_shop_ids()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'review_response_restore_requests'
      and policyname = 'review_response_restore_requests_select'
  ) then
    create policy review_response_restore_requests_select
      on public.review_response_restore_requests
      for select
      using (shop_id in (select public.user_shop_ids()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'review_response_restore_requests'
      and policyname = 'review_response_restore_requests_insert'
  ) then
    create policy review_response_restore_requests_insert
      on public.review_response_restore_requests
      for insert
      with check (
        shop_id in (select public.user_shop_ids())
        and requested_by = auth.uid()
        and status = 'pending'
        and decided_by is null
        and decided_at is null
      );
  end if;
end$$;

grant select on table public.review_response_versions to authenticated;
grant select, insert on table public.review_response_restore_requests to authenticated;
grant all on table public.review_response_versions to service_role;
grant all on table public.review_response_restore_requests to service_role;
