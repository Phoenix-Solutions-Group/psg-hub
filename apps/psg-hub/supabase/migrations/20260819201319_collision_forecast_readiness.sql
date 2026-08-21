-- Multi-shop forecast readiness for the current one-to-four-week operating horizon.
-- Rollback: drop view public.v_collision_forecast_readiness.

create view public.v_collision_forecast_readiness
with (security_invoker = true)
as
with expected_horizons as (
  select distinct
    mapping.shop_id,
    horizon.forecast_horizon_weeks
  from public.collision_shop_mappings mapping
  cross join generate_series(1, 4) as horizon(forecast_horizon_weeks)
  where mapping.mapping_status = 'mapped'
    and mapping.shop_id is not null
), approved_policies as (
  select
    registry.shop_id,
    1::smallint as forecast_horizon_weeks,
    registry.model_key
  from public.collision_forecast_model_registry registry
  where registry.promotion_status = 'approved'

  union all

  select
    registry.shop_id,
    registry.forecast_horizon_weeks,
    registry.model_key
  from public.collision_forecast_horizon_registry registry
  where registry.promotion_status = 'approved'
), ranked_forecasts as (
  select
    forecast.*,
    row_number() over (
      partition by forecast.shop_id, forecast.forecast_horizon_weeks
      order by
        forecast.forecast_origin_week desc,
        forecast.generated_at desc,
        forecast.id desc
    ) as recency_rank
  from public.collision_demand_forecasts forecast
)
select
  expected.shop_id,
  expected.forecast_horizon_weeks::smallint as forecast_horizon_weeks,
  policy.model_key as approved_model_key,
  forecast.model_key as forecast_model_key,
  forecast.forecast_origin_week,
  forecast.forecast_week,
  forecast.source_latest_arrival_date,
  forecast.source_age_days,
  forecast.status as forecast_status,
  coalesce(
    forecast.status = 'published'
      and forecast.model_key = policy.model_key
      and forecast.forecast_origin_week = date_trunc('week', current_date::timestamp)::date,
    false
  ) as is_ready,
  case
    when policy.model_key is null then 'model_not_approved'
    when forecast.id is null then 'not_generated'
    when forecast.model_key <> policy.model_key then 'model_mismatch'
    when forecast.forecast_origin_week <> date_trunc('week', current_date::timestamp)::date
      then 'forecast_outdated'
    else forecast.status
  end as readiness_status,
  forecast.generated_at
from expected_horizons expected
left join approved_policies policy
  on policy.shop_id = expected.shop_id
 and policy.forecast_horizon_weeks = expected.forecast_horizon_weeks
left join ranked_forecasts forecast
  on forecast.shop_id = expected.shop_id
 and forecast.forecast_horizon_weeks = expected.forecast_horizon_weeks
 and forecast.recency_rank = 1;

comment on view public.v_collision_forecast_readiness is
  'Service-only current forecast readiness for every mapped shop and each one-to-four-week horizon.';

revoke all on public.v_collision_forecast_readiness
  from public, anon, authenticated;
grant select on public.v_collision_forecast_readiness to service_role;
