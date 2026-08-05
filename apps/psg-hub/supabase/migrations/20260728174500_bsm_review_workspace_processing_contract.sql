-- PSG-2355: internal review-workspace processing worker contract.
-- This authors the schema only; production application is still release-gated.
-- Worker jobs are service-role only. Customer/reviewer routes must never read
-- originals or job internals directly.

alter table public.bsm_content_review_items
  add column if not exists project_id uuid,
  add column if not exists section_id uuid,
  add column if not exists position integer,
  add column if not exists required boolean not null default true,
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processing_error_code text,
  add column if not exists processing_error_message text,
  add column if not exists latest_processing_job_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists replaced_by_review_item_id uuid references public.bsm_content_review_items (id) on delete set null;

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_processing_status_check;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_processing_status_check
  check (
    processing_status in (
      'pending',
      'uploading',
      'scanning',
      'converting',
      'sanitizing',
      'ready',
      'failed',
      'quarantined',
      'blocked_runtime',
      'deleted',
      'replaced'
    )
  );

alter table public.bsm_content_review_versions
  add column if not exists project_id uuid,
  add column if not exists round_id uuid,
  add column if not exists original_storage_bucket text,
  add column if not exists original_storage_path text,
  add column if not exists processed_storage_bucket text,
  add column if not exists processed_storage_path text,
  add column if not exists processed_content_type text,
  add column if not exists artifact_manifest_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists page_count integer,
  add column if not exists desktop_viewport_jsonb jsonb,
  add column if not exists mobile_viewport_jsonb jsonb,
  add column if not exists scan_status text not null default 'pending',
  add column if not exists conversion_status text not null default 'not_needed',
  add column if not exists sanitization_status text not null default 'not_needed',
  add column if not exists introduced_by_round_id uuid,
  add column if not exists superseded_by_version_id uuid references public.bsm_content_review_versions (id) on delete set null;

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_scan_status_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_scan_status_check
  check (scan_status in ('pending', 'clean', 'infected', 'failed'));

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_conversion_status_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_conversion_status_check
  check (conversion_status in ('not_needed', 'pending', 'complete', 'failed', 'blocked_runtime'));

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_sanitization_status_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_sanitization_status_check
  check (sanitization_status in ('not_needed', 'pending', 'complete', 'failed'));

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_original_storage_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_original_storage_check
  check (
    original_storage_bucket is null
    or (
      original_storage_bucket = 'bsm-content-approvals'
      and original_storage_path ~ (
        '^'
        || shop_id::text
        || '/[0-9a-f-]{36}/'
        || review_item_id::text
        || '/'
        || id::text
        || '/(original|quarantine)/[^/]+$'
      )
    )
  );

alter table public.bsm_content_review_versions
  drop constraint if exists bsm_content_review_versions_processed_storage_check;
alter table public.bsm_content_review_versions
  add constraint bsm_content_review_versions_processed_storage_check
  check (
    processed_storage_bucket is null
    or (
      processed_storage_bucket = 'bsm-content-approvals'
      and processed_storage_path ~ (
        '^'
        || shop_id::text
        || '/[0-9a-f-]{36}/'
        || review_item_id::text
        || '/'
        || id::text
        || '/(review-copy|sanitized-html|summary)/[^/]+$'
      )
    )
  );

create table if not exists public.bsm_content_review_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid not null references public.bsm_content_review_versions (id) on delete cascade,
  idempotency_key text not null,
  job_type text not null default 'review_copy',
  status text not null default 'queued',
  scan_status text not null default 'pending',
  conversion_status text not null default 'not_needed',
  sanitization_status text not null default 'not_needed',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  requested_capabilities_jsonb jsonb not null default '[]'::jsonb,
  worker_runtime text not null default 'unassigned',
  worker_job_ref text,
  input_manifest_jsonb jsonb not null default '{}'::jsonb,
  result_manifest_jsonb jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_processing_jobs_unique_key unique (shop_id, idempotency_key),
  constraint bsm_content_review_processing_jobs_type_check
    check (job_type in ('scan', 'convert', 'sanitize', 'review_copy', 'summary', 'purge')),
  constraint bsm_content_review_processing_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'quarantined', 'blocked_runtime', 'retry_scheduled', 'dead_letter')),
  constraint bsm_content_review_processing_jobs_scan_status_check
    check (scan_status in ('pending', 'clean', 'infected', 'failed')),
  constraint bsm_content_review_processing_jobs_conversion_status_check
    check (conversion_status in ('not_needed', 'pending', 'complete', 'failed', 'blocked_runtime')),
  constraint bsm_content_review_processing_jobs_sanitization_status_check
    check (sanitization_status in ('not_needed', 'pending', 'complete', 'failed'))
);

