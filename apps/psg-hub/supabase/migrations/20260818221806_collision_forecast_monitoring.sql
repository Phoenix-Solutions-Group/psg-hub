-- Rolling, horizon-specific forecast monitoring. This view can request manual
-- review but never changes model promotion state.

create or replace view public.v_collision_forecast_monitoring
with (security_invoker = true)
as
with policies as (
  select
    registry.shop_id,
    1::smallint as forecast_horizon_weeks,
    registry.model_key,
    registry.seasonal_baseline_mae,
    registry.model_mae as registered_model_mae,
    registry.interval_validation_coverage_pct
  from public.collision_forecast_model_registry registry
  where registry.promotion_status = 'approved'

  union all

  select
    registry.shop_id,
    registry.forecast_horizon_weeks,
    registry.model_key,
    registry.seasonal_baseline_mae,
    registry.model_mae as registered_model_mae,
    registry.interval_validation_coverage_pct
  from public.collision_forecast_horizon_registry registry
  where registry.promotion_status = 'approved'
), ranked_actuals as (
  select
    forecast.*,
    row_number() over (
      partition by forecast.shop_id, forecast.forecast_horizon_weeks
      order by forecast.forecast_week desc, forecast.forecast_origin_week desc
    ) as observation_rank
  from public.collision_demand_forecasts forecast
  where forecast.status = 'published'
    and forecast.actual_repair_orders is not null
    and forecast.predicted_repair_orders is not null
    and forecast.absolute_error is not null
), metrics as (
  select
    actual.shop_id,
    actual.forecast_horizon_weeks,
    count(*)::integer as observation_count,
    min(actual.forecast_week) as monitoring_start_week,
    max(actual.forecast_week) as monitoring_end_week,
    round(avg(actual.absolute_error), 4) as live_mae,
    round(
      100 * sum(actual.absolute_error)
        / nullif(sum(actual.actual_repair_orders), 0),
      4
    ) as live_wape_pct,
    round(
      100 * avg(
        case
          when actual.actual_repair_orders between
            actual.lower_repair_orders and actual.upper_repair_orders
            then 1
          else 0
        end
      ),
      4
    ) as live_interval_coverage_pct
  from ranked_actuals actual
  where actual.observation_rank <= 13
  group by actual.shop_id, actual.forecast_horizon_weeks
)
select
  policy.shop_id,
  policy.forecast_horizon_weeks,
  policy.model_key,
  policy.seasonal_baseline_mae,
  policy.registered_model_mae,
  policy.interval_validation_coverage_pct,
  coalesce(metric.observation_count, 0) as observation_count,
  13 as monitoring_window_weeks,
  metric.monitoring_start_week,
  metric.monitoring_end_week,
  metric.live_mae,
  metric.live_wape_pct,
  metric.live_interval_coverage_pct,
  case
    when coalesce(metric.observation_count, 0) < 13 then 'awaiting_actuals'
    when metric.live_mae >= policy.seasonal_baseline_mae then 'review_accuracy'
    when metric.live_interval_coverage_pct < 70 then 'review_interval'
    else 'within_policy'
  end as monitoring_status,
  case
    when coalesce(metric.observation_count, 0) < 13 then
      format(
        '%s of 13 observed weeks are available; no drift decision is made.',
        coalesce(metric.observation_count, 0)
      )
    when metric.live_mae >= policy.seasonal_baseline_mae then
      'Rolling model MAE no longer beats the registered seasonal baseline; manual review is required.'
    when metric.live_interval_coverage_pct < 70 then
      'Rolling interval coverage is more than 10 points below the 80% target; manual review is required.'
    else
      'Rolling MAE beats seasonal and interval coverage remains within the operating review policy.'
  end as monitoring_reason
from policies policy
left join metrics metric
  on metric.shop_id = policy.shop_id
 and metric.forecast_horizon_weeks = policy.forecast_horizon_weeks;

comment on view public.v_collision_forecast_monitoring is
  'Service-only 13-observation forecast scorecard by shop and horizon. Review states never auto-change model promotion.';

revoke all on public.v_collision_forecast_monitoring from public, anon, authenticated;
grant select on public.v_collision_forecast_monitoring to service_role;
