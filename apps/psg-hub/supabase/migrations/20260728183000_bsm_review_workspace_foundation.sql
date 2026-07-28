-- PSG-2356 - BSM Review Workspace schema and service foundation.
--
-- Additive v2 foundation around the existing bsm_content_review_* tables.
-- Existing v1 rows continue to work because every project/round/invitation
-- extension column is nullable unless the row belongs to a v2 workspace.

create table if not exists public.bsm_content_review_projects (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  current_round_id uuid,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  recover_until timestamptz,
  metadata_jsonb jsonb not null default '{}'::jsonb,
  constraint bsm_content_review_projects_status_check
    check (status in ('draft', 'processing', 'ready', 'active', 'completed', 'closed_early', 'archived', 'deleting', 'deleted')),
  constraint bsm_content_review_projects_title_length
    check (char_length(title) between 1 and 180)
);

create table if not exists public.bsm_content_review_project_collaborators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'collaborator',
  added_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint bsm_content_review_project_collaborators_role_check
    check (role in ('owner', 'collaborator', 'support'))
);

create unique index if not exists bsm_content_review_project_collaborators_active_uniq
  on public.bsm_content_review_project_collaborators (project_id, profile_id)
  where removed_at is null;

create table if not exists public.bsm_content_review_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint bsm_content_review_sections_title_length
    check (char_length(title) between 1 and 140)
);

create unique index if not exists bsm_content_review_sections_active_position_uniq
  on public.bsm_content_review_sections (project_id, position)
  where deleted_at is null;

create table if not exists public.bsm_content_review_rounds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'draft',
  started_by_profile_id uuid references public.profiles (id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  closed_by_profile_id uuid references public.profiles (id) on delete restrict,
  closed_at timestamptz,
  closed_reason text,
  outcome text,
  summary_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_rounds_status_check
    check (status in ('draft', 'inviting', 'active', 'completed', 'closed_early', 'cancelled')),
  constraint bsm_content_review_rounds_outcome_check
    check (outcome is null or outcome in ('approved', 'changes_requested', 'closed_early', 'cancelled'))
);

create unique index if not exists bsm_content_review_rounds_number_uniq
  on public.bsm_content_review_rounds (project_id, round_number);

alter table public.bsm_content_review_projects
  drop constraint if exists bsm_content_review_projects_current_round_fkey;
alter table public.bsm_content_review_projects
  add constraint bsm_content_review_projects_current_round_fkey
  foreign key (current_round_id) references public.bsm_content_review_rounds (id)
  on delete set null deferrable initially deferred;

