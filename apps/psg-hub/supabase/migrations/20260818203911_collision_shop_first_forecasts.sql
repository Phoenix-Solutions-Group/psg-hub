-- Shop is the PSG Hub tenant boundary. Company remains optional attribution for
-- legacy repair data; FileMaker shops no longer require a synthetic company row.

alter table public.collision_shop_mappings
  drop constraint collision_shop_mappings_check,
  add constraint collision_shop_mappings_shop_first_check check (
    (mapping_status = 'mapped' and shop_id is not null)
    or (
      mapping_status <> 'mapped'
      and company_id is null
      and shop_id is null
    )
  );

alter table public.collision_forecast_model_registry
  drop constraint collision_forecast_model_registry_pkey,
  drop constraint collision_forecast_model_registry_company_id_fkey,
  alter column company_id drop not null;

drop index public.collision_forecast_model_registry_shop_idx;

alter table public.collision_forecast_model_registry
  add primary key (shop_id),
  add constraint collision_forecast_model_registry_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete set null;

alter table public.collision_demand_forecasts
  drop constraint collision_demand_forecasts_company_id_forecast_week_model_k_key,
  drop constraint collision_demand_forecasts_company_id_fkey,
  alter column company_id drop not null,
  add constraint collision_demand_forecasts_shop_id_forecast_week_model_key_key
    unique (shop_id, forecast_week, model_key),
  add constraint collision_demand_forecasts_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete set null;

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
), filemaker as (
  select
    (
      substring(fact.source_record_hash, 1, 8) || '-' ||
      substring(fact.source_record_hash, 9, 4) || '-' ||
      substring(fact.source_record_hash, 13, 4) || '-' ||
      substring(fact.source_record_hash, 17, 4) || '-' ||
      substring(fact.source_record_hash, 21, 12)
    )::uuid as repair_order_id,
    mapping.company_id,
    mapping.shop_id,
    coalesce(company.name, shop.name) as company_name,
    fact.arrival_date,
    fact.completion_date,
    fact.completion_date - fact.arrival_date as cycle_days,
    fact.repair_amount_cents::integer as repair_amount_cents,
    round(fact.repair_amount_cents::numeric / 100, 2) as repair_amount,
    fact.payment_category,
    fact.is_insured,
    fact.customer_zip,
    fact.customer_state,
    fact.vehicle_make,
    fact.vehicle_model,
    fact.insurance_company_raw as insurance_company_name,
    'historical'::text as status,
    regexp_replace(lower(coalesce(fact.pay_type_raw, '')), '[^a-z0-9]+', ' ', 'g')
      in ('total loss', 'tloss') as total_loss_flag,
    fact.source_system
  from public.collision_repair_facts fact
  join public.collision_repair_sources source
    on source.source_export_id = fact.source_export_id
   and source.status = 'loaded'
  join public.collision_shop_mappings mapping
    on mapping.source_system = fact.source_system
   and mapping.source_shop_key = fact.source_shop_key
   and mapping.mapping_status = 'mapped'
  join public.shops shop on shop.id = mapping.shop_id
  left join public.companies company on company.id = mapping.company_id
), filemaker_shops as (
  select distinct shop_id from filemaker
), hub as (
  select
    categorized.repair_order_id,
    categorized.company_id,
    categorized.shop_id,
    categorized.company_name,
    categorized.arrival_date,
    categorized.completion_date,
    categorized.completion_date - categorized.arrival_date as cycle_days,
    categorized.repair_amount_cents,
    round(categorized.repair_amount_cents::numeric / 100, 2) as repair_amount,
    categorized.payment_category,
    case
      when categorized.payment_category = 'insurance' then true
      when categorized.payment_category = 'unknown' then null
      else false
    end as is_insured,
    categorized.customer_zip,
    categorized.customer_state,
    categorized.vehicle_make,
    categorized.vehicle_model,
    categorized.insurance_company_name,
    categorized.status,
    categorized.total_loss_flag,
    categorized.source_system
  from categorized
  where not exists (
    select 1
    from filemaker_shops
    where filemaker_shops.shop_id = categorized.shop_id
  )
)
select * from hub
union all
select * from filemaker;

comment on view public.v_collision_repair_orders is
  'PII-minimized repair facts keyed to the PSG Hub shop. A complete mapped FileMaker snapshot replaces legacy rows for that shop.';

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
  on o.shop_id = e.shop_id
 and o.month = e.month;

