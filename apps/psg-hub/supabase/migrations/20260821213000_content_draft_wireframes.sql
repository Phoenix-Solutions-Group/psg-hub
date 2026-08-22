-- Conflict-safe Markdown Content Drafts and immutable Content Wireframe versions.

create table if not exists public.bsm_content_review_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  markdown_text text not null default '',
  revision integer not null default 0 check (revision >= 0),
  last_published_revision integer not null default -1 check (last_published_revision >= -1 and last_published_revision <= revision),
  base_version_id uuid references public.bsm_content_review_versions (id) on delete set null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  last_writer_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_drafts_one_per_document unique (review_item_id),
  constraint bsm_content_review_drafts_tenant_unique unique (id, project_id, shop_id, review_item_id),
  constraint bsm_content_review_drafts_size check (octet_length(markdown_text) <= 262144)
);

create table if not exists public.bsm_content_review_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  storage_bucket text not null default 'bsm-content-approvals',
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 26214400),
  checksum_sha256 text not null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint bsm_content_review_assets_type_check check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint bsm_content_review_assets_tenant_unique unique (id, project_id, shop_id, review_item_id),
  constraint bsm_content_review_assets_storage_check check (
    storage_bucket = 'bsm-content-approvals'
    and storage_path ~ ('^' || shop_id::text || '/' || project_id::text || '/' || review_item_id::text || '/assets/' || id::text || '/[^/]+$')
  )
);

create index if not exists bsm_content_review_drafts_project_idx
  on public.bsm_content_review_drafts (project_id, shop_id);
create index if not exists bsm_content_review_assets_document_idx
  on public.bsm_content_review_assets (review_item_id, created_at desc)
  where deleted_at is null;

alter table public.bsm_content_review_drafts enable row level security;
alter table public.bsm_content_review_assets enable row level security;
revoke all on table public.bsm_content_review_drafts from anon, authenticated;
revoke all on table public.bsm_content_review_assets from anon, authenticated;
grant all on table public.bsm_content_review_drafts to service_role;
grant all on table public.bsm_content_review_assets to service_role;

create or replace function public.publish_bsm_content_draft_version(
  p_version_id uuid,
  p_project_id uuid,
  p_shop_id uuid,
  p_review_item_id uuid,
  p_draft_id uuid,
  p_expected_revision integer,
  p_storage_path text,
  p_byte_size integer,
  p_checksum_sha256 text,
  p_source_metadata jsonb,
  p_artifact_manifest jsonb,
  p_actor_profile_id uuid,
  p_now timestamptz default now()
)
returns public.bsm_content_review_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.bsm_content_review_drafts;
  v_existing public.bsm_content_review_versions;
  v_version public.bsm_content_review_versions;
  v_version_number integer;
begin
  select * into v_existing
  from public.bsm_content_review_versions
  where id = p_version_id;
  if found then
    if v_existing.project_id <> p_project_id
      or v_existing.review_item_id <> p_review_item_id
      or v_existing.shop_id <> p_shop_id
      or v_existing.checksum_sha256 is distinct from p_checksum_sha256
      or (v_existing.source_metadata_jsonb ->> 'sourceKind') is distinct from 'content_draft'
      or (v_existing.source_metadata_jsonb ->> 'draftId') is distinct from p_draft_id::text
      or (v_existing.source_metadata_jsonb ->> 'draftRevision') is distinct from p_expected_revision::text
    then
      raise exception using errcode = '42501', message = 'Publication identity is not available';
    end if;
    return v_existing;
  end if;

  select * into v_draft
  from public.bsm_content_review_drafts
  where id = p_draft_id
    and project_id = p_project_id
    and shop_id = p_shop_id
    and review_item_id = p_review_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Content Draft not found';
  end if;
  if v_draft.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Content Draft revision changed';
  end if;
  if v_draft.last_published_revision >= p_expected_revision then
    raise exception using errcode = '23505', message = 'Content Draft revision was already published';
  end if;

  if v_draft.base_version_id is not null and exists (
    select 1
    from public.bsm_content_review_comment_threads
    where project_id = p_project_id
      and shop_id = p_shop_id
      and review_item_id = p_review_item_id
      and version_id = v_draft.base_version_id
      and status not in ('resolved', 'declined', 'needs_clarification')
  ) then
    raise exception using errcode = '23514', message = 'Feedback disposition is incomplete';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.bsm_content_review_versions
  where review_item_id = p_review_item_id;

  update public.bsm_content_review_versions
  set status = 'superseded'
  where review_item_id = p_review_item_id and status = 'current';

  insert into public.bsm_content_review_versions (
    id, review_item_id, project_id, shop_id, version_number, status,
    storage_bucket, storage_path, original_storage_bucket, original_storage_path,
    original_filename, content_type, byte_size, checksum_sha256, preview_type,
    source_metadata_jsonb, artifact_manifest_jsonb, scan_status, conversion_status,
    sanitization_status, created_by_profile_id, created_at
  ) values (
    p_version_id, p_review_item_id, p_project_id, p_shop_id, v_version_number, 'current',
    'bsm-content-approvals', p_storage_path, null, null,
    'content-v' || v_version_number || '.md', 'text/markdown', p_byte_size,
    p_checksum_sha256, 'content_wireframe', coalesce(p_source_metadata, '{}'::jsonb),
    coalesce(p_artifact_manifest, '{}'::jsonb), 'clean', 'not_needed', 'not_needed',
    p_actor_profile_id, p_now
  ) returning * into v_version;

  update public.bsm_content_review_items
  set current_version_id = v_version.id,
      processing_status = 'ready',
      updated_at = p_now
  where id = p_review_item_id and project_id = p_project_id and shop_id = p_shop_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Review Document not found';
  end if;

  update public.bsm_content_review_drafts
  set base_version_id = v_version.id,
      last_published_revision = p_expected_revision,
      updated_at = p_now
  where id = p_draft_id and revision = p_expected_revision;

  insert into public.bsm_content_review_events (
    shop_id, review_item_id, version_id, event_type, actor_profile_id, payload_jsonb, created_at
  ) values (
    p_shop_id, p_review_item_id, v_version.id, 'content_draft_published', p_actor_profile_id,
    jsonb_build_object(
      'projectId', p_project_id,
      'documentId', p_review_item_id,
      'draftId', p_draft_id,
      'revision', p_expected_revision,
      'baseVersionId', v_draft.base_version_id,
      'versionNumber', v_version_number
    ),
    p_now
  );

  return v_version;
end;
$$;

revoke all on function public.publish_bsm_content_draft_version(uuid, uuid, uuid, uuid, uuid, integer, text, integer, text, jsonb, jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_bsm_content_draft_version(uuid, uuid, uuid, uuid, uuid, integer, text, integer, text, jsonb, jsonb, uuid, timestamptz) to service_role;