create table if not exists public.bsm_content_review_round_documents (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.bsm_content_review_rounds (id) on delete cascade,
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid not null references public.bsm_content_review_versions (id) on delete cascade,
  decision_required boolean not null default true,
  carried_from_round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  carried_decision_id uuid references public.bsm_content_review_decisions (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bsm_content_review_round_documents_uniq unique (round_id, review_item_id)
);

create table if not exists public.bsm_content_review_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  round_id uuid not null references public.bsm_content_review_rounds (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  reviewer_profile_id uuid references public.profiles (id) on delete set null,
  reviewer_email text not null,
  reviewer_name text,
  status text not null default 'draft',
  token_hash text not null,
  code_hash text,
  code_attempt_count integer not null default 0 check (code_attempt_count >= 0),
  last_code_sent_at timestamptz,
  expires_at timestamptz not null,
  reminder_due_at timestamptz,
  reminder_sent_at timestamptz,
  resend_of_invitation_id uuid references public.bsm_content_review_invitations (id) on delete set null,
  revoked_by_profile_id uuid references public.profiles (id) on delete restrict,
  revoked_at timestamptz,
  submitted_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_invitations_status_check
    check (status in ('draft', 'sent', 'viewed', 'submitted', 'expired', 'revoked', 'superseded')),
  constraint bsm_content_review_invitations_email_length
    check (char_length(reviewer_email) between 3 and 320)
);

create unique index if not exists bsm_content_review_invitations_token_hash_uniq
  on public.bsm_content_review_invitations (token_hash);
create index if not exists bsm_content_review_invitations_round_status_idx
  on public.bsm_content_review_invitations (round_id, status, expires_at);

create table if not exists public.bsm_content_review_sessions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.bsm_content_review_invitations (id) on delete cascade,
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  round_id uuid not null references public.bsm_content_review_rounds (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  session_hash text not null,
  device_label text,
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists bsm_content_review_sessions_hash_uniq
  on public.bsm_content_review_sessions (session_hash);

create table if not exists public.bsm_content_review_comment_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  round_id uuid not null references public.bsm_content_review_rounds (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid not null references public.bsm_content_review_versions (id) on delete cascade,
  owner_invitation_id uuid not null references public.bsm_content_review_invitations (id) on delete cascade,
  root_comment_id uuid,
  pin_number integer not null check (pin_number > 0),
  status text not null default 'draft',
  triaged_by_profile_id uuid references public.profiles (id) on delete restrict,
  triaged_at timestamptz,
  clarification_opened_at timestamptz,
  clarification_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_comment_threads_status_check
    check (status in ('draft', 'submitted', 'open', 'accepted', 'declined', 'needs_clarification', 'clarification_answered', 'resolved'))
);

create unique index if not exists bsm_content_review_comment_threads_pin_uniq
  on public.bsm_content_review_comment_threads (round_id, owner_invitation_id, review_item_id, version_id, pin_number);

create table if not exists public.bsm_content_review_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  review_item_id uuid references public.bsm_content_review_items (id) on delete cascade,
  version_id uuid references public.bsm_content_review_versions (id) on delete cascade,
  round_id uuid references public.bsm_content_review_rounds (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  kind text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  idempotency_key text not null,
  input_jsonb jsonb not null default '{}'::jsonb,
  output_jsonb jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_processing_jobs_kind_check
    check (kind in ('upload_scan', 'pdf_preview', 'doc_to_pdf', 'html_sanitize', 'zip_extract', 'summary_pdf', 'purge')),
  constraint bsm_content_review_processing_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

create unique index if not exists bsm_content_review_processing_jobs_idempotency_uniq
  on public.bsm_content_review_processing_jobs (idempotency_key);

create table if not exists public.bsm_content_review_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.bsm_content_review_projects (id) on delete cascade,
  round_id uuid not null references public.bsm_content_review_rounds (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  status text not null default 'queued',
  storage_bucket text,
  storage_path text,
  generated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  generated_at timestamptz,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_review_summaries_status_check
    check (status in ('queued', 'generated', 'failed', 'deleted')),
  constraint bsm_content_review_summaries_storage_check
    check (
      storage_bucket is null
      or (
        storage_bucket = 'bsm-content-approvals'
        and storage_path ~ ('^' || shop_id::text || '/' || project_id::text || '/summaries/' || round_id::text || '/[^/]+$')
      )
    )
);

create table if not exists public.bsm_content_review_deletion_tombstones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  shop_id uuid not null references public.shops (id) on delete cascade,
  project_title text,
  deleted_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  deleted_at timestamptz not null,
  purged_at timestamptz not null,
  reason text,
  counts_jsonb jsonb not null default '{}'::jsonb,
  retention_policy text not null default '30_day_recoverable_delete',
  created_at timestamptz not null default now(),
  constraint bsm_content_review_deletion_tombstones_project_uniq unique (project_id)
);

alter table if exists public.bsm_content_review_items
  add column if not exists project_id uuid references public.bsm_content_review_projects (id) on delete set null,
  add column if not exists section_id uuid references public.bsm_content_review_sections (id) on delete set null,
  add column if not exists position integer,
  add column if not exists required boolean not null default true,
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processing_error_code text,
  add column if not exists processing_error_message text,
  add column if not exists latest_processing_job_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists replaced_by_review_item_id uuid references public.bsm_content_review_items (id) on delete set null;

alter table if exists public.bsm_content_review_versions
  add column if not exists project_id uuid references public.bsm_content_review_projects (id) on delete set null,
  add column if not exists round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  add column if not exists original_storage_bucket text,
  add column if not exists original_storage_path text,
  add column if not exists processed_storage_bucket text,
  add column if not exists processed_storage_path text,
  add column if not exists processed_content_type text,
  add column if not exists artifact_manifest_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists page_count integer,
  add column if not exists desktop_viewport_jsonb jsonb,
  add column if not exists mobile_viewport_jsonb jsonb,
  add column if not exists scan_status text,
  add column if not exists conversion_status text,
  add column if not exists sanitization_status text,
  add column if not exists introduced_by_round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  add column if not exists superseded_by_version_id uuid references public.bsm_content_review_versions (id) on delete set null;

alter table if exists public.bsm_content_review_reviewers
  add column if not exists invitation_id uuid references public.bsm_content_review_invitations (id) on delete set null,
  add column if not exists round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  add column if not exists reviewer_email text,
  add column if not exists reviewer_name text,
  add column if not exists submission_status text not null default 'not_started',
  add column if not exists submitted_at timestamptz,
  add column if not exists removed_at timestamptz;

alter table if exists public.bsm_content_review_comments
  alter column author_profile_id drop not null,
  add column if not exists thread_id uuid references public.bsm_content_review_comment_threads (id) on delete set null,
  add column if not exists round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  add column if not exists invitation_id uuid references public.bsm_content_review_invitations (id) on delete set null,
  add column if not exists reviewer_session_id uuid references public.bsm_content_review_sessions (id) on delete set null,
  add column if not exists comment_kind text not null default 'system_note',
  add column if not exists draft_status text not null default 'submitted',
  add column if not exists pin_number integer,
  add column if not exists page_number integer,
  add column if not exists viewport text,
  add column if not exists x_ratio numeric,
  add column if not exists y_ratio numeric,
  add column if not exists selection_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists locked_at timestamptz;

alter table public.bsm_content_review_comment_threads
  drop constraint if exists bsm_content_review_comment_threads_root_comment_fkey;
alter table public.bsm_content_review_comment_threads
  add constraint bsm_content_review_comment_threads_root_comment_fkey
  foreign key (root_comment_id) references public.bsm_content_review_comments (id)
  on delete set null deferrable initially deferred;

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_latest_processing_job_fkey;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_latest_processing_job_fkey
  foreign key (latest_processing_job_id) references public.bsm_content_review_processing_jobs (id)
  on delete set null deferrable initially deferred;

alter table if exists public.bsm_content_review_decisions
  add column if not exists project_id uuid references public.bsm_content_review_projects (id) on delete set null,
  add column if not exists round_id uuid references public.bsm_content_review_rounds (id) on delete set null,
  add column if not exists invitation_id uuid references public.bsm_content_review_invitations (id) on delete set null,
  add column if not exists carried_from_decision_id uuid references public.bsm_content_review_decisions (id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists locked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_items_processing_status_check'
  ) then
    alter table public.bsm_content_review_items
      add constraint bsm_content_review_items_processing_status_check
      check (processing_status in ('pending', 'uploading', 'scanning', 'converting', 'sanitizing', 'ready', 'failed', 'quarantined', 'deleted', 'replaced'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_comments_v2_kind_check'
  ) then
    alter table public.bsm_content_review_comments
      add constraint bsm_content_review_comments_v2_kind_check
      check (comment_kind in ('pin', 'clarification_reply', 'psg_reply', 'system_note'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_comments_draft_status_check'
  ) then
    alter table public.bsm_content_review_comments
      add constraint bsm_content_review_comments_draft_status_check
      check (draft_status in ('draft', 'submitted', 'locked'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_comments_viewport_check'
  ) then
    alter table public.bsm_content_review_comments
      add constraint bsm_content_review_comments_viewport_check
      check (viewport is null or viewport in ('desktop', 'mobile', 'pdf_page'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_comments_coordinate_check'
  ) then
    alter table public.bsm_content_review_comments
      add constraint bsm_content_review_comments_coordinate_check
      check (
        (x_ratio is null or (x_ratio >= 0 and x_ratio <= 1))
        and (y_ratio is null or (y_ratio >= 0 and y_ratio <= 1))
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bsm_content_review_reviewers_submission_status_check'
  ) then
    alter table public.bsm_content_review_reviewers
      add constraint bsm_content_review_reviewers_submission_status_check
      check (submission_status in ('not_started', 'draft', 'submitted', 'expired', 'revoked'));
  end if;
end$$;

create unique index if not exists bsm_content_review_decisions_v2_active_uniq
  on public.bsm_content_review_decisions (round_id, review_item_id, version_id, invitation_id)
  where round_id is not null and invitation_id is not null and carried_from_decision_id is null;

create index if not exists bsm_content_review_projects_shop_status_idx
  on public.bsm_content_review_projects (shop_id, status, updated_at desc);
create index if not exists bsm_content_review_items_project_position_idx
  on public.bsm_content_review_items (project_id, section_id, position)
  where project_id is not null and deleted_at is null;
create index if not exists bsm_content_review_comments_thread_idx
  on public.bsm_content_review_comments (thread_id, created_at)
  where thread_id is not null;

create or replace function private.bsm_content_review_user_can_access_project(target_project_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.bsm_content_review_projects p
    where p.id = target_project_id
      and p.deleted_at is null
      and (
        (
          p.shop_id in (select public.user_shop_ids())
          and (select auth.uid()) is not null
        )
        or (
          (select private.current_user_has_fn('manage_bsm_content_approvals'))
          and exists (
            select 1
            from public.bsm_content_review_project_collaborators c
            where c.project_id = p.id
              and c.profile_id = (select auth.uid())
              and c.removed_at is null
          )
        )
      )
  )
$$;

create or replace function private.bsm_content_review_user_can_access_invitation(target_invitation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.bsm_content_review_invitations i
    join public.bsm_content_review_projects p on p.id = i.project_id
    where i.id = target_invitation_id
      and p.deleted_at is null
      and i.status in ('sent', 'viewed', 'submitted')
      and i.expires_at > now()
      and i.revoked_at is null
      and i.reviewer_profile_id = (select auth.uid())
  )
$$;

revoke all on function private.bsm_content_review_user_can_access_project(uuid) from public;
revoke all on function private.bsm_content_review_user_can_access_invitation(uuid) from public;
grant execute on function private.bsm_content_review_user_can_access_project(uuid) to authenticated, service_role;
grant execute on function private.bsm_content_review_user_can_access_invitation(uuid) to authenticated, service_role;

create or replace function private.reject_submitted_bsm_content_review_comment_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.submitted_at is not null or old.locked_at is not null or old.draft_status in ('submitted', 'locked') then
      raise exception 'submitted BSM review comments are immutable' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.submitted_at is not null or old.locked_at is not null or old.draft_status in ('submitted', 'locked') then
    raise exception 'submitted BSM review comments are immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function private.reject_bsm_content_review_decision_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception 'BSM review decisions are immutable' using errcode = 'check_violation';
end;
$$;

drop trigger if exists bsm_content_review_comments_submitted_no_mutate on public.bsm_content_review_comments;
create trigger bsm_content_review_comments_submitted_no_mutate
  before update or delete on public.bsm_content_review_comments
  for each row execute function private.reject_submitted_bsm_content_review_comment_mutation();

drop trigger if exists bsm_content_review_decisions_no_mutate on public.bsm_content_review_decisions;
create trigger bsm_content_review_decisions_no_mutate
  before update or delete on public.bsm_content_review_decisions
  for each row execute function private.reject_bsm_content_review_decision_mutation();

alter table public.bsm_content_review_projects enable row level security;
alter table public.bsm_content_review_project_collaborators enable row level security;
alter table public.bsm_content_review_sections enable row level security;
alter table public.bsm_content_review_rounds enable row level security;
alter table public.bsm_content_review_round_documents enable row level security;
alter table public.bsm_content_review_invitations enable row level security;
alter table public.bsm_content_review_sessions enable row level security;
alter table public.bsm_content_review_comment_threads enable row level security;
alter table public.bsm_content_review_processing_jobs enable row level security;
alter table public.bsm_content_review_summaries enable row level security;
alter table public.bsm_content_review_deletion_tombstones enable row level security;

drop policy if exists bsm_content_review_projects_select_authorized on public.bsm_content_review_projects;
create policy bsm_content_review_projects_select_authorized
  on public.bsm_content_review_projects
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(id)));

drop policy if exists bsm_content_review_project_collaborators_select_authorized on public.bsm_content_review_project_collaborators;
create policy bsm_content_review_project_collaborators_select_authorized
  on public.bsm_content_review_project_collaborators
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(project_id)));

drop policy if exists bsm_content_review_sections_select_authorized on public.bsm_content_review_sections;
create policy bsm_content_review_sections_select_authorized
  on public.bsm_content_review_sections
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(project_id)));