comment on view public.v_collision_weather_monthly is
  'Historical-repair-weighted monthly NOAA exposure by shop. Coverage is explicit; exposure is not an insurance-claim estimate.';

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
    bounds.company_id,
    bounds.shop_id,
    bounds.company_name,
    generated_week::date as week_start
  from bounds
  cross join lateral generate_series(
    bounds.min_week,
    bounds.max_week,
    interval '1 week'
  ) generated_week
), features as (
  select
    calendar.company_id,
    calendar.shop_id,
    calendar.company_name,
    calendar.week_start,
    coalesce(demand.repair_orders, 0) as repair_orders,
    coalesce(demand.insured_repair_orders, 0) as insured_repair_orders,
    coalesce(demand.non_insured_repair_orders, 0) as non_insured_repair_orders,
    coalesce(demand.unknown_payment_repair_orders, 0) as unknown_payment_repair_orders,
    coalesce(demand.repair_value_cents, 0) as repair_value_cents,
    demand.average_repair_amount,
    demand.average_cycle_days,
    weather.weather_coverage_pct as prior_month_weather_coverage_pct,
    weather.weighted_hail_events as prior_month_weighted_hail_events,
    weather.weighted_wind_events as prior_month_weighted_wind_events,
    weather.weighted_tornado_events as prior_month_weighted_tornado_events,
    weather.weighted_storm_demand_score as prior_month_weighted_storm_demand_score
  from calendar
  left join public.v_collision_weekly_demand demand
    on demand.shop_id = calendar.shop_id
   and demand.week_start = calendar.week_start
  left join public.v_collision_weather_monthly weather
    on weather.shop_id = calendar.shop_id
   and weather.month = (
     date_trunc('month', calendar.week_start)::date - interval '1 month'
   )::date
)
select
  features.*,
  extract(isoyear from week_start)::integer as iso_year,
  extract(week from week_start)::integer as iso_week,
  lag(repair_orders, 1) over shop_weeks as repair_orders_lag_1_week,
  lag(repair_orders, 4) over shop_weeks as repair_orders_lag_4_weeks,
  lag(repair_orders, 52) over shop_weeks as repair_orders_lag_52_weeks,
  round(avg(repair_orders) over (
    partition by shop_id
    order by week_start
    rows between 4 preceding and 1 preceding
  ), 4) as trailing_4_week_average
from features
window shop_weeks as (
  partition by shop_id
  order by week_start
);

comment on view public.v_collision_forecast_training_weekly is
  'Zero-filled shop-week modeling frame with leakage-safe demand lags and prior-month weather exposure.';

