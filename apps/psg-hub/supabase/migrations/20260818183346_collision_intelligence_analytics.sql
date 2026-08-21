-- Governed, PII-minimized analytics views for collision-repair intelligence.
-- Rollback: drop the four views below in reverse dependency order.

create or replace view public.v_collision_repair_orders
with (security_invoker = true)
as
with normalized as (
  select
    ro.id as repair_order_id,
    ro.company_id,
    c.shop_id,
    c.name as company_name,
    case
      when ro.dates_json ->> 'date_in' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (ro.dates_json ->> 'date_in')::date
    end as arrival_date,
    case
      when ro.dates_json ->> 'date_out' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (ro.dates_json ->> 'date_out')::date
    end as completion_date,
    ro.repair_amount_cents,
    lower(regexp_replace(
      btrim(coalesce(ro.payload_jsonb #>> '{advantage2,payType}', '')),
      '\s+',
      ' ',
      'g'
    )) as normalized_pay_type,
    nullif(upper(left(
      regexp_replace(coalesce(rc.address ->> 'postal_code', ''), '[^0-9]', '', 'g'),
      5
    )), '') as customer_zip,
    nullif(upper(btrim(rc.address ->> 'state')), '') as customer_state,
    nullif(btrim(ro.payload_jsonb #>> '{vehicle,make}'), '') as vehicle_make,
    nullif(btrim(ro.payload_jsonb #>> '{vehicle,model}'), '') as vehicle_model,
    ic.name as insurance_company_name,
    ro.status,
    ro.total_loss_flag,
    ro.source_system
  from public.repair_orders ro
  join public.repair_customers rc on rc.id = ro.repair_customer_id
  join public.companies c on c.id = ro.company_id
  left join public.insurance_companies ic on ic.id = ro.insurance_company_id
), categorized as (
  select
    normalized.*,
    case
      when normalized_pay_type in (
        'customer insurance',
        'claimant (other insurance)'
      ) then 'insurance'
      when normalized_pay_type = 'customer pay' then 'customer'
      when normalized_pay_type = 'third party pay' then 'third_party'
      when normalized_pay_type = 'non-insurance' then 'non_insurance'
      else 'unknown'
    end as payment_category
  from normalized
)
select
  repair_order_id,
  company_id,
  shop_id,
  company_name,
  arrival_date,
  completion_date,
  completion_date - arrival_date as cycle_days,
  repair_amount_cents,
  round(repair_amount_cents::numeric / 100, 2) as repair_amount,
  payment_category,
  case
    when payment_category = 'insurance' then true
    when payment_category = 'unknown' then null
    else false
  end as is_insured,
  customer_zip,
  customer_state,
  vehicle_make,
  vehicle_model,
  insurance_company_name,
  status,
  total_loss_flag,
  source_system
from categorized;

comment on view public.v_collision_repair_orders is
  'PII-minimized repair-order fact view. Insurance is derived from Advantage payType; unknown values remain null rather than being guessed.';

create or replace view public.v_collision_weekly_demand
with (security_invoker = true)
as
select
  company_id,
  shop_id,
  company_name,
  date_trunc('week', arrival_date)::date as week_start,
  count(*)::integer as repair_orders,
  count(*) filter (where is_insured is true)::integer as insured_repair_orders,
  count(*) filter (where is_insured is false)::integer as non_insured_repair_orders,
  count(*) filter (where is_insured is null)::integer as unknown_payment_repair_orders,
  sum(repair_amount_cents)::bigint as repair_value_cents,
  round(avg(repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  round(avg(cycle_days)::numeric, 2) as average_cycle_days
from public.v_collision_repair_orders
where arrival_date is not null
group by company_id, shop_id, company_name, date_trunc('week', arrival_date)::date;

comment on view public.v_collision_weekly_demand is
  'Weekly Monday-start repair demand and value. Missing weeks are zero-filled in v_collision_forecast_training_weekly.';

create or replace view public.v_collision_weather_monthly
with (security_invoker = true)
as
with portfolio as (
  select
    company_id,
    shop_id,
    company_name,
    customer_zip,
    count(*)::bigint as historical_repair_orders
  from public.v_collision_repair_orders
  where customer_zip ~ '^[0-9]{5}$'
  group by company_id, shop_id, company_name, customer_zip
), months as (
  select distinct month
  from public.storm_zip_monthly
  where zip <> '__UNMATCHED__'
), exposure as (
  select
    p.company_id,
    p.shop_id,
    p.company_name,
    m.month,
    count(*)::integer as customer_zip_count,
    count(*) filter (where s.zip is not null)::integer as weather_zip_count,
    round(
      100 * (sum(p.historical_repair_orders) filter (where s.zip is not null))::numeric
        / nullif(sum(p.historical_repair_orders), 0),
      2
    ) as weather_coverage_pct,
    round(sum(coalesce(s.total_events, 0) * p.historical_repair_orders)::numeric
      / nullif(sum(p.historical_repair_orders), 0), 4) as weighted_total_events,
    round(sum(coalesce(s.hail_events, 0) * p.historical_repair_orders)::numeric
      / nullif(sum(p.historical_repair_orders), 0), 4) as weighted_hail_events,
    round(sum(coalesce(s.wind_events, 0) * p.historical_repair_orders)::numeric
      / nullif(sum(p.historical_repair_orders), 0), 4) as weighted_wind_events,
    round(sum(coalesce(s.tornado_events, 0) * p.historical_repair_orders)::numeric
      / nullif(sum(p.historical_repair_orders), 0), 4) as weighted_tornado_events,
    round(sum(coalesce(s.weighted_storm_demand_score, 0) * p.historical_repair_orders)::numeric
      / nullif(sum(p.historical_repair_orders), 0), 4) as weighted_storm_demand_score,
    max(s.refreshed_at) as weather_refreshed_at
  from portfolio p
  cross join months m
  left join public.storm_zip_monthly s
    on s.zip = p.customer_zip
   and s.month = m.month
  group by p.company_id, p.shop_id, p.company_name, m.month
), orders_by_month as (
  select
    company_id,
    date_trunc('month', arrival_date)::date as month,
    count(*)::integer as repair_orders,
    count(*) filter (where is_insured is true)::integer as insured_repair_orders,
    sum(repair_amount_cents)::bigint as repair_value_cents,
    round(avg(cycle_days)::numeric, 2) as average_cycle_days
  from public.v_collision_repair_orders
  where arrival_date is not null
  group by company_id, date_trunc('month', arrival_date)::date
)
select
  e.company_id,
  e.shop_id,
  e.company_name,
  e.month,
  coalesce(o.repair_orders, 0) as repair_orders,
  coalesce(o.insured_repair_orders, 0) as insured_repair_orders,
  coalesce(o.repair_value_cents, 0) as repair_value_cents,
  o.average_cycle_days,
  e.customer_zip_count,
  e.weather_zip_count,
  e.weather_coverage_pct,
  e.weighted_total_events,
  e.weighted_hail_events,
  e.weighted_wind_events,
  e.weighted_tornado_events,
  e.weighted_storm_demand_score,
  e.weather_refreshed_at
from exposure e
left join orders_by_month o
  on o.company_id = e.company_id
 and o.month = e.month;

comment on view public.v_collision_weather_monthly is
  'Historical-repair-weighted monthly NOAA exposure by company. Coverage is explicit; exposure is not an insurance-claim estimate.';

create or replace view public.v_collision_forecast_training_weekly
with (security_invoker = true)
as
with bounds as (
  select
    company_id,
    shop_id,
    company_name,
    min(week_start) as min_week,
    max(week_start) as max_week
  from public.v_collision_weekly_demand
  group by company_id, shop_id, company_name
), calendar as (
  select
    b.company_id,
    b.shop_id,
    b.company_name,
    gs::date as week_start
  from bounds b
  cross join lateral generate_series(b.min_week, b.max_week, interval '1 week') gs
), features as (
  select
    c.company_id,
    c.shop_id,
    c.company_name,
    c.week_start,
    coalesce(w.repair_orders, 0) as repair_orders,
    coalesce(w.insured_repair_orders, 0) as insured_repair_orders,
    coalesce(w.non_insured_repair_orders, 0) as non_insured_repair_orders,
    coalesce(w.unknown_payment_repair_orders, 0) as unknown_payment_repair_orders,
    coalesce(w.repair_value_cents, 0) as repair_value_cents,
    w.average_repair_amount,
    w.average_cycle_days,
    weather.weather_coverage_pct as prior_month_weather_coverage_pct,
    weather.weighted_hail_events as prior_month_weighted_hail_events,
    weather.weighted_wind_events as prior_month_weighted_wind_events,
    weather.weighted_tornado_events as prior_month_weighted_tornado_events,
    weather.weighted_storm_demand_score as prior_month_weighted_storm_demand_score
  from calendar c
  left join public.v_collision_weekly_demand w
    on w.company_id = c.company_id
   and w.week_start = c.week_start
  left join public.v_collision_weather_monthly weather
    on weather.company_id = c.company_id
   and weather.month = (
     date_trunc('month', c.week_start)::date - interval '1 month'
   )::date
)
select
  features.*,
  extract(isoyear from week_start)::integer as iso_year,
  extract(week from week_start)::integer as iso_week,
  lag(repair_orders, 1) over company_weeks as repair_orders_lag_1_week,
  lag(repair_orders, 4) over company_weeks as repair_orders_lag_4_weeks,
  lag(repair_orders, 52) over company_weeks as repair_orders_lag_52_weeks,
  round(avg(repair_orders) over (
    partition by company_id
    order by week_start
    rows between 4 preceding and 1 preceding
  ), 4) as trailing_4_week_average
from features
window company_weeks as (partition by company_id order by week_start);

comment on view public.v_collision_forecast_training_weekly is
  'Zero-filled weekly modeling frame with leakage-safe demand lags and prior-month weather exposure. Predicts repair arrivals, not individual crashes or claims.';

revoke all on public.v_collision_repair_orders from anon;
revoke all on public.v_collision_weekly_demand from anon;
revoke all on public.v_collision_weather_monthly from anon;
revoke all on public.v_collision_forecast_training_weekly from anon;

grant select on public.v_collision_repair_orders to authenticated, service_role;
grant select on public.v_collision_weekly_demand to authenticated, service_role;
grant select on public.v_collision_weather_monthly to authenticated, service_role;
grant select on public.v_collision_forecast_training_weekly to authenticated, service_role;
