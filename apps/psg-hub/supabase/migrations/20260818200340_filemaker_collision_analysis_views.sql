-- Service-only, PII-free business analysis views over the reconciled snapshot.

create or replace view public.v_collision_filemaker_zip_summary
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  fact.customer_zip,
  fact.customer_state,
  count(*)::integer as repair_orders,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
where fact.customer_zip is not null
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  fact.customer_zip,
  fact.customer_state;

create or replace view public.v_collision_filemaker_vehicle_summary
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  regexp_replace(lower(trim(fact.vehicle_make)), '[^a-z0-9]+', ' ', 'g') as vehicle_make_normalized,
  regexp_replace(lower(trim(fact.vehicle_model)), '[^a-z0-9]+', ' ', 'g') as vehicle_model_normalized,
  mode() within group (order by fact.vehicle_make) as vehicle_make,
  mode() within group (order by fact.vehicle_model) as vehicle_model,
  count(*)::integer as repair_orders,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
where fact.vehicle_make is not null
   or fact.vehicle_model is not null
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  regexp_replace(lower(trim(fact.vehicle_make)), '[^a-z0-9]+', ' ', 'g'),
  regexp_replace(lower(trim(fact.vehicle_model)), '[^a-z0-9]+', ' ', 'g');

create or replace view public.v_collision_filemaker_seasonality
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  extract(year from fact.arrival_date)::integer as arrival_year,
  extract(month from fact.arrival_date)::integer as arrival_month,
  count(*)::integer as repair_orders,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  round(avg(fact.completion_date - fact.arrival_date), 2) as average_cycle_days
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
where fact.arrival_date is not null
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  extract(year from fact.arrival_date)::integer,
  extract(month from fact.arrival_date)::integer;

create or replace view public.v_collision_filemaker_payment_mix
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  fact.payment_category,
  fact.is_insured,
  count(*)::integer as repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  fact.payment_category,
  fact.is_insured;

create or replace view public.v_collision_filemaker_quality_summary
with (security_invoker = true)
as
with facts as (
  select fact.*
  from public.collision_repair_facts fact
  join public.collision_repair_sources source
    on source.source_export_id = fact.source_export_id
   and source.status = 'loaded'
), totals as (
  select source_shop_key, count(*)::integer as repair_orders
  from facts
  group by source_shop_key
)
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  issue.value as quality_issue,
  count(*)::integer as affected_repairs,
  total.repair_orders,
  round(count(*)::numeric * 100 / total.repair_orders, 2) as affected_percent
from facts fact
cross join lateral unnest(fact.quality_issues) as issue(value)
join totals total on total.source_shop_key = fact.source_shop_key
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  issue.value,
  total.repair_orders;

comment on view public.v_collision_filemaker_zip_summary is
  'PII-free repair volume and value by source shop and customer ZIP.';
comment on view public.v_collision_filemaker_vehicle_summary is
  'PII-free repair volume and value by source shop and normalized vehicle make/model.';
comment on view public.v_collision_filemaker_seasonality is
  'PII-free monthly-by-year repair volume, value, insurance mix, and cycle time by source shop.';
comment on view public.v_collision_filemaker_payment_mix is
  'PII-free repair volume and value by source shop and payment classification.';
comment on view public.v_collision_filemaker_quality_summary is
  'PII-free source data quality issue counts and rates by source shop.';

revoke all on public.v_collision_filemaker_zip_summary from anon, authenticated;
revoke all on public.v_collision_filemaker_vehicle_summary from anon, authenticated;
revoke all on public.v_collision_filemaker_seasonality from anon, authenticated;
revoke all on public.v_collision_filemaker_payment_mix from anon, authenticated;
revoke all on public.v_collision_filemaker_quality_summary from anon, authenticated;
grant select on public.v_collision_filemaker_zip_summary to service_role;
grant select on public.v_collision_filemaker_vehicle_summary to service_role;
grant select on public.v_collision_filemaker_seasonality to service_role;
grant select on public.v_collision_filemaker_payment_mix to service_role;
grant select on public.v_collision_filemaker_quality_summary to service_role;
