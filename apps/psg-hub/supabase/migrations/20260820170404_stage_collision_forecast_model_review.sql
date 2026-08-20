-- Atomically stage four evaluated forecast horizons for superadmin review.
-- This function never approves a model and never publishes a forecast.
create or replace function public.stage_collision_forecast_model_review(
  p_source_system text,
  p_source_shop_key text,
  p_horizons jsonb,
  p_actor_profile_id uuid,
  p_review_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mapping public.collision_shop_mappings%rowtype;
  v_evidence jsonb;
  v_horizon integer;
  v_horizons integer[];
begin
  if p_source_system <> 'filemaker_repair_customer'
    or p_source_shop_key is null
    or p_source_shop_key !~ '^PS[0-9]+$'
  then
    raise exception 'Unsupported collision forecast source'
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

  if pg_catalog.jsonb_typeof(p_horizons) <> 'array'
    or pg_catalog.jsonb_array_length(p_horizons) <> 4
  then
    raise exception 'Exactly four forecast horizons are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select pg_catalog.array_agg(candidate.horizon order by candidate.horizon)
    into v_horizons
  from (
    select distinct (item.value ->> 'forecast_horizon_weeks')::integer as horizon
    from pg_catalog.jsonb_array_elements(p_horizons) item
  ) candidate;

  if v_horizons <> array[1, 2, 3, 4] then
    raise exception 'Forecast horizons must be the unique values 1 through 4'
      using errcode = 'invalid_parameter_value';
  end if;

  select mapping.*
    into v_mapping
  from public.collision_shop_mappings mapping
  where mapping.source_system = p_source_system
    and mapping.source_shop_key = p_source_shop_key
  for update;

  if not found
    or v_mapping.mapping_status <> 'mapped'
    or v_mapping.shop_id is null
  then
    raise exception 'A confirmed shop mapping is required before model review'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  perform 1
  from public.collision_forecast_model_registry registry
  where registry.shop_id = v_mapping.shop_id
  for update;

  perform 1
  from public.collision_forecast_horizon_registry registry
  where registry.shop_id = v_mapping.shop_id
  for update;

  if exists (
    select 1
    from public.collision_forecast_model_registry registry
    where registry.shop_id = v_mapping.shop_id
      and registry.promotion_status = 'approved'
  ) or exists (
    select 1
    from public.collision_forecast_horizon_registry registry
    where registry.shop_id = v_mapping.shop_id
      and registry.promotion_status = 'approved'
  ) then
    raise exception 'Retire approved model policies before staging replacement evidence'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  for v_evidence in
    select item.value
    from pg_catalog.jsonb_array_elements(p_horizons) item
    order by (item.value ->> 'forecast_horizon_weeks')::integer
  loop
    v_horizon := (v_evidence ->> 'forecast_horizon_weeks')::integer;

    if not coalesce((v_evidence ->> 'promotion_ready')::boolean, false)
      or (v_evidence ->> 'model_key') not in (
        'trailing4_v1',
        'seasonal_recent_blend_v1'
      )
      or (v_evidence ->> 'model_mae')::numeric
        >= (v_evidence ->> 'seasonal_baseline_mae')::numeric
      or (v_evidence ->> 'mae_improvement_pct')::numeric <= 0
      or (v_evidence ->> 'interval_validation_coverage_pct')::numeric < 80
      or pg_catalog.length(pg_catalog.btrim(
        coalesce(v_evidence ->> 'evaluation_scope', '')
      )) not between 20 and 2000
    then
      raise exception 'Horizon % does not satisfy model review gates', v_horizon
        using errcode = 'check_violation';
    end if;

    if v_horizon = 1 then
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
      ) values (
        v_mapping.company_id,
        v_mapping.shop_id,
        v_mapping.source_system,
        v_mapping.source_shop_key,
        v_evidence ->> 'model_key',
        'review',
        (v_evidence ->> 'seasonal_baseline_mae')::numeric,
        (v_evidence ->> 'model_mae')::numeric,
        (v_evidence ->> 'model_wape_pct')::numeric,
        (v_evidence ->> 'mae_improvement_pct')::numeric,
        (v_evidence ->> 'calibration_weeks')::integer,
        (v_evidence ->> 'holdout_weeks')::integer,
        (v_evidence ->> 'holdout_start')::date,
        (v_evidence ->> 'holdout_end')::date,
        (v_evidence ->> 'base_interval_half_width')::numeric,
        (v_evidence ->> 'interval_multiplier')::numeric,
        (v_evidence ->> 'interval_half_width')::integer,
        (v_evidence ->> 'interval_validation_coverage_pct')::numeric,
        v_evidence ->> 'evaluation_scope',
        pg_catalog.now(),
        null
      )
      on conflict (shop_id) do update set
        company_id = excluded.company_id,
        source_system = excluded.source_system,
        source_shop_key = excluded.source_shop_key,
        model_key = excluded.model_key,
        promotion_status = 'review',
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
        approved_at = null;
    else
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
      ) values (
        v_mapping.company_id,
        v_mapping.shop_id,
        v_horizon,
        v_evidence ->> 'model_key',
        'review',
        (v_evidence ->> 'seasonal_baseline_mae')::numeric,
        (v_evidence ->> 'model_mae')::numeric,
        (v_evidence ->> 'model_wape_pct')::numeric,
        (v_evidence ->> 'mae_improvement_pct')::numeric,
        (v_evidence ->> 'calibration_weeks')::integer,
        (v_evidence ->> 'holdout_weeks')::integer,
        (v_evidence ->> 'holdout_start')::date,
        (v_evidence ->> 'holdout_end')::date,
        (v_evidence ->> 'base_interval_half_width')::numeric,
        (v_evidence ->> 'interval_multiplier')::numeric,
        (v_evidence ->> 'interval_half_width')::integer,
        (v_evidence ->> 'interval_validation_coverage_pct')::numeric,
        v_evidence ->> 'evaluation_scope',
        pg_catalog.now(),
        null
      )
      on conflict (shop_id, forecast_horizon_weeks) do update set
        company_id = excluded.company_id,
        model_key = excluded.model_key,
        promotion_status = 'review',
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
        approved_at = null;
    end if;
  end loop;

  insert into public.access_audit (
    actor_profile_id,
    target_shop_id,
    action,
    payload_jsonb
  ) values (
    p_actor_profile_id,
    v_mapping.shop_id,
    'collision.forecast_model.stage_review',
    pg_catalog.jsonb_build_object(
      'sourceShopKey', v_mapping.source_shop_key,
      'promotionStatus', 'review',
      'horizons', p_horizons,
      'reviewNotes', pg_catalog.btrim(p_review_notes)
    )
  );

  return pg_catalog.jsonb_build_object(
    'source_shop_key', v_mapping.source_shop_key,
    'shop_id', v_mapping.shop_id,
    'promotion_status', 'review',
    'staged_horizons', 4,
    'forecasts_published', 0
  );
end;
$$;

comment on function public.stage_collision_forecast_model_review(text, text, jsonb, uuid, text) is
  'Service-only atomic staging of four evaluated shop horizons for manual review. Never approves models or publishes forecasts.';

revoke execute on function public.stage_collision_forecast_model_review(text, text, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.stage_collision_forecast_model_review(text, text, jsonb, uuid, text)
  to service_role;
