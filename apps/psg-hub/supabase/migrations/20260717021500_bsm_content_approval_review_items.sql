-- PSG-1715 - BSM content approval review items, versions, comments, decisions,
-- events, and private upload bucket.
--
-- Admin writes use the service role after the app-level
-- manage_bsm_content_approvals gate. Customer reads/writes are shop-scoped and
-- reviewer-aware so one shop can never see another shop's approval content.

alter table if exists public.bsm_content_review_items
  add column if not exists account_id uuid,
  add column if not exists source_content_item_id uuid references public.content_items (id) on delete set null,
  add column if not exists customer_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists source_kind text,
  add column if not exists title text,
  add column if not exists content_type text,
  add column if not exists status text not null default 'draft',
  add column if not exists admin_context_note text,
  add column if not exists current_version_id uuid,
  add column if not exists due_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists created_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata_jsonb jsonb not null default '{}'::jsonb;

alter table if exists public.bsm_content_review_versions
  add column if not exists review_item_id uuid references public.bsm_content_review_items (id) on delete cascade,
  add column if not exists shop_id uuid references public.shops (id) on delete cascade,
  add column if not exists version_number integer,
  add column if not exists status text not null default 'current',
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists storage_object_path text,
  add column if not exists original_filename text,
  add column if not exists version_label text,
  add column if not exists content_type text,
  add column if not exists byte_size integer,
  add column if not exists checksum_sha256 text,
  add column if not exists checksum text,
  add column if not exists preview_type text not null default 'file',
  add column if not exists generated_page_path text,
  add column if not exists source_content_item_id uuid references public.content_items (id) on delete set null,
  add column if not exists preview_url text,
  add column if not exists source_metadata_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists created_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if to_regclass('public.bsm_content_review_versions') is not null then
    execute $sql$
      update public.bsm_content_review_versions
      set
        storage_path = coalesce(storage_path, storage_object_path),
        original_filename = coalesce(original_filename, version_label),
        source_metadata_jsonb = case
          when source_metadata_jsonb <> '{}'::jsonb then source_metadata_jsonb
          else jsonb_strip_nulls(
            jsonb_build_object(
              'generatedPagePath', generated_page_path,
              'previewUrl', preview_url,
              'sourceContentItemId', source_content_item_id
            ) || snapshot_jsonb
          )
        end,
        preview_type = case
          when preview_type is not null then preview_type
          when generated_page_path is not null or preview_url is not null then 'generated_page'
          else 'file'
        end,
        content_type = coalesce(content_type, 'application/octet-stream'),
        byte_size = coalesce(byte_size, 1)
      where true
    $sql$;
  end if;
end$$;

create table if not exists public.bsm_content_review_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid,
  source_content_item_id uuid references public.content_items (id) on delete set null,
  customer_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  content_type text not null,
  status text not null default 'draft',
  admin_context_note text,
  current_version_id uuid,
  due_at timestamptz,
  sent_at timestamptz,
  archived_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata_jsonb jsonb not null default '{}'::jsonb,
  constraint bsm_content_review_items_status_check
    check (status in ('draft', 'sent', 'in_review', 'updates_requested', 'approved', 'declined', 'archived')),
  constraint bsm_content_review_items_content_type_check
    check (content_type in ('pdf', 'image', 'document', 'generated_page', 'other')),
  constraint bsm_content_review_items_context_note_length
    check (admin_context_note is null or char_length(admin_context_note) <= 3000)
);

create table if not exists public.bsm_content_review_versions (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'current',
  storage_bucket text,
  storage_path text,
  original_filename text,
  content_type text not null,
  byte_size integer not null check (byte_size > 0),
  checksum_sha256 text,
  preview_type text not null default 'file',
  source_metadata_jsonb jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint bsm_content_review_versions_unique_number unique (review_item_id, version_number),
  constraint bsm_content_review_versions_status_check
    check (status in ('current', 'superseded', 'pending_restore', 'restored')),
  constraint bsm_content_review_versions_storage_check
    check (
      storage_bucket is null
      or (
        storage_bucket = 'bsm-content-approvals'
        and storage_path ~ ('^' || shop_id::text || '/' || review_item_id::text || '/' || id::text || '/[^/]+$')
      )
    )
);

