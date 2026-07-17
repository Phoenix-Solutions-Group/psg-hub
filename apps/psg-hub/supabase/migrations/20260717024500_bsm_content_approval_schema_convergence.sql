-- PSG-1736 - converge BSM content approval review schema.
--
-- Two earlier same-timestamp migrations created the same review tables with
-- different column names. This migration makes either starting shape match the
-- app code used by upload, customer review, decisions, restore requests, and
-- the approved-content archive.

alter table if exists public.bsm_content_review_items
  add column if not exists account_id uuid,
  add column if not exists source_content_item_id uuid references public.content_items (id) on delete set null,
  add column if not exists customer_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists source_kind text,
  add column if not exists admin_context_note text,
  add column if not exists due_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists created_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists metadata_jsonb jsonb not null default '{}'::jsonb;

alter table if exists public.bsm_content_review_versions
  add column if not exists status text not null default 'current',
  add column if not exists storage_path text,
  add column if not exists storage_object_path text,
  add column if not exists original_filename text,
  add column if not exists version_label text,
  add column if not exists content_type text,
  add column if not exists byte_size integer,
  add column if not exists preview_type text not null default 'file',
  add column if not exists source_content_item_id uuid references public.content_items (id) on delete set null,
  add column if not exists source_metadata_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists checksum_sha256 text,
  add column if not exists checksum text,
  add column if not exists created_by_profile_id uuid references public.profiles (id) on delete set null;

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
where true;

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

alter table if exists public.bsm_content_review_decisions
  add column if not exists actor_display_name text,
  add column if not exists actor_role text not null default 'customer',
  add column if not exists decided_at timestamptz not null default now();

alter table if exists public.bsm_content_review_events
  add column if not exists decision_id uuid references public.bsm_content_review_decisions (id) on delete set null;

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_status_check;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_status_check
  check (status in ('draft', 'sent', 'in_review', 'updates_requested', 'approved', 'declined', 'archived'));

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_content_type_check;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_content_type_check
  check (content_type in ('pdf', 'image', 'document', 'generated_page', 'other'));

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_status_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_status_check
  check (status in ('current', 'superseded', 'pending_restore', 'restored'));

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_source_check;
alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_storage_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_storage_check
  check (
    storage_bucket is null
    or (
      storage_bucket = 'bsm-content-approvals'
      and storage_path ~ ('^' || shop_id::text || '/' || review_item_id::text || '/' || id::text || '/[^/]+$')
    )
  );

alter table public.bsm_content_review_decisions
  drop constraint if exists bsm_content_review_decisions_decision_check;
alter table public.bsm_content_review_decisions
  add constraint bsm_content_review_decisions_decision_check
  check (decision in ('approve', 'decline', 'request_updates'));

alter table public.bsm_content_review_decisions
  drop constraint if exists bsm_content_review_decisions_actor_role_check;
alter table public.bsm_content_review_decisions
  add constraint bsm_content_review_decisions_actor_role_check
  check (actor_role in ('customer', 'psg', 'psg_admin', 'system'));

create index if not exists bsm_content_review_reviewers_profile_idx
  on public.bsm_content_review_reviewers (profile_id, shop_id);
create index if not exists bsm_content_review_comments_item_created_idx
  on public.bsm_content_review_comments (review_item_id, created_at desc);
create index if not exists bsm_content_restore_requests_item_created_idx
  on public.bsm_content_restore_requests (review_item_id, created_at desc);

alter table public.bsm_content_review_reviewers enable row level security;
alter table public.bsm_content_review_comments enable row level security;
alter table public.bsm_content_restore_requests enable row level security;

grant select on table public.bsm_content_review_reviewers to authenticated;
grant select, insert on table public.bsm_content_review_comments to authenticated;
grant select, insert on table public.bsm_content_restore_requests to authenticated;
grant all on table public.bsm_content_review_reviewers to service_role;
grant all on table public.bsm_content_review_comments to service_role;
grant all on table public.bsm_content_restore_requests to service_role;
