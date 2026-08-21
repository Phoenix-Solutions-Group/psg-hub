-- PSG-authored annotations can exist before a review round or reviewer invite.
alter table public.bsm_content_review_comment_threads
  alter column round_id drop not null,
  alter column owner_invitation_id drop not null;

create unique index if not exists bsm_content_review_comment_threads_staff_pin_uniq
  on public.bsm_content_review_comment_threads (project_id, review_item_id, version_id, pin_number)
  where owner_invitation_id is null;