drop policy if exists bsm_content_review_rounds_select_authorized on public.bsm_content_review_rounds;
create policy bsm_content_review_rounds_select_authorized
  on public.bsm_content_review_rounds
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(project_id)));

drop policy if exists bsm_content_review_round_documents_select_authorized on public.bsm_content_review_round_documents;
create policy bsm_content_review_round_documents_select_authorized
  on public.bsm_content_review_round_documents
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(project_id)));

drop policy if exists bsm_content_review_invitations_select_self_or_staff on public.bsm_content_review_invitations;
create policy bsm_content_review_invitations_select_self_or_staff
  on public.bsm_content_review_invitations
  for select to authenticated
  using (
    (reviewer_profile_id = (select auth.uid()) and (select private.bsm_content_review_user_can_access_invitation(id)))
    or (
      (select private.current_user_has_fn('manage_bsm_content_approvals'))
      and (select private.bsm_content_review_user_can_access_project(project_id))
    )
  );

drop policy if exists bsm_content_review_sessions_select_staff_only on public.bsm_content_review_sessions;
create policy bsm_content_review_sessions_select_staff_only
  on public.bsm_content_review_sessions
  for select to authenticated
  using (
    (select private.current_user_has_fn('manage_bsm_content_approvals'))
    and (select private.bsm_content_review_user_can_access_project(project_id))
  );

