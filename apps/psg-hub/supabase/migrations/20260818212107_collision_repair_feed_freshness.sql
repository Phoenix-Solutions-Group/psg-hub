create view public.v_collision_repair_feed_status
with (security_invoker = true)
as
select
  mapping.company_id,
  mapping.shop_id,
  fact.source_system,
  fact.source_export_id,
  source.file_modified_at,
  source.imported_at,
  source.status,
  round(extract(epoch from (pg_catalog.now() - source.file_modified_at))::numeric / 3600, 1) as source_age_hours,
  source.file_modified_at < pg_catalog.now() - interval '36 hours' as is_stale,
  count(*)::integer as repair_orders,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
 and mapping.mapping_status = 'mapped'
group by
  mapping.company_id,
  mapping.shop_id,
  fact.source_system,
  fact.source_export_id,
  source.file_modified_at,
  source.imported_at,
  source.status;

comment on view public.v_collision_repair_feed_status is
  'Service-only per-shop repair snapshot freshness. A source older than 36 hours is stale.';

revoke all on public.v_collision_repair_feed_status from public, anon, authenticated;
grant select on public.v_collision_repair_feed_status to service_role;
