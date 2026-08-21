-- Persist model promotion evidence and require an approved company model before
-- publishing a weekly forecast.

create table public.collision_forecast_model_registry (
  company_id uuid primary key references public.companies(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  source_system text not null,
  source_shop_key text not null,
  model_key text not null,
  promotion_status text not null,
  seasonal_baseline_mae numeric(10,4) not null,
  model_mae numeric(10,4) not null,
  model_wape_pct numeric(8,4) not null,
  mae_improvement_pct numeric(8,4) not null,
  calibration_weeks integer not null,
  holdout_weeks integer not null,
  holdout_start date not null,
  holdout_end date not null,
  base_interval_half_width numeric(8,4) not null,
  interval_multiplier numeric(6,3) not null,
  interval_half_width integer not null,
  interval_validation_coverage_pct numeric(8,4) not null,
  evaluation_scope text not null,
  evaluated_at timestamptz not null,
  approved_at timestamptz,
  unique (source_system, source_shop_key),
  foreign key (source_system, source_shop_key)
    references public.collision_shop_mappings(source_system, source_shop_key)
    on update cascade on delete restrict,
  check (model_key in ('trailing4_v1', 'seasonal_recent_blend_v1')),
  check (promotion_status in ('review', 'approved', 'retired')),
  check (seasonal_baseline_mae >= 0 and model_mae >= 0),
  check (model_wape_pct >= 0),
  check (mae_improvement_pct between -100 and 100),
  check (calibration_weeks > 0 and holdout_weeks > 0),
  check (holdout_end >= holdout_start),
  check (base_interval_half_width >= 0 and interval_multiplier >= 1),
  check (interval_half_width >= ceiling(base_interval_half_width * interval_multiplier)),
  check (interval_validation_coverage_pct between 0 and 100),
  check (
    promotion_status <> 'approved'
    or (
      model_mae < seasonal_baseline_mae
      and mae_improvement_pct > 0
      and approved_at is not null
    )
  )
);

create index collision_forecast_model_registry_shop_idx
  on public.collision_forecast_model_registry (shop_id);

alter table public.collision_forecast_model_registry enable row level security;
revoke all on public.collision_forecast_model_registry from anon, authenticated;
grant select, insert, update on public.collision_forecast_model_registry to service_role;

comment on table public.collision_forecast_model_registry is
  'Service-only model promotion evidence. A forecast is publishable only when its company model is approved and its source is fresh.';

insert into public.collision_forecast_model_registry (
  company_id,
  shop_id,
  source_system,
  source_shop_key,
  model_key,
  promotion_status,
  seasonal_baseline_mae,
  model_mae,
  model_wape_pct,
  mae_improvement_pct,
  calibration_weeks,
  holdout_weeks,
  holdout_start,
  holdout_end,
  base_interval_half_width,
  interval_multiplier,
  interval_half_width,
  interval_validation_coverage_pct,
  evaluation_scope,
  evaluated_at,
  approved_at
)
select
  mapping.company_id,
  mapping.shop_id,
  mapping.source_system,
  mapping.source_shop_key,
  'trailing4_v1',
  'approved',
  3.6346,
  2.6538,
  32.6241,
  26.9841,
  52,
  52,
  date '2024-12-30',
  date '2025-12-22',
  5.25,
  1.55,
  9,
  92.3077,
  'PS177 chronological holdout; interval multiplier validated across 16 held-out current source shops after calibration on 14 different current source shops.',
  now(),
  now()
from public.collision_shop_mappings mapping
where mapping.source_system = 'filemaker_repair_customer'
  and mapping.source_shop_key = 'PS177'
  and mapping.mapping_status = 'mapped'
  and mapping.company_id is not null
  and mapping.shop_id is not null
on conflict (company_id) do update set
  shop_id = excluded.shop_id,
  source_system = excluded.source_system,
  source_shop_key = excluded.source_shop_key,
  model_key = excluded.model_key,
  promotion_status = excluded.promotion_status,
  seasonal_baseline_mae = excluded.seasonal_baseline_mae,
  model_mae = excluded.model_mae,
  model_wape_pct = excluded.model_wape_pct,
  mae_improvement_pct = excluded.mae_improvement_pct,
  calibration_weeks = excluded.calibration_weeks,
  holdout_weeks = excluded.holdout_weeks,
  holdout_start = excluded.holdout_start,
  holdout_end = excluded.holdout_end,
  base_interval_half_width = excluded.base_interval_half_width,
  interval_multiplier = excluded.interval_multiplier,
  interval_half_width = excluded.interval_half_width,
  interval_validation_coverage_pct = excluded.interval_validation_coverage_pct,
  evaluation_scope = excluded.evaluation_scope,
  evaluated_at = excluded.evaluated_at,
  approved_at = excluded.approved_at;

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
        where demand.company_id = forecast.company_id
          and demand.week_start = forecast.forecast_week
      ), 0),
      absolute_error = pg_catalog.abs(
        coalesce((
          select demand.repair_orders
          from public.v_collision_weekly_demand demand
          where demand.company_id = forecast.company_id
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
      on registry.company_id = orders.company_id
     and registry.shop_id = orders.shop_id
    where orders.arrival_date is not null
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
      where demand.company_id = v_candidate.company_id
        and demand.week_start < v_forecast_week
      order by demand.week_start desc
      limit 4
    ) history;

    select demand.repair_orders
      into v_seasonal_prediction
    from public.v_collision_weekly_demand demand
    where demand.company_id = v_candidate.company_id
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
    on conflict (company_id, forecast_week, model_key) do update set
      shop_id = excluded.shop_id,
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

comment on function public.run_collision_weekly_forecasts(date) is
  'Scores only approved shop models, blocks stale sources, and uses empirically widened intervals. Service role only.';
revoke execute on function public.run_collision_weekly_forecasts(date)
  from public, anon, authenticated;
grant execute on function public.run_collision_weekly_forecasts(date)
  to service_role;