drop policy if exists bsm_content_review_comment_threads_select_owner_or_staff on public.bsm_content_review_comment_threads;
create policy bsm_content_review_comment_threads_select_owner_or_staff
  on public.bsm_content_review_comment_threads
  for select to authenticated
  using (
    (select private.bsm_content_review_user_can_access_invitation(owner_invitation_id))
    or (
      (select private.current_user_has_fn('manage_bsm_content_approvals'))
      and (select private.bsm_content_review_user_can_access_project(project_id))
    )
  );

drop policy if exists bsm_content_review_processing_jobs_select_staff on public.bsm_content_review_processing_jobs;
create policy bsm_content_review_processing_jobs_select_staff
  on public.bsm_content_review_processing_jobs
  for select to authenticated
  using (
    (select private.current_user_has_fn('manage_bsm_content_approvals'))
    and (select private.bsm_content_review_user_can_access_project(project_id))
  );

drop policy if exists bsm_content_review_summaries_select_authorized on public.bsm_content_review_summaries;
create policy bsm_content_review_summaries_select_authorized
  on public.bsm_content_review_summaries
  for select to authenticated
  using ((select private.bsm_content_review_user_can_access_project(project_id)));

drop policy if exists bsm_content_review_deletion_tombstones_select_superadmin on public.bsm_content_review_deletion_tombstones;
create policy bsm_content_review_deletion_tombstones_select_superadmin
  on public.bsm_content_review_deletion_tombstones
  for select to authenticated
  using ((select private.current_user_role()) = 'psg_superadmin');

