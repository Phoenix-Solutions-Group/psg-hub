begin;

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
  actual_repair_orders,
  absolute_error,
  observed_at
)
select
  null,
  registry.shop_id,
  'Rollback-only forecast monitoring check',
  week::date,
  week::date,
  1,
  registry.model_key,
  10,
  8,
  12,
  80,
  week::date,
  0,
  'published',
  'Rollback-only forecast monitoring check',
  10,
  0,
  now()
from public.collision_forecast_model_registry registry
cross join generate_series(
  date '2099-01-05',
  date '2099-03-30',
  interval '7 days'
) week
where registry.promotion_status = 'approved'
order by registry.shop_id
limit 13
on conflict (shop_id, forecast_origin_week, forecast_horizon_weeks) do update set
  company_name = excluded.company_name,
  model_key = excluded.model_key,
  predicted_repair_orders = excluded.predicted_repair_orders,
  lower_repair_orders = excluded.lower_repair_orders,
  upper_repair_orders = excluded.upper_repair_orders,
  status = excluded.status,
  actual_repair_orders = excluded.actual_repair_orders,
  absolute_error = excluded.absolute_error,
  observed_at = excluded.observed_at;

do $$
begin
  if not exists (
    select 1
    from public.v_collision_forecast_monitoring
    where forecast_horizon_weeks = 1
      and observation_count = 13
      and monitoring_status = 'within_policy'
  ) then
    raise exception 'Expected within_policy after 13 accurate observations';
  end if;
end;
$$;

update public.collision_demand_forecasts
set actual_repair_orders = 20,
    absolute_error = 10
where company_name = 'Rollback-only forecast monitoring check';

do $$
begin
  if not exists (
    select 1
    from public.v_collision_forecast_monitoring
    where forecast_horizon_weeks = 1
      and monitoring_status = 'review_accuracy'
  ) then
    raise exception 'Expected review_accuracy after MAE exceeds seasonal';
  end if;
end;
$$;

update public.collision_demand_forecasts
set actual_repair_orders = 10,
    absolute_error = 0,
    upper_repair_orders = 9
where company_name = 'Rollback-only forecast monitoring check';

do $$
begin
  if not exists (
    select 1
    from public.v_collision_forecast_monitoring
    where forecast_horizon_weeks = 1
      and monitoring_status = 'review_interval'
  ) then
    raise exception 'Expected review_interval after interval coverage falls';
  end if;
end;
$$;

rollback;
