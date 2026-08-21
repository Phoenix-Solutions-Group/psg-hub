-- PSG-1738 - ensure approved-content archive columns exist after BSM schema convergence.
--
-- Earlier BSM approval migrations were created close together and support more
-- than one starting table shape. Keep the final migration path additive so a
-- clean local reset and an already-created table both expose the columns used by
-- the customer approvals archive page.

alter table if exists public.bsm_content_review_versions
  add column if not exists source_content_item_id uuid references public.content_items (id) on delete set null,
  add column if not exists source_metadata_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists original_filename text,
  add column if not exists storage_path text,
  add column if not exists preview_type text not null default 'file',
  add column if not exists storage_object_path text,
  add column if not exists version_label text,
  add column if not exists generated_page_path text,
  add column if not exists preview_url text,
  add column if not exists snapshot_jsonb jsonb not null default '{}'::jsonb;

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
      ) || coalesce(snapshot_jsonb, '{}'::jsonb)
    )
  end,
  preview_type = case
    when preview_type is not null then preview_type
    when generated_page_path is not null or preview_url is not null then 'generated_page'
    else 'file'
  end
where true;
