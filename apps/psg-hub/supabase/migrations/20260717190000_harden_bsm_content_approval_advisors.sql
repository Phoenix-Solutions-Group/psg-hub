-- PSG-2119 - harden Supabase advisor warnings after PR #7 BSM content approval migrations.
--
-- This keeps the production data shape unchanged:
-- - the review-response snapshot trigger stays in place, but API roles can no
--   longer execute its security-definer function directly;
-- - BSM content approval policies keep the same access rules while caching
--   auth.uid() / private helper calls per statement for the Supabase advisor;
-- - redundant indexes from the close-together schema convergence migrations are
--   removed where an equivalent constraint/index remains.

create or replace function public.snapshot_review_response_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.review_response_versions (
    review_response_id,
    review_item_id,
    shop_id,
    version,
    draft_text,
    status,
    tone_preset,
    model_id,
    prompt_version,
    safety_flags,
    safety_overridden,
    approved_by,
    approved_at,
    restored_from_request_id,
    restored_from_version,
    restored_by,
    restored_at,
    recorded_at
  )
  values (
    new.id,
    new.review_item_id,
    new.shop_id,
    new.version,
    new.draft_text,
    new.status,
    new.tone_preset,
    new.model_id,
    new.prompt_version,
    coalesce(new.safety_flags, '{}'::text[]),
    coalesce(new.safety_overridden, false),
    new.approved_by,
    new.approved_at,
    new.restored_from_request_id,
    new.restored_from_version,
    new.restored_by,
    new.restored_at,
    pg_catalog.now()
  )
  on conflict (review_response_id, version) do update set
    draft_text = excluded.draft_text,
    status = excluded.status,
    tone_preset = excluded.tone_preset,
    model_id = excluded.model_id,
    prompt_version = excluded.prompt_version,
    safety_flags = excluded.safety_flags,
    safety_overridden = excluded.safety_overridden,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    restored_from_request_id = excluded.restored_from_request_id,
    restored_from_version = excluded.restored_from_version,
    restored_by = excluded.restored_by,
    restored_at = excluded.restored_at,
    recorded_at = excluded.recorded_at;

  return new;
end;
$$;

revoke all on function public.snapshot_review_response_version() from public;
revoke all on function public.snapshot_review_response_version() from anon;
revoke all on function public.snapshot_review_response_version() from authenticated;

drop policy if exists review_response_restore_requests_insert on public.review_response_restore_requests;
create policy review_response_restore_requests_insert
  on public.review_response_restore_requests
  for insert
  to authenticated
  with check (
    shop_id in (select public.user_shop_ids())
    and requested_by = (select auth.uid())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

drop policy if exists bsm_content_review_items_select_reviewer on public.bsm_content_review_items;
create policy bsm_content_review_items_select_reviewer
  on public.bsm_content_review_items
  for select
  to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and exists (
      select 1
      from public.bsm_content_review_reviewers r
      where r.review_item_id = bsm_content_review_items.id
        and (r.profile_id = (select auth.uid()) or r.profile_id is null)
    )
  );

drop policy if exists bsm_content_review_versions_select_reviewer on public.bsm_content_review_versions;
create policy bsm_content_review_versions_select_reviewer
  on public.bsm_content_review_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bsm_content_review_items i
      where i.id = bsm_content_review_versions.review_item_id
        and i.shop_id in (select public.user_shop_ids())
        and exists (
          select 1
          from public.bsm_content_review_reviewers r
          where r.review_item_id = i.id
            and (r.profile_id = (select auth.uid()) or r.profile_id is null)
        )
    )
  );

drop policy if exists bsm_content_review_reviewers_select_self on public.bsm_content_review_reviewers;
create policy bsm_content_review_reviewers_select_self
  on public.bsm_content_review_reviewers
  for select
  to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and (profile_id = (select auth.uid()) or profile_id is null)
  );

drop policy if exists bsm_content_review_comments_select_visible on public.bsm_content_review_comments;
create policy bsm_content_review_comments_select_visible
  on public.bsm_content_review_comments
  for select
  to authenticated
  using (
    visibility = 'shop_and_psg'
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
  );

drop policy if exists bsm_content_review_comments_insert_customer on public.bsm_content_review_comments;
create policy bsm_content_review_comments_insert_customer
  on public.bsm_content_review_comments
  for insert
  to authenticated
  with check (
    author_profile_id = (select auth.uid())
    and visibility = 'shop_and_psg'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id
      where i.id = bsm_content_review_comments.review_item_id
        and i.shop_id = bsm_content_review_comments.shop_id
        and i.shop_id in (select public.user_shop_ids())
        and r.profile_id = (select auth.uid())
    )
  );

drop policy if exists bsm_content_review_decisions_insert_customer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_insert_customer
  on public.bsm_content_review_decisions
  for insert
  to authenticated
  with check (
    actor_profile_id = (select auth.uid())
    and actor_role = 'customer'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = (select auth.uid())
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = (select auth.uid())
      where i.id = bsm_content_review_decisions.review_item_id
        and i.shop_id = bsm_content_review_decisions.shop_id
        and su.role in ('owner', 'manager')
    )
  );

drop policy if exists bsm_content_restore_requests_insert_customer on public.bsm_content_restore_requests;
create policy bsm_content_restore_requests_insert_customer
  on public.bsm_content_restore_requests
  for insert
  to authenticated
  with check (
    requester_profile_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = (select auth.uid())
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = (select auth.uid())
      where i.id = bsm_content_restore_requests.review_item_id
        and i.shop_id = bsm_content_restore_requests.shop_id
        and su.role in ('owner', 'manager')
    )
  );

drop policy if exists content_approval_files_select on public.content_approval_files;
create policy content_approval_files_select on public.content_approval_files
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_comments_select on public.content_approval_comments;
create policy content_approval_comments_select on public.content_approval_comments
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_decisions_select on public.content_approval_decisions;
create policy content_approval_decisions_select on public.content_approval_decisions
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_versions_select on public.content_approval_versions;
create policy content_approval_versions_select on public.content_approval_versions
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_restore_requests_select on public.content_approval_restore_requests;
create policy content_approval_restore_requests_select on public.content_approval_restore_requests
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_archives_select on public.content_approval_archives;
create policy content_approval_archives_select on public.content_approval_archives
  for select
  to authenticated
  using ((select private.user_can_read_content_approval_record(content_item_id, visibility)));

drop policy if exists content_approval_files_psg_write on public.content_approval_files;
create policy content_approval_files_psg_write on public.content_approval_files
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop policy if exists content_approval_comments_psg_write on public.content_approval_comments;
create policy content_approval_comments_psg_write on public.content_approval_comments
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop policy if exists content_approval_decisions_psg_write on public.content_approval_decisions;
create policy content_approval_decisions_psg_write on public.content_approval_decisions
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop policy if exists content_approval_versions_psg_write on public.content_approval_versions;
create policy content_approval_versions_psg_write on public.content_approval_versions
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop policy if exists content_approval_restore_requests_psg_write on public.content_approval_restore_requests;
create policy content_approval_restore_requests_psg_write on public.content_approval_restore_requests
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop policy if exists content_approval_archives_psg_write on public.content_approval_archives;
create policy content_approval_archives_psg_write on public.content_approval_archives
  for all
  to authenticated
  using ((select private.current_user_is_psg()))
  with check ((select private.current_user_is_psg()));

drop index if exists public.bsm_content_review_versions_item_idx;
drop index if exists public.bsm_content_review_events_item_idx;
