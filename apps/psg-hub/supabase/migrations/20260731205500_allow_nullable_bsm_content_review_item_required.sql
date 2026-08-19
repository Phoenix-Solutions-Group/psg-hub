-- PSG-2545: keep live library-only BSM content approval uploads compatible with
-- already-deployed app bundles that send required = null when no Review
-- Workspace is selected. Workspace round requirements remain enforced on
-- bsm_content_review_round_documents.decision_required.

alter table public.bsm_content_review_items
  alter column required drop not null;

comment on column public.bsm_content_review_items.required is
  'Whether this item is required inside a Review Workspace. Null is allowed for library-only draft items that are not attached to a workspace.';