create or replace function public.run_collision_weekly_forecasts(
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_forecast_week date := pg_catalog.date_trunc('week', p_as_of_date::timestamp)::date;
  v_candidate record;
  v_recent_prediction numeric(8,2);
  v_seasonal_prediction numeric(8,2);
  v_prediction numeric(8,2);
  v_history_weeks integer;
  v_source_age integer;
  v_status text;
  v_reason text;
  v_published integer := 0;
  v_stale integer := 0;
  v_insufficient integer := 0;
  v_observed integer := 0;
begin
  if p_as_of_date is null or p_as_of_date > current_date + 1 then
    raise exception 'Forecast as-of date must not be null or more than one day in the future';
  end if;

  update public.collision_demand_forecasts forecast
  set actual_repair_orders = coalesce((
        select demand.repair_orders
        from public.v_collision_weekly_demand demand
        where demand.shop_id = forecast.shop_id
          and demand.week_start = forecast.forecast_week
      ), 0),
      absolute_error = pg_catalog.abs(
        coalesce((
          select demand.repair_orders
          from public.v_collision_weekly_demand demand
          where demand.shop_id = forecast.shop_id
            and demand.week_start = forecast.forecast_week
        ), 0)::numeric - forecast.predicted_repair_orders
      ),
      observed_at = pg_catalog.now()
  where forecast.status = 'published'
    and forecast.forecast_week < v_forecast_week
    and forecast.actual_repair_orders is null;

  get diagnostics v_observed = row_count;

  for v_candidate in
    select
      orders.company_id,
      orders.shop_id,
      orders.company_name,
      max(orders.arrival_date) as latest_arrival_date,
      coalesce(registry.model_key, 'trailing4_v1') as model_key,
      registry.promotion_status = 'approved' as model_approved,
      registry.interval_half_width,
      registry.interval_multiplier,
      registry.mae_improvement_pct
    from public.v_collision_repair_orders orders
    left join public.collision_forecast_model_registry registry
      on registry.shop_id = orders.shop_id
    where orders.arrival_date is not null
      and orders.shop_id is not null
    group by
      orders.company_id,
      orders.shop_id,
      orders.company_name,
      registry.model_key,
      registry.promotion_status,
      registry.interval_half_width,
      registry.interval_multiplier,
      registry.mae_improvement_pct
  loop
    select pg_catalog.round(pg_catalog.avg(history.repair_orders), 2), count(*)::integer
      into v_recent_prediction, v_history_weeks
    from (
      select demand.repair_orders
      from public.v_collision_weekly_demand demand
      where demand.shop_id = v_candidate.shop_id
        and demand.week_start < v_forecast_week
      order by demand.week_start desc
      limit 4
    ) history;

    select demand.repair_orders
      into v_seasonal_prediction
    from public.v_collision_weekly_demand demand
    where demand.shop_id = v_candidate.shop_id
      and demand.week_start = v_forecast_week - 364;

    v_prediction := case
      when v_candidate.model_key = 'seasonal_recent_blend_v1'
        and v_seasonal_prediction is not null
        then pg_catalog.round((v_recent_prediction + v_seasonal_prediction) / 2, 2)
      else v_recent_prediction
    end;
    v_source_age := greatest(0, p_as_of_date - v_candidate.latest_arrival_date);

    if not coalesce(v_candidate.model_approved, false) then
      v_status := 'insufficient_history';
      v_reason := 'No approved model has beaten the seasonal baseline for this shop.';
      v_prediction := null;
      v_insufficient := v_insufficient + 1;
    elsif v_history_weeks < 4 then
      v_status := 'insufficient_history';
      v_reason := 'At least four completed repair weeks are required.';
      v_prediction := null;
      v_insufficient := v_insufficient + 1;
    elsif v_candidate.model_key = 'seasonal_recent_blend_v1'
      and v_seasonal_prediction is null then
      v_status := 'insufficient_history';
      v_reason := 'The approved blend requires the same shop week from 52 weeks earlier.';
      v_prediction := null;
      v_insufficient := v_insufficient + 1;
    elsif v_source_age > 14 then
      v_status := 'stale_source';
      v_reason := pg_catalog.format(
        'Latest repair arrival is %s days old; live publication requires 14 days or less.',
        v_source_age
      );
      v_prediction := null;
      v_stale := v_stale + 1;
    else
      v_status := 'published';
      v_reason := pg_catalog.format(
        '%s beat the shop seasonal MAE by %s%%; its empirical interval is widened by %sx for cross-shop coverage.',
        v_candidate.model_key,
        v_candidate.mae_improvement_pct,
        v_candidate.interval_multiplier
      );
      v_published := v_published + 1;
    end if;

    insert into public.collision_demand_forecasts (
      company_id,
      shop_id,
      company_name,
      forecast_week,
      model_key,
      predicted_repair_orders,
      lower_repair_orders,
      upper_repair_orders,
      prediction_interval_pct,
      source_latest_arrival_date,
      source_age_days,
      status,
      status_reason,
      generated_at
    ) values (
      v_candidate.company_id,
      v_candidate.shop_id,
      v_candidate.company_name,
      v_forecast_week,
      v_candidate.model_key,
      v_prediction,
      case
        when v_prediction is null then null
        else greatest(
          0,
          pg_catalog.floor(v_prediction - v_candidate.interval_half_width)::integer
        )
      end,
      case
        when v_prediction is null then null
        else pg_catalog.ceil(v_prediction + v_candidate.interval_half_width)::integer
      end,
      80,
      v_candidate.latest_arrival_date,
      v_source_age,
      v_status,
      v_reason,
      pg_catalog.now()
    )
    on conflict (shop_id, forecast_week, model_key) do update set
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      predicted_repair_orders = excluded.predicted_repair_orders,
      lower_repair_orders = excluded.lower_repair_orders,
      upper_repair_orders = excluded.upper_repair_orders,
      prediction_interval_pct = excluded.prediction_interval_pct,
      source_latest_arrival_date = excluded.source_latest_arrival_date,
      source_age_days = excluded.source_age_days,
      status = excluded.status,
      status_reason = excluded.status_reason,
      generated_at = excluded.generated_at;
  end loop;

  return pg_catalog.jsonb_build_object(
    'forecast_week', v_forecast_week,
    'published', v_published,
    'stale_source', v_stale,
    'insufficient_history', v_insufficient,
    'observations_updated', v_observed
  );
end;
$$;

comment on table public.collision_shop_mappings is
  'Reviewed source-shop mappings. Shop is required when mapped; company attribution is optional.';
comment on table public.collision_forecast_model_registry is
  'Service-only shop model promotion evidence. An approved model must beat its shop seasonal baseline.';
comment on table public.collision_demand_forecasts is
  'Service-only shop-keyed weekly demand forecasts. Non-published rows have null predictions.';
comment on function public.run_collision_weekly_forecasts(date) is
  'Scores approved shop models and publishes only when repair arrivals are no more than 14 days stale. Service role only.';
