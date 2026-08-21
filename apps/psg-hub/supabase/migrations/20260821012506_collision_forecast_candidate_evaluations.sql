-- Store reproducible pre-mapping forecast evidence without weakening the
-- separate shop-mapping, customer-audience, model-approval, or publication gates.

create table public.collision_forecast_candidate_evaluations (
  source_system text not null,
  source_shop_key text not null,
  latest_week_cutoff date not null,
  input_sha256 text not null,
  evaluator_sha256 text not null,
  horizons jsonb not null,
  evaluated_at timestamptz not null default now(),
  primary key (
    source_system,
    source_shop_key,
    latest_week_cutoff,
    input_sha256,
    evaluator_sha256
  ),
  foreign key (source_system, source_shop_key)
    references public.collision_shop_mappings(source_system, source_shop_key)
    on update cascade on delete restrict,
  check (source_shop_key = upper(source_shop_key)),
  check (input_sha256 ~ '^[0-9a-f]{64}$'),
  check (evaluator_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(horizons) = 'array'),
  check (jsonb_array_length(horizons) = 4)
);

create index collision_forecast_candidate_evaluations_latest_idx
  on public.collision_forecast_candidate_evaluations (
    source_system,
    source_shop_key,
    evaluated_at desc
  );

alter table public.collision_forecast_candidate_evaluations enable row level security;
revoke all on public.collision_forecast_candidate_evaluations from public, anon, authenticated;
grant select, insert on public.collision_forecast_candidate_evaluations to service_role;

comment on table public.collision_forecast_candidate_evaluations is
  'Service-only reproducible pre-mapping backtests. Evidence here never maps a shop, approves a model, generates a forecast, or publishes a forecast.';

create or replace function public.record_collision_forecast_candidate_evaluation(
  p_source_system text,
  p_source_shop_key text,
  p_latest_week_cutoff date,
  p_input_sha256 text,
  p_evaluator_sha256 text,
  p_horizons jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_evidence jsonb;
  v_horizon integer;
  v_horizons integer[];
  v_evaluated_at timestamptz;
begin
  if p_source_system <> 'filemaker_repair_customer'
    or p_source_shop_key is null
    or p_source_shop_key !~ '^PS[0-9]+$'
  then
    raise exception 'Unsupported collision forecast source'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1
    from public.collision_shop_mappings mapping
    where mapping.source_system = p_source_system
      and mapping.source_shop_key = p_source_shop_key
  ) then
    raise exception 'Imported shop is unavailable'
      using errcode = 'foreign_key_violation';
  end if;

  if p_latest_week_cutoff is null
    or extract(isodow from p_latest_week_cutoff) <> 1
    or p_latest_week_cutoff >= pg_catalog.date_trunc('week', current_date)::date
    or coalesce(p_input_sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_evaluator_sha256, '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Candidate evaluation provenance is invalid'
      using errcode = 'invalid_parameter_value';
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
      or (v_evidence ->> 'model_wape_pct')::numeric < 0
      or (v_evidence ->> 'mae_improvement_pct')::numeric <= 0
      or (v_evidence ->> 'holdout_repairs')::integer < 1
      or (v_evidence ->> 'excluded_internal_gap_weeks')::integer < 0
      or (v_evidence ->> 'holdout_start')::date
        < (v_evidence ->> 'coverage_segment_start')::date
      or (v_evidence ->> 'holdout_end')::date
        < (v_evidence ->> 'holdout_start')::date
      or (v_evidence ->> 'holdout_end')::date > p_latest_week_cutoff
      or (v_evidence ->> 'interval_validation_coverage_pct')::numeric < 80
      or (v_evidence ->> 'interval_validation_coverage_pct')::numeric > 100
      or pg_catalog.length(pg_catalog.btrim(
        coalesce(v_evidence ->> 'evaluation_scope', '')
      )) not between 20 and 2000
    then
      raise exception 'Horizon % does not satisfy candidate evidence gates', v_horizon
        using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.collision_forecast_candidate_evaluations (
    source_system,
    source_shop_key,
    latest_week_cutoff,
    input_sha256,
    evaluator_sha256,
    horizons
  ) values (
    p_source_system,
    p_source_shop_key,
    p_latest_week_cutoff,
    p_input_sha256,
    p_evaluator_sha256,
    p_horizons
  )
  on conflict (
    source_system,
    source_shop_key,
    latest_week_cutoff,
    input_sha256,
    evaluator_sha256
  ) do nothing;

  select evaluation.evaluated_at
    into v_evaluated_at
  from public.collision_forecast_candidate_evaluations evaluation
  where evaluation.source_system = p_source_system
    and evaluation.source_shop_key = p_source_shop_key
    and evaluation.latest_week_cutoff = p_latest_week_cutoff
    and evaluation.input_sha256 = p_input_sha256
    and evaluation.evaluator_sha256 = p_evaluator_sha256
    and evaluation.horizons = p_horizons;

  if not found then
    raise exception 'The same evaluator and inputs produced conflicting evidence'
      using errcode = 'integrity_constraint_violation';
  end if;

  return pg_catalog.jsonb_build_object(
    'source_shop_key', p_source_shop_key,
    'latest_week_cutoff', p_latest_week_cutoff,
    'evaluated_at', v_evaluated_at,
    'horizons_recorded', 4,
    'mapping_changed', false,
    'model_approved', false,
    'forecasts_published', 0
  );
end;
$$;

comment on function public.record_collision_forecast_candidate_evaluation(text, text, date, text, text, jsonb) is
  'Records a validated four-horizon pre-mapping backtest. Never maps a shop, approves a model, generates a forecast, or publishes a forecast.';

revoke execute on function public.record_collision_forecast_candidate_evaluation(text, text, date, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_collision_forecast_candidate_evaluation(text, text, date, text, text, jsonb)
  to service_role;
