-- PSG-2360: one-photo attachments for customer phone replies in Content Approver v2.
-- Customer routes upload through the server with service role after membership
-- checks. The file stays in the existing private Content Approver bucket under
-- the shop id folder so storage RLS remains customer-separated.

create table if not exists public.bsm_content_review_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  comment_id uuid not null references public.bsm_content_review_comments (id) on delete cascade,
  version_id uuid references public.bsm_content_review_versions (id) on delete set null,
  uploader_profile_id uuid not null references public.profiles (id) on delete cascade,
  storage_bucket text not null default 'bsm-content-approvals',
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  byte_size integer not null,
  screening_status text not null default 'passed_basic_screen',
  created_at timestamptz not null default now(),
  constraint bsm_content_review_comment_attachments_one_per_comment unique (comment_id),
  constraint bsm_content_review_comment_attachments_bucket_check
    check (storage_bucket = 'bsm-content-approvals'),
  constraint bsm_content_review_comment_attachments_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint bsm_content_review_comment_attachments_size_check
    check (byte_size > 0 and byte_size <= 8388608),
  constraint bsm_content_review_comment_attachments_screening_check
    check (screening_status in ('passed_basic_screen', 'quarantined', 'failed_basic_screen')),
  constraint bsm_content_review_comment_attachments_path_check
    check (
      storage_path ~ (
        '^'
        || shop_id::text
        || '/'
        || review_item_id::text
        || '/comments/'
        || comment_id::text
        || '/'
        || id::text
        || '/[^/]+$'
      )
    )
);

create index if not exists bsm_content_review_comment_attachments_item_idx
  on public.bsm_content_review_comment_attachments (review_item_id, created_at desc);

alter table public.bsm_content_review_comment_attachments enable row level security;

drop policy if exists bsm_content_review_comment_attachments_select_visible
  on public.bsm_content_review_comment_attachments;
create policy bsm_content_review_comment_attachments_select_visible
  on public.bsm_content_review_comment_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bsm_content_review_comments c
      join public.bsm_content_review_items i on i.id = c.review_item_id
      where c.id = bsm_content_review_comment_attachments.comment_id
        and c.visibility = 'shop_and_psg'
        and i.shop_id = bsm_content_review_comment_attachments.shop_id
        and i.shop_id in (select public.user_shop_ids())
    )
  );

-- No authenticated INSERT/UPDATE/DELETE policies: uploads and attachment rows are
-- written by app routes using the service role after explicit customer access
-- checks. This keeps forged customer sessions from writing arbitrary storage
-- paths or marking unsafe files as screened.
grant select on table public.bsm_content_review_comment_attachments to authenticated;
grant all on table public.bsm_content_review_comment_attachments to service_role;

comment on table public.bsm_content_review_comment_attachments is
  'One-photo customer reply attachments for BSM Content Approver v2. Server-side upload only; private bucket path starts with shop id for tenant-separated storage access.';
