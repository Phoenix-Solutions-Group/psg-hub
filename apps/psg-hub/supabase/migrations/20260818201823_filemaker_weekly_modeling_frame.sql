-- PII-free weekly modeling frames across all loaded FileMaker source shops.

create or replace view public.v_collision_filemaker_weekly_demand
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  date_trunc('week', fact.arrival_date)::date as week_start,
  count(*)::integer as repair_orders,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  count(*) filter (where fact.is_insured is false)::integer as non_insured_repair_orders,
  count(*) filter (where fact.is_insured is null)::integer as unknown_payment_repair_orders,
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
  date_trunc('week', fact.arrival_date)::date;

create or replace view public.v_collision_filemaker_forecast_training_weekly
with (security_invoker = true)
as
with bounds as (
  select
    source_shop_key,
    max(source_shop_name) as source_shop_name,
    company_id,
    shop_id,
    min(week_start) as min_week,
    max(week_start) as max_week
  from public.v_collision_filemaker_weekly_demand
  group by source_shop_key, company_id, shop_id
), calendar as (
  select
    bounds.source_shop_key,
    bounds.source_shop_name,
    bounds.company_id,
    bounds.shop_id,
    generated_week::date as week_start
  from bounds
  cross join lateral generate_series(
    bounds.min_week,
    bounds.max_week,
    interval '1 week'
  ) generated_week
), features as (
  select
    calendar.source_shop_key,
    calendar.source_shop_name,
    calendar.company_id,
    calendar.shop_id,
    calendar.week_start,
    coalesce(demand.repair_orders, 0) as repair_orders,
    coalesce(demand.insured_repair_orders, 0) as insured_repair_orders,
    coalesce(demand.non_insured_repair_orders, 0) as non_insured_repair_orders,
    coalesce(demand.unknown_payment_repair_orders, 0) as unknown_payment_repair_orders,
    coalesce(demand.repair_value_cents, 0) as repair_value_cents,
    demand.average_repair_amount,
    demand.average_cycle_days
  from calendar
  left join public.v_collision_filemaker_weekly_demand demand
    on demand.source_shop_key = calendar.source_shop_key
   and demand.week_start = calendar.week_start
)
select
  features.*,
  extract(isoyear from week_start)::integer as iso_year,
  extract(week from week_start)::integer as iso_week,
  lag(repair_orders, 1) over source_shop_weeks as repair_orders_lag_1_week,
  lag(repair_orders, 4) over source_shop_weeks as repair_orders_lag_4_weeks,
  lag(repair_orders, 52) over source_shop_weeks as repair_orders_lag_52_weeks,
  round(avg(repair_orders) over (
    partition by source_shop_key
    order by week_start
    rows between 4 preceding and 1 preceding
  ), 4) as trailing_4_week_average
from features
window source_shop_weeks as (
  partition by source_shop_key
  order by week_start
);

comment on view public.v_collision_filemaker_weekly_demand is
  'PII-free observed weekly repair demand for every loaded FileMaker source shop.';
comment on view public.v_collision_filemaker_forecast_training_weekly is
  'PII-free zero-filled weekly modeling frame with leakage-safe demand lags. Unmapped source shops are evaluation-only and are not publishable forecasts.';

revoke all on public.v_collision_filemaker_weekly_demand from anon, authenticated;
revoke all on public.v_collision_filemaker_forecast_training_weekly from anon, authenticated;
grant select on public.v_collision_filemaker_weekly_demand to service_role;
grant select on public.v_collision_filemaker_forecast_training_weekly to service_role;