drop policy if exists bsm_content_review_comments_select_visible on public.bsm_content_review_comments;
create policy bsm_content_review_comments_select_visible
  on public.bsm_content_review_comments
  for select
  to authenticated
  using (
    visibility = 'shop_and_psg'
    and (
      (
        project_id is null
        and exists (
          select 1
          from public.bsm_content_review_items i
          where i.id = bsm_content_review_comments.review_item_id
            and i.shop_id in (select public.user_shop_ids())
            and exists (
              select 1
              from public.bsm_content_review_reviewers r
              where r.review_item_id = i.id
                and (r.profile_id = (select auth.uid()) or r.profile_id is null)
            )
        )
      )
      or (
        project_id is not null
        and (
          (
            invitation_id is not null
            and (select private.bsm_content_review_user_can_access_invitation(invitation_id))
          )
          or (
            (select private.current_user_has_fn('manage_bsm_content_approvals'))
            and (select private.bsm_content_review_user_can_access_project(project_id))
          )
        )
      )
    )
  );

drop policy if exists bsm_content_review_decisions_select_reviewer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_select_reviewer
  on public.bsm_content_review_decisions
  for select
  to authenticated
  using (
    (
      project_id is null
      and exists (
        select 1
        from public.bsm_content_review_items i
        where i.id = bsm_content_review_decisions.review_item_id
          and i.shop_id in (select public.user_shop_ids())
      )
    )
    or (
      project_id is not null
      and (
        (invitation_id is not null and (select private.bsm_content_review_user_can_access_invitation(invitation_id)))
        or (
          (select private.current_user_has_fn('manage_bsm_content_approvals'))
          and (select private.bsm_content_review_user_can_access_project(project_id))
        )
      )
    )
  );

grant select on table public.bsm_content_review_projects to authenticated;
grant select on table public.bsm_content_review_project_collaborators to authenticated;
grant select on table public.bsm_content_review_sections to authenticated;
grant select on table public.bsm_content_review_rounds to authenticated;
grant select on table public.bsm_content_review_round_documents to authenticated;
grant select on table public.bsm_content_review_invitations to authenticated;
grant select on table public.bsm_content_review_sessions to authenticated;
grant select on table public.bsm_content_review_comment_threads to authenticated;
grant select on table public.bsm_content_review_processing_jobs to authenticated;
grant select on table public.bsm_content_review_summaries to authenticated;
grant select on table public.bsm_content_review_deletion_tombstones to authenticated;

grant all on table public.bsm_content_review_projects to service_role;
grant all on table public.bsm_content_review_project_collaborators to service_role;
grant all on table public.bsm_content_review_sections to service_role;
grant all on table public.bsm_content_review_rounds to service_role;
grant all on table public.bsm_content_review_round_documents to service_role;
grant all on table public.bsm_content_review_invitations to service_role;
grant all on table public.bsm_content_review_sessions to service_role;
grant all on table public.bsm_content_review_comment_threads to service_role;
grant all on table public.bsm_content_review_processing_jobs to service_role;
grant all on table public.bsm_content_review_summaries to service_role;
grant all on table public.bsm_content_review_deletion_tombstones to service_role;

-- Guest reviewers are intentionally not granted anon database access. Future
-- guest routes must use service-role reads only after invitation/session checks.
