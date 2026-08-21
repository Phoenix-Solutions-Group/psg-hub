-- Atomically approve or reject one shop's four staged forecast policies.
-- This function never scores or publishes a forecast.
create or replace function public.review_collision_forecast_models(
  p_shop_id uuid,
  p_decision text,
  p_actor_profile_id uuid,
  p_review_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision, '')));
  v_week_one public.collision_forecast_model_registry%rowtype;
  v_horizon_count integer;
  v_invalid_horizon_count integer;
  v_status text;
begin
  if p_shop_id is null or v_decision not in ('approve', 'reject') then
    raise exception 'A shop and approve or reject decision are required'
      using errcode = 'invalid_parameter_value';
  end if;

  if pg_catalog.length(pg_catalog.btrim(coalesce(p_review_notes, ''))) not between 20 and 1000 then
    raise exception 'Model review notes must contain 20 to 1000 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1
    from public.app_user_roles role
    where role.profile_id = p_actor_profile_id
      and role.role = 'psg_superadmin'
  ) then
    raise exception 'A current PSG superadmin is required'
      using errcode = 'insufficient_privilege';
  end if;

  select registry.*
    into v_week_one
  from public.collision_forecast_model_registry registry
  where registry.shop_id = p_shop_id
  for update;

  if not found or v_week_one.promotion_status <> 'review' then
    raise exception 'Week-one forecast evidence is not awaiting review'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  perform 1
  from public.collision_forecast_horizon_registry registry
  where registry.shop_id = p_shop_id
  for update;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where registry.forecast_horizon_weeks not between 2 and 4
        or registry.promotion_status <> 'review'
    )::integer
    into v_horizon_count, v_invalid_horizon_count
  from public.collision_forecast_horizon_registry registry
  where registry.shop_id = p_shop_id;

  if v_horizon_count <> 3 or v_invalid_horizon_count <> 0 then
    raise exception 'Forecast weeks two through four must all be awaiting review'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not exists (
    select 1
    from public.collision_shop_mappings mapping
    where mapping.source_system = v_week_one.source_system
      and mapping.source_shop_key = v_week_one.source_shop_key
      and mapping.shop_id = p_shop_id
      and mapping.mapping_status = 'mapped'
  ) then
    raise exception 'A confirmed source-shop mapping is required'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_decision = 'approve' and not exists (
    select 1
    from public.shop_users membership
    join public.app_user_roles role
      on role.profile_id = membership.user_id
     and role.role = 'customer'
    where membership.shop_id = p_shop_id
  ) then
    raise exception 'At least one assigned customer user is required before model approval'
      using errcode = 'check_violation';
  end if;

  if v_decision = 'approve' and (
    v_week_one.model_mae >= v_week_one.seasonal_baseline_mae
    or v_week_one.mae_improvement_pct <= 0
    or v_week_one.interval_validation_coverage_pct < 80
    or exists (
      select 1
      from public.collision_forecast_horizon_registry registry
      where registry.shop_id = p_shop_id
        and (
          registry.model_mae >= registry.seasonal_baseline_mae
          or registry.mae_improvement_pct <= 0
          or registry.interval_validation_coverage_pct < 80
        )
    )
  ) then
    raise exception 'Every horizon must beat seasonal MAE and clear 80 percent interval coverage'
      using errcode = 'check_violation';
  end if;

  v_status := case when v_decision = 'approve' then 'approved' else 'retired' end;

  update public.collision_forecast_model_registry registry
  set promotion_status = v_status,
      approved_at = case when v_status = 'approved' then pg_catalog.now() else null end
  where registry.shop_id = p_shop_id;

  update public.collision_forecast_horizon_registry registry
  set promotion_status = v_status,
      approved_at = case when v_status = 'approved' then pg_catalog.now() else null end
  where registry.shop_id = p_shop_id;

  insert into public.access_audit (
    actor_profile_id,
    target_shop_id,
    action,
    payload_jsonb
  ) values (
    p_actor_profile_id,
    p_shop_id,
    case
      when v_status = 'approved' then 'collision.forecast_model.approve'
      else 'collision.forecast_model.reject'
    end,
    pg_catalog.jsonb_build_object(
      'sourceShopKey', v_week_one.source_shop_key,
      'promotionStatus', v_status,
      'reviewNotes', pg_catalog.btrim(p_review_notes),
      'weekOneModel', v_week_one.model_key,
      'horizonModels', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'horizon', registry.forecast_horizon_weeks,
            'modelKey', registry.model_key,
            'maeImprovementPct', registry.mae_improvement_pct,
            'intervalValidationCoveragePct', registry.interval_validation_coverage_pct
          ) order by registry.forecast_horizon_weeks
        )
        from public.collision_forecast_horizon_registry registry
        where registry.shop_id = p_shop_id
      )
    )
  );

  return pg_catalog.jsonb_build_object(
    'shop_id', p_shop_id,
    'source_shop_key', v_week_one.source_shop_key,
    'promotion_status', v_status,
    'reviewed_horizons', 4,
    'forecasts_published', 0
  );
end;
$$;

comment on function public.review_collision_forecast_models(uuid, text, uuid, text) is
  'Service-only atomic decision on four staged shop forecast policies. Approval requires a customer shop audience; rejection remains available. Never scores or publishes forecasts.';

revoke execute on function public.review_collision_forecast_models(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_collision_forecast_models(uuid, text, uuid, text)
  to service_role;
