-- PSG-2608 - Content Approvals review-round behavior.
--
-- Customer resubmissions append new decision rows instead of overwriting the
-- prior submitted response. The revision number makes the audit sequence easy
-- to read while existing created_at/submitted_at timestamps remain authoritative.

alter table if exists public.bsm_content_review_decisions
  add column if not exists submission_revision integer not null default 1;

alter table public.bsm_content_review_decisions
  drop constraint if exists bsm_content_review_decisions_submission_revision_check;

alter table public.bsm_content_review_decisions
  add constraint bsm_content_review_decisions_submission_revision_check
  check (submission_revision > 0);

create index if not exists bsm_content_review_decisions_round_invitation_revision_idx
  on public.bsm_content_review_decisions (round_id, invitation_id, submission_revision, submitted_at desc);