-- Production may already have the v2 foundation shape of this table. In that
-- case create-if-not-exists skips the worker-contract columns above, so keep the
-- upgrade path additive before adding indexes/FKs that reference those columns.
alter table public.bsm_content_review_processing_jobs
  add column if not exists job_type text not null default 'review_copy',
  add column if not exists scan_status text not null default 'pending',
  add column if not exists conversion_status text not null default 'not_needed',
  add column if not exists sanitization_status text not null default 'not_needed',
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists max_attempts integer not null default 3 check (max_attempts > 0),
  add column if not exists requested_capabilities_jsonb jsonb not null default '[]'::jsonb,
  add column if not exists worker_runtime text not null default 'unassigned',
  add column if not exists worker_job_ref text,
  add column if not exists input_manifest_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists result_manifest_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists completed_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create unique index if not exists bsm_content_review_processing_jobs_unique_key
  on public.bsm_content_review_processing_jobs (shop_id, idempotency_key);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bsm_content_review_processing_jobs_type_check'
      and conrelid = 'public.bsm_content_review_processing_jobs'::regclass
  ) then
    alter table public.bsm_content_review_processing_jobs
      add constraint bsm_content_review_processing_jobs_type_check
      check (job_type in ('scan', 'convert', 'sanitize', 'review_copy', 'summary', 'purge'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bsm_content_review_processing_jobs_scan_status_check'
      and conrelid = 'public.bsm_content_review_processing_jobs'::regclass
  ) then
    alter table public.bsm_content_review_processing_jobs
      add constraint bsm_content_review_processing_jobs_scan_status_check
      check (scan_status in ('pending', 'clean', 'infected', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bsm_content_review_processing_jobs_conversion_status_check'
      and conrelid = 'public.bsm_content_review_processing_jobs'::regclass
  ) then
    alter table public.bsm_content_review_processing_jobs
      add constraint bsm_content_review_processing_jobs_conversion_status_check
      check (conversion_status in ('not_needed', 'pending', 'complete', 'failed', 'blocked_runtime'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bsm_content_review_processing_jobs_sanitization_status_check'
      and conrelid = 'public.bsm_content_review_processing_jobs'::regclass
  ) then
    alter table public.bsm_content_review_processing_jobs
      add constraint bsm_content_review_processing_jobs_sanitization_status_check
      check (sanitization_status in ('not_needed', 'pending', 'complete', 'failed'));
  end if;
end $$;

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_latest_processing_job_fkey;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_latest_processing_job_fkey
  foreign key (latest_processing_job_id)
  references public.bsm_content_review_processing_jobs (id)
  on delete set null;

create index if not exists bsm_content_review_items_processing_idx
  on public.bsm_content_review_items (shop_id, processing_status, updated_at desc);
create index if not exists bsm_content_review_processing_jobs_queue_idx
  on public.bsm_content_review_processing_jobs (status, next_attempt_at, created_at)
  where status in ('queued', 'retry_scheduled');
create index if not exists bsm_content_review_processing_jobs_version_idx
  on public.bsm_content_review_processing_jobs (version_id, created_at desc);

alter table public.bsm_content_review_processing_jobs enable row level security;

-- No authenticated policies or grants: processing jobs can include private file
-- paths, scanner details, parser errors, and worker internals. App routes use the
-- service role only after explicit ops authorization.
revoke all on table public.bsm_content_review_processing_jobs from anon;
revoke all on table public.bsm_content_review_processing_jobs from authenticated;
grant all on table public.bsm_content_review_processing_jobs to service_role;
