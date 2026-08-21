-- PSG-28: authenticated Review Workspace access requires an exact, active assignment.

alter table public.bsm_content_review_reviewers
  drop constraint if exists bsm_content_review_reviewers_unique_profile;
create unique index if not exists bsm_content_review_reviewers_legacy_profile_uniq
  on public.bsm_content_review_reviewers (review_item_id, profile_id)
  where round_id is null and profile_id is not null;
create unique index if not exists bsm_content_review_reviewers_round_profile_uniq
  on public.bsm_content_review_reviewers (round_id, review_item_id, profile_id)
  where round_id is not null and profile_id is not null;

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
    join public.shop_users su on su.shop_id = i.shop_id and su.user_id = (select auth.uid())
    join public.bsm_content_review_reviewers r
      on r.invitation_id = i.id
      and r.round_id = i.round_id
      and r.shop_id = i.shop_id
      and r.profile_id = (select auth.uid())
      and r.reviewer_role = 'reviewer'
      and r.removed_at is null
    where i.id = target_invitation_id
      and i.reviewer_profile_id = (select auth.uid())
      and i.status in ('sent', 'viewed', 'submitted')
      and i.expires_at > now()
      and i.revoked_at is null
      and p.current_round_id = i.round_id
      and p.status in ('active', 'inviting')
      and p.deleted_at is null
  )
$$;

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
        exists (
          select 1
          from public.bsm_content_review_invitations i
          where i.project_id = p.id
            and (select private.bsm_content_review_user_can_access_invitation(i.id))
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

drop policy if exists bsm_content_review_items_select_reviewer on public.bsm_content_review_items;
create policy bsm_content_review_items_select_reviewer
  on public.bsm_content_review_items for select to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and exists (
      select 1 from public.bsm_content_review_reviewers r
      where r.review_item_id = bsm_content_review_items.id
        and r.profile_id = (select auth.uid())
        and r.reviewer_role = 'reviewer'
        and r.removed_at is null
    )
  );

drop policy if exists bsm_content_review_versions_select_reviewer on public.bsm_content_review_versions;
create policy bsm_content_review_versions_select_reviewer
  on public.bsm_content_review_versions for select to authenticated
  using (
    exists (
      select 1
      from public.bsm_content_review_items i
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id
      where i.id = bsm_content_review_versions.review_item_id
        and i.shop_id in (select public.user_shop_ids())
        and r.profile_id = (select auth.uid())
        and r.reviewer_role = 'reviewer'
        and r.removed_at is null
    )
  );

drop policy if exists bsm_content_review_reviewers_select_self on public.bsm_content_review_reviewers;
create policy bsm_content_review_reviewers_select_self
  on public.bsm_content_review_reviewers for select to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    and profile_id = (select auth.uid())
    and removed_at is null
  );

drop policy if exists bsm_content_review_comments_insert_customer on public.bsm_content_review_comments;
create policy bsm_content_review_comments_insert_customer
  on public.bsm_content_review_comments for insert to authenticated
  with check (
    project_id is null
    and invitation_id is null
    and author_profile_id = (select auth.uid())
    and visibility = 'shop_and_psg'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id
      where i.id = bsm_content_review_comments.review_item_id
        and i.project_id is null
        and i.shop_id = bsm_content_review_comments.shop_id
        and i.shop_id in (select public.user_shop_ids())
        and r.profile_id = (select auth.uid())
        and r.reviewer_role = 'reviewer'
        and r.removed_at is null
    )
  );

drop policy if exists bsm_content_review_decisions_insert_customer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_insert_customer
  on public.bsm_content_review_decisions for insert to authenticated
  with check (
    project_id is null
    and invitation_id is null
    and actor_profile_id = (select auth.uid())
    and actor_role = 'customer'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = (select auth.uid())
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = (select auth.uid())
      where i.id = bsm_content_review_decisions.review_item_id
        and i.project_id is null
        and i.shop_id = bsm_content_review_decisions.shop_id
        and su.role in ('owner', 'manager')
        and r.reviewer_role = 'reviewer'
        and r.removed_at is null
    )
  );

drop policy if exists bsm_content_restore_requests_insert_customer on public.bsm_content_restore_requests;
create policy bsm_content_restore_requests_insert_customer
  on public.bsm_content_restore_requests for insert to authenticated
  with check (
    requester_profile_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from public.bsm_content_review_items i
      join public.shop_users su on su.shop_id = i.shop_id and su.user_id = (select auth.uid())
      join public.bsm_content_review_reviewers r on r.review_item_id = i.id and r.profile_id = (select auth.uid())
      where i.id = bsm_content_restore_requests.review_item_id
        and i.project_id is null
        and i.shop_id = bsm_content_restore_requests.shop_id
        and su.role in ('owner', 'manager')
        and r.reviewer_role = 'reviewer'
        and r.removed_at is null
    )
  );

drop policy if exists bsm_content_review_comments_select_visible on public.bsm_content_review_comments;
create policy bsm_content_review_comments_select_visible
  on public.bsm_content_review_comments for select to authenticated
  using (
    visibility = 'shop_and_psg'
    and (
      (
        project_id is null
        and exists (
          select 1
          from public.bsm_content_review_reviewers r
          where r.review_item_id = bsm_content_review_comments.review_item_id
            and r.profile_id = (select auth.uid())
            and r.reviewer_role = 'reviewer'
            and r.removed_at is null
        )
      )
      or (
        project_id is not null
        and invitation_id is not null
        and (select private.bsm_content_review_user_can_access_invitation(invitation_id))
      )
      or (
        project_id is not null
        and (select private.current_user_has_fn('manage_bsm_content_approvals'))
        and (select private.bsm_content_review_user_can_access_project(project_id))
      )
    )
  );

drop policy if exists bsm_content_review_decisions_select_reviewer on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_select_reviewer
  on public.bsm_content_review_decisions for select to authenticated
  using (
    (
      project_id is null
      and exists (
        select 1
        from public.bsm_content_review_reviewers r
        where r.review_item_id = bsm_content_review_decisions.review_item_id
          and r.profile_id = (select auth.uid())
          and r.reviewer_role = 'reviewer'
          and r.removed_at is null
      )
    )
    or (
      project_id is not null
      and invitation_id is not null
      and (select private.bsm_content_review_user_can_access_invitation(invitation_id))
    )
    or (
      project_id is not null
      and (select private.current_user_has_fn('manage_bsm_content_approvals'))
      and (select private.bsm_content_review_user_can_access_project(project_id))
    )
  );
