-- PSG-2468: uploaded Review Workspace documents use the v2 workspace storage layout.
-- Keep legacy approval uploads working while allowing reviewer-downloadable workspace uploads.

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_storage_check;

alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_storage_check
  check (
    storage_path is null
    or (
      storage_bucket = 'bsm-content-approvals'
      and (
        storage_path ~ ('^' || shop_id::text || '/' || review_item_id::text || '/' || id::text || '/[^/]+$')
        or storage_path ~ (
          '^'
          || shop_id::text
          || '/[0-9a-f-]{36}/'
          || review_item_id::text
          || '/'
          || id::text
          || '/(original|quarantine|review-copy|sanitized-html|summary)/[^/]+$'
        )
      )
    )
  );
