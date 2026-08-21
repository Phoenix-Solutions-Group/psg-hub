-- Add explicitly promoted horizons without weakening the existing week-one gate.
-- Rollback: restore the prior scorer, drop forecast_horizon_weeks, then drop
-- public.collision_forecast_horizon_registry.

create table public.collision_forecast_horizon_registry (
  company_id uuid references public.companies(id) on delete set null,
  shop_id uuid not null
    references public.collision_forecast_model_registry(shop_id)
    on delete cascade,
  forecast_horizon_weeks smallint not null,
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
  primary key (shop_id, forecast_horizon_weeks),
  check (forecast_horizon_weeks between 2 and 4),
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
      and interval_validation_coverage_pct >= 80
      and approved_at is not null
    )
  )
);

alter table public.collision_forecast_horizon_registry enable row level security;
revoke all on public.collision_forecast_horizon_registry from anon, authenticated;
grant select, insert, update on public.collision_forecast_horizon_registry to service_role;

comment on table public.collision_forecast_horizon_registry is
  'Service-only promotion evidence for forecast weeks two through four. Missing or unapproved horizons are not scored.';

insert into public.collision_forecast_horizon_registry (
  company_id,
  shop_id,
  forecast_horizon_weeks,
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
  registry.company_id,
  registry.shop_id,
  evidence.forecast_horizon_weeks,
  evidence.model_key,
  'approved',
  3.6346,
  evidence.model_mae,
  evidence.model_wape_pct,
  evidence.mae_improvement_pct,
  52,
  52,
  date '2024-12-30',
  date '2025-12-22',
  evidence.base_interval_half_width,
  evidence.interval_multiplier,
  evidence.interval_half_width,
  evidence.interval_validation_coverage_pct,
  'PS177 chronological holdout; horizon-specific interval multiplier validated on 16 source shops held out from the 14-shop multiplier calibration group.',
  now(),
  now()
from public.collision_forecast_model_registry registry
cross join (
  values
    (2::smallint, 'trailing4_v1', 2.7692, 34.0426, 23.8095, 4.25, 1.70, 8, 93.7500),
    (3::smallint, 'trailing4_v1', 2.9087, 35.7565, 19.9735, 4.00, 1.60, 7, 92.6683),
    (4::smallint, 'seasonal_recent_blend_v1', 3.0361, 37.3227, 16.4683, 5.00, 1.55, 8, 92.0673)
) as evidence (
  forecast_horizon_weeks,
  model_key,
  model_mae,
  model_wape_pct,
  mae_improvement_pct,
  base_interval_half_width,
  interval_multiplier,
  interval_half_width,
  interval_validation_coverage_pct
)
where registry.source_system = 'filemaker_repair_customer'
  and registry.source_shop_key = 'PS177'
  and registry.promotion_status = 'approved';

alter table public.collision_demand_forecasts
  add column forecast_origin_week date,
  add column forecast_horizon_weeks smallint not null default 1;

update public.collision_demand_forecasts
set forecast_origin_week = forecast_week;

alter table public.collision_demand_forecasts
  alter column forecast_origin_week set not null,
  drop constraint collision_demand_forecasts_shop_id_forecast_week_model_key_key,
  add constraint collision_demand_forecasts_shop_origin_horizon_key
    unique (shop_id, forecast_origin_week, forecast_horizon_weeks),
  add constraint collision_demand_forecasts_horizon_check
    check (forecast_horizon_weeks between 1 and 4),
  add constraint collision_demand_forecasts_target_week_check
    check (
      forecast_week = forecast_origin_week + ((forecast_horizon_weeks - 1) * 7)
    );

create index collision_demand_forecasts_shop_origin_idx
  on public.collision_demand_forecasts (
    shop_id,
    forecast_origin_week desc,
    forecast_horizon_weeks
  );

create or replace function public.run_collision_weekly_forecasts(
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_forecast_origin_week date := pg_catalog.date_trunc('week', p_as_of_date::timestamp)::date;
  v_target_week date;
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
    and forecast.forecast_week < v_forecast_origin_week
    and forecast.actual_repair_orders is null;

  get diagnostics v_observed = row_count;

  for v_candidate in
    with model_policies as (
      select
        registry.shop_id,
        1::smallint as forecast_horizon_weeks,
        registry.model_key,
        registry.promotion_status,
        registry.interval_half_width,
        registry.interval_multiplier,
        registry.mae_improvement_pct
      from public.collision_forecast_model_registry registry
      union all
      select
        registry.shop_id,
        registry.forecast_horizon_weeks,
        registry.model_key,
        registry.promotion_status,
        registry.interval_half_width,
        registry.interval_multiplier,
        registry.mae_improvement_pct
      from public.collision_forecast_horizon_registry registry
    ),
    repair_sources as (
      select
        orders.company_id,
        orders.shop_id,
        orders.company_name,
        max(orders.arrival_date) as latest_arrival_date
      from public.v_collision_repair_orders orders
      where orders.arrival_date is not null
        and orders.shop_id is not null
      group by orders.company_id, orders.shop_id, orders.company_name
    )
    select
      source.company_id,
      source.shop_id,
      source.company_name,
      source.latest_arrival_date,
      coalesce(policy.forecast_horizon_weeks, 1) as forecast_horizon_weeks,
      coalesce(policy.model_key, 'trailing4_v1') as model_key,
      policy.promotion_status = 'approved' as model_approved,
      policy.interval_half_width,
      policy.interval_multiplier,
      policy.mae_improvement_pct
    from repair_sources source
    left join model_policies policy on policy.shop_id = source.shop_id
  loop
    v_target_week := v_forecast_origin_week
      + ((v_candidate.forecast_horizon_weeks - 1) * 7);

    select pg_catalog.round(pg_catalog.avg(history.repair_orders), 2), count(*)::integer
      into v_recent_prediction, v_history_weeks
    from (
      select demand.repair_orders
      from public.v_collision_weekly_demand demand
      where demand.shop_id = v_candidate.shop_id
        and demand.week_start < v_forecast_origin_week
      order by demand.week_start desc
      limit 4
    ) history;

    select demand.repair_orders
      into v_seasonal_prediction
    from public.v_collision_weekly_demand demand
    where demand.shop_id = v_candidate.shop_id
      and demand.week_start = v_target_week - 364;

    v_prediction := case
      when v_candidate.model_key = 'seasonal_recent_blend_v1'
        and v_seasonal_prediction is not null
        then pg_catalog.round((v_recent_prediction + v_seasonal_prediction) / 2, 2)
      else v_recent_prediction
    end;
    v_source_age := greatest(0, p_as_of_date - v_candidate.latest_arrival_date);

    if not coalesce(v_candidate.model_approved, false) then
      v_status := 'insufficient_history';
      v_reason := pg_catalog.format(
        'No approved week-%s model has beaten the seasonal baseline for this shop.',
        v_candidate.forecast_horizon_weeks
      );
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
      v_reason := 'The approved blend requires the corresponding week from 52 weeks earlier.';
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
        '%s beat the week-%s shop seasonal MAE by %s%%; its empirical interval is widened by %sx for cross-shop coverage.',
        v_candidate.model_key,
        v_candidate.forecast_horizon_weeks,
        v_candidate.mae_improvement_pct,
        v_candidate.interval_multiplier
      );
      v_published := v_published + 1;
    end if;

    insert into public.collision_demand_forecasts (
      company_id,
      shop_id,
      company_name,
      forecast_origin_week,
      forecast_week,
      forecast_horizon_weeks,
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
      v_forecast_origin_week,
      v_target_week,
      v_candidate.forecast_horizon_weeks,
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
    on conflict (shop_id, forecast_origin_week, forecast_horizon_weeks) do update set
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      forecast_week = excluded.forecast_week,
      model_key = excluded.model_key,
      forecast_horizon_weeks = excluded.forecast_horizon_weeks,
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
    'forecast_week', v_forecast_origin_week,
    'forecast_horizons', 4,
    'published', v_published,
    'stale_source', v_stale,
    'insufficient_history', v_insufficient,
    'observations_updated', v_observed
  );
end;
$$;

comment on function public.run_collision_weekly_forecasts(date) is
  'Scores only explicitly approved shop horizons, up to four weeks, and publishes only when repair arrivals are no more than 14 days stale. Service role only.';

revoke execute on function public.run_collision_weekly_forecasts(date)
  from public, anon, authenticated;
grant execute on function public.run_collision_weekly_forecasts(date)
  to service_role;