create unique index if not exists bsm_content_review_versions_one_current_idx
  on public.bsm_content_review_versions (review_item_id)
  where status = 'current';

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_current_version_fkey;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_current_version_fkey
  foreign key (current_version_id)
  references public.bsm_content_review_versions (id)
  on delete set null
  deferrable initially deferred;

create table if not exists public.bsm_content_review_reviewers (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  reviewer_role text not null default 'reviewer',
  notification_preference text not null default 'email',
  created_at timestamptz not null default now(),
  constraint bsm_content_review_reviewers_role_check
    check (reviewer_role in ('reviewer', 'viewer')),
  constraint bsm_content_review_reviewers_notification_check
    check (notification_preference in ('email', 'in_app', 'both', 'none')),
  constraint bsm_content_review_reviewers_unique_profile unique (review_item_id, profile_id)
);

create table if not exists public.bsm_content_review_comments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid references public.bsm_content_review_versions (id) on delete set null,
  author_profile_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  visibility text not null default 'shop_and_psg',
  marker_jsonb jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bsm_content_review_comments_visibility_check
    check (visibility in ('shop_and_psg', 'psg_private'))
);

create table if not exists public.bsm_content_review_decisions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid not null references public.bsm_content_review_versions (id) on delete cascade,
  decision text not null,
  message text,
  actor_profile_id uuid not null references public.profiles (id) on delete restrict,
  actor_role text not null,
  created_at timestamptz not null default now(),
  constraint bsm_content_review_decisions_decision_check
    check (decision in ('approve', 'decline', 'request_updates')),
  constraint bsm_content_review_decisions_actor_role_check
    check (actor_role in ('customer', 'psg'))
);

create table if not exists public.bsm_content_restore_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  requested_version_id uuid not null references public.bsm_content_review_versions (id) on delete cascade,
  requester_profile_id uuid not null references public.profiles (id) on delete restrict,
  reason text not null,
  status text not null default 'pending',
  resolved_by_profile_id uuid references public.profiles (id) on delete restrict,
  outcome_reason text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bsm_content_restore_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

create table if not exists public.bsm_content_review_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid references public.bsm_content_review_versions (id) on delete set null,
  event_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bsm_content_review_items_shop_status_idx
  on public.bsm_content_review_items (shop_id, status, updated_at desc);
create index if not exists bsm_content_review_versions_item_idx
  on public.bsm_content_review_versions (review_item_id, version_number desc);
create index if not exists bsm_content_review_reviewers_profile_idx
  on public.bsm_content_review_reviewers (profile_id, shop_id);
create index if not exists bsm_content_review_comments_item_created_idx
  on public.bsm_content_review_comments (review_item_id, created_at desc);
create index if not exists bsm_content_review_decisions_item_created_idx
  on public.bsm_content_review_decisions (review_item_id, created_at desc);
create index if not exists bsm_content_review_events_item_created_idx
  on public.bsm_content_review_events (review_item_id, created_at desc);

alter table public.bsm_content_review_items enable row level security;
alter table public.bsm_content_review_versions enable row level security;
alter table public.bsm_content_review_reviewers enable row level security;
alter table public.bsm_content_review_comments enable row level security;
alter table public.bsm_content_review_decisions enable row level security;
alter table public.bsm_content_restore_requests enable row level security;
alter table public.bsm_content_review_events enable row level security;

drop policy if exists bsm_content_review_items_select_reviewer on public.bsm_content_review_items;
create policy bsm_content_review_items_select_reviewer
  on public.bsm_content_review_items
  for select
  to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and exists (
      select 1
      from public.bsm_content_review_reviewers r
      where r.review_item_id = bsm_content_review_items.id
        and (r.profile_id = auth.uid() or r.profile_id is null)
    )
  );

drop policy if exists bsm_content_review_versions_select_reviewer on public.bsm_content_review_versions;
create policy bsm_content_review_versions_select_reviewer
  on public.bsm_content_review_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bsm_content_review_items i
      where i.id = bsm_content_review_versions.review_item_id
        and i.shop_id in (select public.user_shop_ids())
        and exists (
          select 1
          from public.bsm_content_review_reviewers r
          where r.review_item_id = i.id
            and (r.profile_id = auth.uid() or r.profile_id is null)
        )
    )
  );

drop policy if exists bsm_content_review_reviewers_select_self on public.bsm_content_review_reviewers;
create policy bsm_content_review_reviewers_select_self
  on public.bsm_content_review_reviewers
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()) and (profile_id = auth.uid() or profile_id is null));

