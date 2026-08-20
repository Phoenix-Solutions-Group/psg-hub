-- PSG-2972 — Close the direct-API tenant-integrity gap on review comments.
-- The route already scopes to the active shop. These policies also require the
-- referenced review and optional response to belong to the submitted shop, so
-- authenticated clients cannot create cross-shop relationships directly.

drop policy if exists review_response_comments_select on public.review_response_comments;
create policy review_response_comments_select on public.review_response_comments
  for select using (
    shop_id in (select public.user_shop_ids())
    and exists (
      select 1
      from public.review_items item
      where item.id = review_response_comments.review_item_id
        and item.shop_id = review_response_comments.shop_id
    )
  );

drop policy if exists review_response_comments_insert on public.review_response_comments;
create policy review_response_comments_insert on public.review_response_comments
  for insert with check (
    shop_id in (select public.user_shop_ids())
    and created_by = auth.uid()
    and exists (
      select 1
      from public.review_items item
      where item.id = review_response_comments.review_item_id
        and item.shop_id = review_response_comments.shop_id
    )
    and (
      review_response_id is null
      or exists (
        select 1
        from public.review_responses response
        where response.id = review_response_comments.review_response_id
          and response.review_item_id = review_response_comments.review_item_id
          and response.shop_id = review_response_comments.shop_id
      )
    )
  );
