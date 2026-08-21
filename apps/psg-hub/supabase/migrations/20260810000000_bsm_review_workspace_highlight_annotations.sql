-- Review Workspace: selectable-text highlights share the existing annotation table.

alter table public.bsm_content_review_comments
  drop constraint if exists bsm_content_review_comments_v2_kind_check;

alter table public.bsm_content_review_comments
  add constraint bsm_content_review_comments_v2_kind_check
  check (comment_kind in ('pin', 'highlight', 'clarification_reply', 'psg_reply', 'system_note'));

-- Reopened reviewers append a new immutable decision revision. The original
-- v2 index allowed only one lifetime decision per reviewer/document.
drop index if exists public.bsm_content_review_decisions_v2_active_uniq;

create unique index bsm_content_review_decisions_v2_active_uniq
  on public.bsm_content_review_decisions (
    round_id,
    review_item_id,
    version_id,
    invitation_id,
    submission_revision
  )
  where round_id is not null and invitation_id is not null and carried_from_decision_id is null;
