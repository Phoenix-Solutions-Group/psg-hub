-- Portfolio-safe dashboard summary. One query returns the client-facing tool
-- readiness and actionable counts for every authorized shop without N+1 reads.
create or replace function public.dashboard_tool_statuses(p_shop_ids uuid[])
returns table (
  shop_id uuid,
  shop_url text,
  subscription_tier text,
  subscription_active boolean,
  linked_google_sources text[],
  ads_linked boolean,
  live_analytics_sources text[],
  pending_content_count bigint,
  draft_review_response_count bigint
)
language sql
stable
set search_path = ''
as $$
  select
    shops.id,
    shops.url,
    subscriptions.tier,
    coalesce(subscriptions.status = 'active', false),
    coalesce(google_accounts.sources, array[]::text[]),
    coalesce(ads_accounts.linked, false),
    coalesce(analytics.sources, array[]::text[]),
    coalesce(content.pending_count, 0),
    coalesce(review_drafts.draft_count, 0)
  from public.shops
  left join public.subscriptions
    on subscriptions.shop_id = shops.id
  left join lateral (
    select array_agg(distinct account.source) as sources
    from public.google_oauth_accounts account
    where account.shop_id = shops.id
      and account.status = 'linked'
  ) google_accounts on true
  left join lateral (
    select bool_or(account.status = 'linked') as linked
    from public.google_ads_accounts account
    where account.shop_id = shops.id
  ) ads_accounts on true
  left join lateral (
    select array_agg(distinct snapshot.source) as sources
    from public.analytics_snapshots snapshot
    where snapshot.shop_id = shops.id
      and snapshot.source is not null
      and snapshot.date >= current_date - 45
  ) analytics on true
  left join lateral (
    select count(*) as pending_count
    from public.content_items item
    where item.shop_id = shops.id
      and item.status = 'pending_review'
  ) content on true
  left join lateral (
    select count(*) as draft_count
    from public.review_responses response
    join public.review_items review
      on review.id = response.review_item_id
    where review.shop_id = shops.id
      and response.status = 'draft'
  ) review_drafts on true
  where shops.id = any(p_shop_ids);
$$;

revoke all on function public.dashboard_tool_statuses(uuid[]) from public, anon, authenticated;
grant execute on function public.dashboard_tool_statuses(uuid[]) to service_role;
