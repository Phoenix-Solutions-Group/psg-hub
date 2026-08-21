-- Rollback: restore v_collision_weather_monthly from
-- 20260818203911_collision_shop_first_forecasts.sql.

create or replace view public.v_collision_weather_monthly
with (security_invoker = true)
as
with portfolio as (
  select
    orders.company_id,
    orders.shop_id,
    orders.company_name,
    orders.customer_zip,
    count(*)::bigint as historical_repair_orders,
    exists (
      select 1
      from public.zipcode_boundaries boundary
      where boundary.zip_code = orders.customer_zip
    ) as has_weather_boundary
  from public.v_collision_repair_orders orders
  where orders.customer_zip ~ '^[0-9]{5}$'
  group by
    orders.company_id,
    orders.shop_id,
    orders.company_name,
    orders.customer_zip
), months as (
  select
    month,
    max(refreshed_at) as refreshed_at
  from public.storm_zip_monthly
  where zip <> '__UNMATCHED__'
  group by month
), exposure as (
  select
    portfolio.company_id,
    portfolio.shop_id,
    portfolio.company_name,
    months.month,
    count(*)::integer as customer_zip_count,
    count(*) filter (where portfolio.has_weather_boundary)::integer
      as weather_zip_count,
    round(
      100 * coalesce(
        sum(portfolio.historical_repair_orders)
          filter (where portfolio.has_weather_boundary),
        0
      )::numeric / nullif(sum(portfolio.historical_repair_orders), 0),
      2
    ) as weather_coverage_pct,
    round(sum(coalesce(storm.total_events, 0) * portfolio.historical_repair_orders)::numeric
      / nullif(sum(portfolio.historical_repair_orders), 0), 4) as weighted_total_events,
    round(sum(coalesce(storm.hail_events, 0) * portfolio.historical_repair_orders)::numeric
      / nullif(sum(portfolio.historical_repair_orders), 0), 4) as weighted_hail_events,
    round(sum(coalesce(storm.wind_events, 0) * portfolio.historical_repair_orders)::numeric
      / nullif(sum(portfolio.historical_repair_orders), 0), 4) as weighted_wind_events,
    round(sum(coalesce(storm.tornado_events, 0) * portfolio.historical_repair_orders)::numeric
      / nullif(sum(portfolio.historical_repair_orders), 0), 4) as weighted_tornado_events,
    round(sum(coalesce(storm.weighted_storm_demand_score, 0)
      * portfolio.historical_repair_orders)::numeric
      / nullif(sum(portfolio.historical_repair_orders), 0), 4)
      as weighted_storm_demand_score,
    max(months.refreshed_at) as weather_refreshed_at
  from portfolio
  cross join months
  left join public.storm_zip_monthly storm
    on storm.zip = portfolio.customer_zip
   and storm.month = months.month
  group by portfolio.company_id, portfolio.shop_id, portfolio.company_name, months.month
), orders_by_month as (
  select
    company_id,
    shop_id,
    date_trunc('month', arrival_date)::date as month,
    count(*)::integer as repair_orders,
    count(*) filter (where is_insured is true)::integer as insured_repair_orders,
    sum(repair_amount_cents)::bigint as repair_value_cents,
    round(avg(cycle_days)::numeric, 2) as average_cycle_days
  from public.v_collision_repair_orders
  where arrival_date is not null
  group by company_id, shop_id, date_trunc('month', arrival_date)::date
)
select
  exposure.company_id,
  exposure.shop_id,
  exposure.company_name,
  exposure.month,
  coalesce(orders.repair_orders, 0) as repair_orders,
  coalesce(orders.insured_repair_orders, 0) as insured_repair_orders,
  coalesce(orders.repair_value_cents, 0) as repair_value_cents,
  orders.average_cycle_days,
  exposure.customer_zip_count,
  exposure.weather_zip_count,
  exposure.weather_coverage_pct,
  exposure.weighted_total_events,
  exposure.weighted_hail_events,
  exposure.weighted_wind_events,
  exposure.weighted_tornado_events,
  exposure.weighted_storm_demand_score,
  exposure.weather_refreshed_at
from exposure
left join orders_by_month orders
  on orders.shop_id is not distinct from exposure.shop_id
 and orders.company_id is not distinct from exposure.company_id
 and orders.month = exposure.month;

comment on view public.v_collision_weather_monthly is
  'Historical-repair-weighted monthly NOAA exposure by shop. Coverage measures repair volume in ZIPs with loaded geographic boundaries; a missing ZIP-month event row means zero observed events, not missing weather coverage. Exposure is not an insurance-claim estimate.';

revoke all on public.v_collision_weather_monthly from public, anon, authenticated;
grant select on public.v_collision_weather_monthly to service_role;

do $$
begin
  if not coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'public.v_collision_weather_monthly'::regclass
  ), false) then
    raise exception 'v_collision_weather_monthly must remain security invoker';
  end if;

  if has_table_privilege('anon', 'public.v_collision_weather_monthly', 'select')
    or has_table_privilege('authenticated', 'public.v_collision_weather_monthly', 'select')
    or not has_table_privilege('service_role', 'public.v_collision_weather_monthly', 'select')
    or not has_table_privilege('service_role', 'public.zipcode_boundaries', 'select') then
    raise exception 'collision weather view grants are not service-role-only';
  end if;
end
$$;
