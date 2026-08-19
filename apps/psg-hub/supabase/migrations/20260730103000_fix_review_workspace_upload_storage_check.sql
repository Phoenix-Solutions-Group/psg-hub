-- PSG-2492: keep browser uploads valid for both legacy approvals and Review Workspace documents.

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_storage_check;

alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_storage_check
  check (
    (storage_bucket is null and storage_path is null)
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
