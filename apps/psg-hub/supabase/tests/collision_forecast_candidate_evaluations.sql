insert into public.collision_shop_mappings (
  source_system,
  source_shop_key,
  source_shop_name,
  mapping_status
) values (
  'filemaker_repair_customer',
  'PS999999',
  'Rollback Test Shop',
  'unmapped'
);

set local role service_role;

do $$
declare
  v_horizons jsonb := $evidence$[
    {"forecast_horizon_weeks":1,"promotion_ready":true,"model_key":"seasonal_recent_blend_v1","seasonal_baseline_mae":10,"model_mae":8,"model_wape_pct":20,"mae_improvement_pct":20,"holdout_repairs":100,"holdout_start":"2025-08-11","holdout_end":"2026-08-03","coverage_segment_start":"2023-01-02","excluded_internal_gap_weeks":0,"interval_validation_coverage_pct":82,"evaluation_scope":"Rollback test chronological holdout with held-out-shop interval validation."},
    {"forecast_horizon_weeks":2,"promotion_ready":true,"model_key":"seasonal_recent_blend_v1","seasonal_baseline_mae":10,"model_mae":8,"model_wape_pct":20,"mae_improvement_pct":20,"holdout_repairs":100,"holdout_start":"2025-08-11","holdout_end":"2026-08-03","coverage_segment_start":"2023-01-02","excluded_internal_gap_weeks":0,"interval_validation_coverage_pct":82,"evaluation_scope":"Rollback test chronological holdout with held-out-shop interval validation."},
    {"forecast_horizon_weeks":3,"promotion_ready":true,"model_key":"seasonal_recent_blend_v1","seasonal_baseline_mae":10,"model_mae":8,"model_wape_pct":20,"mae_improvement_pct":20,"holdout_repairs":100,"holdout_start":"2025-08-11","holdout_end":"2026-08-03","coverage_segment_start":"2023-01-02","excluded_internal_gap_weeks":0,"interval_validation_coverage_pct":82,"evaluation_scope":"Rollback test chronological holdout with held-out-shop interval validation."},
    {"forecast_horizon_weeks":4,"promotion_ready":true,"model_key":"seasonal_recent_blend_v1","seasonal_baseline_mae":10,"model_mae":8,"model_wape_pct":20,"mae_improvement_pct":20,"holdout_repairs":100,"holdout_start":"2025-08-11","holdout_end":"2026-08-03","coverage_segment_start":"2023-01-02","excluded_internal_gap_weeks":0,"interval_validation_coverage_pct":82,"evaluation_scope":"Rollback test chronological holdout with held-out-shop interval validation."}
  ]$evidence$::jsonb;
  v_result jsonb;
begin
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_collision_forecast_candidate_evaluation(text,text,date,text,text,jsonb)',
    'execute'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.record_collision_forecast_candidate_evaluation(text,text,date,text,text,jsonb)',
    'execute'
  ) then
    raise exception 'Candidate evidence function grants are unsafe';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated',
    'public.collision_forecast_candidate_evaluations',
    'select'
  ) then
    raise exception 'Candidate evidence table is exposed to authenticated users';
  end if;

  select public.record_collision_forecast_candidate_evaluation(
    'filemaker_repair_customer',
    'PS999999',
    date '2026-08-03',
    repeat('a', 64),
    repeat('b', 64),
    v_horizons
  ) into v_result;

  if v_result ->> 'mapping_changed' <> 'false'
    or v_result ->> 'model_approved' <> 'false'
    or v_result ->> 'forecasts_published' <> '0'
    or not exists (
      select 1
      from public.collision_shop_mappings mapping
      where mapping.source_shop_key = 'PS999999'
        and mapping.mapping_status = 'unmapped'
        and mapping.shop_id is null
    )
  then
    raise exception 'Recording evidence crossed a release gate';
  end if;

  perform public.record_collision_forecast_candidate_evaluation(
    'filemaker_repair_customer',
    'PS999999',
    date '2026-08-03',
    repeat('a', 64),
    repeat('b', 64),
    v_horizons
  );

  if (
    select count(*)
    from public.collision_forecast_candidate_evaluations evaluation
    where evaluation.source_shop_key = 'PS999999'
  ) <> 1 then
    raise exception 'Identical evidence was not recorded idempotently';
  end if;

  begin
    perform public.record_collision_forecast_candidate_evaluation(
      'filemaker_repair_customer',
      'PS999999',
      date '2026-08-03',
      repeat('c', 64),
      repeat('d', 64),
      pg_catalog.jsonb_set(
        v_horizons,
        '{0,interval_validation_coverage_pct}',
        '79'::jsonb
      )
    );
    raise exception 'Invalid interval evidence was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

reset role;