drop policy if exists bsm_content_review_comments_select_visible on public.bsm_content_review_comments;
create policy bsm_content_review_comments_select_visible
  on public.bsm_content_review_comments
  for select
  to authenticated
  using (
    visibility = 'shop_and_psg'
    and exists (
      select 1
      from public.bsm_content_review_items i
      where i.id = bsm_content_review_comments.review_item_id
        and i.shop_id in (select public.user_shop_ids())
        and exists (
          select 1
          from public.bsm_content_review_reviewers r
          where r.review_item_id = i.id
            and (r.profile_id = auth.uid() or r.profile_id is null)
        )
    )
  );

drop policy if exists bsm_content_review_comments_insert_customer on public.bsm_content_review_comments;
create policy bsm_content_review_comments_insert_customer
  on public.bsm_content_review_comments
  for insert
  to authenticated
  with check (
    author_profile_id = auth.uid()
    and visibility = 'shop_and_psg'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id
      where i.id = bsm_content_review_comments.review_item_id
        and i.shop_id = bsm_content_review_comments.shop_id
        and i.shop_id in (select public.user_shop_ids())
        and r.profile_id = auth.uid()
    )
  );

drop policy if exists bsm_content_review_decisions_select_reviewer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_select_reviewer
  on public.bsm_content_review_decisions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bsm_content_review_items i
      where i.id = bsm_content_review_decisions.review_item_id
        and i.shop_id in (select public.user_shop_ids())
    )
  );

drop policy if exists bsm_content_review_decisions_insert_customer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_insert_customer
  on public.bsm_content_review_decisions
  for insert
  to authenticated
  with check (
    actor_profile_id = auth.uid()
    and actor_role = 'customer'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = auth.uid()
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = auth.uid()
      where i.id = bsm_content_review_decisions.review_item_id
        and i.shop_id = bsm_content_review_decisions.shop_id
        and su.role in ('owner', 'manager')
    )
  );

drop policy if exists bsm_content_restore_requests_select_reviewer on public.bsm_content_restore_requests;
create policy bsm_content_restore_requests_select_reviewer
  on public.bsm_content_restore_requests
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists bsm_content_restore_requests_insert_customer on public.bsm_content_restore_requests;
create policy bsm_content_restore_requests_insert_customer
  on public.bsm_content_restore_requests
  for insert
  to authenticated
  with check (
    requester_profile_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = auth.uid()
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = auth.uid()
      where i.id = bsm_content_restore_requests.review_item_id
        and i.shop_id = bsm_content_restore_requests.shop_id
        and su.role in ('owner', 'manager')
    )
  );

drop policy if exists bsm_content_review_events_select_reviewer on public.bsm_content_review_events;
create policy bsm_content_review_events_select_reviewer
  on public.bsm_content_review_events
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- No admin INSERT/UPDATE/DELETE policies: PSG admin mutation routes use the
-- service role only after app-level ops permission checks and audit writes.

grant select on table public.bsm_content_review_items to authenticated;
grant select on table public.bsm_content_review_versions to authenticated;
grant select on table public.bsm_content_review_reviewers to authenticated;
grant select, insert on table public.bsm_content_review_comments to authenticated;
grant select, insert on table public.bsm_content_review_decisions to authenticated;
grant select, insert on table public.bsm_content_restore_requests to authenticated;
grant select on table public.bsm_content_review_events to authenticated;

grant all on table public.bsm_content_review_items to service_role;
grant all on table public.bsm_content_review_versions to service_role;
grant all on table public.bsm_content_review_reviewers to service_role;
grant all on table public.bsm_content_review_comments to service_role;
grant all on table public.bsm_content_review_decisions to service_role;
grant all on table public.bsm_content_restore_requests to service_role;
grant all on table public.bsm_content_review_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bsm-content-approvals',
  'bsm-content-approvals',
  false,
  26214400,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bsm_content_approvals_objects_select on storage.objects;
create policy bsm_content_approvals_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bsm-content-approvals'
    and ((storage.foldername(name))[1])::uuid in (select public.user_shop_ids())
  );

-- No INSERT/UPDATE/DELETE storage policy: uploads use service-role minted
-- signed-upload URLs; destructive changes stay service-role only.
