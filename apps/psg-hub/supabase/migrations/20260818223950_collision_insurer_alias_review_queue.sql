-- Rollback: drop view public.v_collision_insurer_alias_review_queue;
create or replace view public.v_collision_insurer_alias_review_queue
with (security_invoker = true)
as
select
  fact.insurance_company_normalized as source_label_normalized,
  mode() within group (order by fact.insurance_company_raw) as source_label_name,
  coalesce(review.review_status, 'candidate') as review_status,
  review.canonical_insurer_key,
  review.canonical_insurer_name,
  count(distinct fact.source_shop_key)::integer as source_shop_count,
  count(*)::integer as repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_insurer_alias_reviews review
  on review.source_label_normalized = fact.insurance_company_normalized
where fact.insurance_company_normalized is not null
group by
  fact.insurance_company_normalized,
  review.review_status,
  review.canonical_insurer_key,
  review.canonical_insurer_name;

comment on view public.v_collision_insurer_alias_review_queue is
  'Service-only global carrier-label review queue. Volumes are carrier-tagged repairs, not insurer claim counts.';

revoke all on public.v_collision_insurer_alias_review_queue
  from public, anon, authenticated;
grant select on public.v_collision_insurer_alias_review_queue to service_role;
