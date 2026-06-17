-- Phase 14 / 14-02 — review_responses reply-publish lifecycle columns.
-- 14-02's publish orchestrator (gbp-reviews-reply-sync) consumes status='approved' rows and
-- PUTs the draft to Google v4 updateReply, tracking the per-reply publish lifecycle ON the
-- review_responses row (NOT a sync ledger — these columns ARE the audit trail). Additive +
-- idempotent, mirroring 20260602170000_review_responses_governance.sql (ADD COLUMN IF NOT EXISTS).
--
-- The existing status (draft|approved|rejected) state machine + the approve-response route are
-- UNTOUCHED: overloading status with publish states would break the approve checks. published_at
-- already exists (base schema) — NOT re-added. published_version is the dirty-publish key: the
-- worker re-publishes when an edited+re-approved row's version exceeds published_version (updateReply
-- is an upsert, so re-posting the latest approved text is safe). publish_status default 'pending'
-- is harmless on draft/rejected rows — the worker filters status='approved'.
--
-- NO analytics_sync_runs source CHECK widen: the publish worker keeps no ledger (the per-row
-- publish_status/publish_error/publish_attempts are the audit). AUTHORED ONLY — idempotent +
-- re-runnable, NOT applied to prod here; prod apply is the Phase-14 gate batch (mirrors 13-04,
-- PROTOCOL-migration-safety.md). ZERO data written.

alter table public.review_responses
  add column if not exists publish_status text not null default 'pending',
  add column if not exists publish_error text,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists published_version integer,
  add column if not exists external_reply_updated_at timestamptz;

-- Named CHECK so the publish lifecycle is constrained (guard so re-run is a no-op).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_responses'::regclass
      and conname = 'review_responses_publish_status_check'
  ) then
    alter table public.review_responses
      add constraint review_responses_publish_status_check
      check (publish_status in ('pending', 'publishing', 'published', 'publish_failed'));
  end if;
end$$;
