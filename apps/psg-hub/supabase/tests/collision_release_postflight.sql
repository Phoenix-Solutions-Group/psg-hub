-- Read-only postflight for the PSG collision-intelligence release.
-- `ready` must be true and `failures` empty before deploying the dashboard.

with required_migrations(name) as (
  values
    ('collision_storm_source_reconciliation'),
    ('collision_forecast_readiness'),
    ('harden_collision_example_functions'),
    ('collision_shop_insurance_market'),
    ('collision_insurer_acronym_matching'),
    ('stage_collision_forecast_model_review'),
    ('review_collision_forecast_models'),
    ('fix_collision_weather_coverage'),
    ('collision_payment_classification'),
    ('collision_forecast_customer_audience'),
    ('collision_weather_alert_review_cases'),
    ('collision_forecast_candidate_evaluations'),
    ('collision_shop_identity_evidence')
), required_relations(object_name, relation_kind, require_rls, require_invoker) as (
  values
    ('public.accident_density', 'r', true, false),
    ('public.accident_import_sources', 'r', true, false),
    ('public.accident_market_daypart_rollup', 'r', true, false),
    ('public.accident_market_rollup', 'r', true, false),
    ('public.accident_market_zip_rollup', 'r', true, false),
    ('public.accidents', 'p', true, false),
    ('public.accidents_2016', 'r', true, false),
    ('public.accidents_2017', 'r', true, false),
    ('public.accidents_2018', 'r', true, false),
    ('public.accidents_2019', 'r', true, false),
    ('public.accidents_2020', 'r', true, false),
    ('public.accidents_2021', 'r', true, false),
    ('public.accidents_2022', 'r', true, false),
    ('public.accidents_2023', 'r', true, false),
    ('public.accidents_2024', 'r', true, false),
    ('public.accidents_2025', 'r', true, false),
    ('public.accidents_2026', 'r', true, false),
    ('public.accidents_2027', 'r', true, false),
    ('public.accidents_default', 'r', true, false),
    ('public.nhtsa_dataset_sources', 'r', true, false),
    ('public.nhtsa_crashes', 'r', true, false),
    ('public.nhtsa_vehicles', 'r', true, false),
    ('public.nhtsa_persons', 'r', true, false),
    ('public.storm_event_sources', 'r', true, false),
    ('public.storm_events', 'r', true, false),
    ('public.storm_zip_monthly', 'r', true, false),
    ('public.zipcode_boundaries', 'r', true, false),
    ('public.collision_shop_insurance_appetite_evidence', 'r', true, false),
    ('public.collision_weather_alert_cases', 'r', true, false),
    ('public.collision_forecast_candidate_evaluations', 'r', true, false),
    ('public.collision_shop_identity_evidence', 'r', true, false),
    ('public.v_collision_storm_source_reconciliation', 'v', false, true),
    ('public.v_collision_forecast_readiness', 'v', false, true),
    ('public.v_collision_weather_monthly', 'v', false, true),
    ('public.v_collision_repair_orders', 'v', false, true),
    ('public.v_collision_weather_alert_case_evidence', 'v', false, true),
    ('public.v_collision_weather_alert_monitoring', 'v', false, true)
), required_sequences(sequence_name) as (
  values
    ('public.accident_import_sources_id_seq'),
    ('public.collision_demand_forecasts_id_seq'),
    ('public.storm_event_sources_id_seq'),
    ('public.storm_events_id_seq')
), required_functions(signature) as (
  values
    ('public.collision_targeting_examples(text,integer,integer)'),
    ('public.storm_demand_examples(integer,integer)'),
    ('public.refresh_accident_market_rollups()'),
    ('public.collision_insurer_match_key(text)'),
    ('public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)'),
    ('public.review_collision_forecast_models(uuid,text,uuid,text)'),
    ('public.collision_payment_category(text,text)'),
    ('public.collision_shop_has_customer_audience(uuid)'),
    ('public.acknowledge_collision_weather_alert(uuid,text,text,date,uuid)'),
    ('public.close_collision_weather_alert_case(uuid,uuid,text,text,uuid)'),
    ('public.record_collision_forecast_candidate_evaluation(text,text,date,text,text,jsonb)'),
    ('public.review_collision_shop_identity_evidence(text,text,text,text,text,text,text,text,uuid,text)')
), required_indexes(index_name, table_name) as (
  values
    (
      'public.collision_insurer_alias_reviews_registry_idx',
      'public.collision_insurer_alias_reviews'
    )
), required_triggers(trigger_name, table_name) as (
  values
    ('collision_forecast_model_customer_audience', 'public.collision_forecast_model_registry'),
    ('collision_forecast_horizon_customer_audience', 'public.collision_forecast_horizon_registry'),
    ('collision_forecast_publication_customer_audience', 'public.collision_demand_forecasts'),
    ('collision_weather_alert_cases_updated_at', 'public.collision_weather_alert_cases'),
    ('collision_shop_mapping_identity_gate', 'public.collision_shop_mappings')
), required_constraints(constraint_name, table_name) as (
  values
    (
      'collision_shop_insurance_evidence_contract',
      'public.collision_shop_insurance_appetite_evidence'
    )
), migration_checks as (
  select
    'migration'::text as check_type,
    migration.name as check_name,
    exists (
      select 1
      from supabase_migrations.schema_migrations applied
      where applied.name = migration.name
    ) as passed
  from required_migrations migration
), relation_checks as (
  select
    'relation'::text as check_type,
    relation.object_name as check_name,
    coalesce(
      class.relkind::text = relation.relation_kind
      and (not relation.require_rls or class.relrowsecurity)
      and (
        not relation.require_invoker
        or coalesce(class.reloptions, array[]::text[]) @> array['security_invoker=true']
      )
      and not pg_catalog.has_table_privilege('anon', class.oid, 'select')
      and not pg_catalog.has_table_privilege('anon', class.oid, 'insert')
      and not pg_catalog.has_table_privilege('anon', class.oid, 'update')
      and not pg_catalog.has_table_privilege('anon', class.oid, 'delete')
      and not pg_catalog.has_table_privilege('anon', class.oid, 'truncate')
      and not pg_catalog.has_table_privilege('authenticated', class.oid, 'select')
      and not pg_catalog.has_table_privilege('authenticated', class.oid, 'insert')
      and not pg_catalog.has_table_privilege('authenticated', class.oid, 'update')
      and not pg_catalog.has_table_privilege('authenticated', class.oid, 'delete')
      and not pg_catalog.has_table_privilege('authenticated', class.oid, 'truncate')
      and pg_catalog.has_table_privilege('service_role', class.oid, 'select'),
      false
    ) as passed
  from required_relations relation
  left join pg_catalog.pg_class class
    on class.oid = pg_catalog.to_regclass(relation.object_name)
), sequence_checks as (
  select
    'sequence'::text as check_type,
    required.sequence_name as check_name,
    coalesce(
      not pg_catalog.has_sequence_privilege('anon', class.oid, 'usage')
      and not pg_catalog.has_sequence_privilege('anon', class.oid, 'select')
      and not pg_catalog.has_sequence_privilege('anon', class.oid, 'update')
      and not pg_catalog.has_sequence_privilege('authenticated', class.oid, 'usage')
      and not pg_catalog.has_sequence_privilege('authenticated', class.oid, 'select')
      and not pg_catalog.has_sequence_privilege('authenticated', class.oid, 'update')
      and pg_catalog.has_sequence_privilege('service_role', class.oid, 'usage'),
      false
    ) as passed
  from required_sequences required
  left join pg_catalog.pg_class class
    on class.oid = pg_catalog.to_regclass(required.sequence_name)
), function_checks as (
  select
    'function'::text as check_type,
    required.signature as check_name,
    coalesce(
      not function.prosecdef
      and exists (
        select 1
        from unnest(function.proconfig) setting
        where setting like 'search_path=%'
      )
      and not pg_catalog.has_function_privilege('anon', function.oid, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', function.oid, 'execute')
      and pg_catalog.has_function_privilege('service_role', function.oid, 'execute'),
      false
    ) as passed
  from required_functions required
  left join pg_catalog.pg_proc function
    on function.oid = pg_catalog.to_regprocedure(required.signature)
), function_contract_checks as (
  select
    'function_contract'::text as check_type,
    required.check_name,
    coalesce(
      pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(function.oid),
        'join public.app_user_roles role'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(function.oid),
        'role.role = ''customer'''
      ) > 0,
      false
    ) as passed
  from (
    values
      (
        'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)',
        'stage_model_review_requires_customer_role'
      ),
      (
        'public.review_collision_forecast_models(uuid,text,uuid,text)',
        'model_approval_requires_customer_role'
      )
  ) required(signature, check_name)
  left join pg_catalog.pg_proc function
    on function.oid = pg_catalog.to_regprocedure(required.signature)
), index_checks as (
  select
    'index'::text as check_type,
    required.index_name as check_name,
    coalesce(
      index.indrelid = pg_catalog.to_regclass(required.table_name)
      and index.indisvalid
      and index.indisready
      and index.indnkeyatts = 3
      and index.indpred is null
      and pg_catalog.pg_get_indexdef(index.indexrelid, 1, true) =
        'canonical_registry_source'
      and pg_catalog.pg_get_indexdef(index.indexrelid, 2, true) =
        'canonical_registry_type'
      and pg_catalog.pg_get_indexdef(index.indexrelid, 3, true) =
        'canonical_registry_id',
      false
    ) as passed
  from required_indexes required
  left join pg_catalog.pg_index index
    on index.indexrelid = pg_catalog.to_regclass(required.index_name)
), privilege_checks as (
  select
    'privilege'::text as check_type,
    'refresh_accident_market_rollups_service_access'::text as check_name,
    pg_catalog.has_table_privilege(
      'service_role',
      'public.accidents',
      'select'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_daypart_rollup',
      'insert'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_daypart_rollup',
      'truncate'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_rollup',
      'insert'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_rollup',
      'truncate'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_zip_rollup',
      'insert'
    )
    and pg_catalog.has_table_privilege(
      'service_role',
      'public.accident_market_zip_rollup',
      'truncate'
    ) as passed
), trigger_checks as (
  select
    'trigger'::text as check_type,
    required.trigger_name as check_name,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger
      where trigger.tgname = required.trigger_name
        and trigger.tgrelid = pg_catalog.to_regclass(required.table_name)
        and not trigger.tgisinternal
    ) as passed
  from required_triggers required
), constraint_checks as (
  select
    'constraint'::text as check_type,
    required.constraint_name as check_name,
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_definition
      where constraint_definition.conname = required.constraint_name
        and constraint_definition.conrelid = pg_catalog.to_regclass(required.table_name)
        and constraint_definition.convalidated
    ) as passed
  from required_constraints required
), data_checks as (
  select
    'data'::text as check_type,
    'spc_source_rows_reconcile'::text as check_name,
    coalesce((
      select count(*)
      from public.storm_events event
      where event.import_batch_id = 'noaa_spc_preliminary-20260801-20260817'
    ), 0) = coalesce((
      select sum(source.row_count)
      from public.storm_event_sources source
      where source.import_batch_id = 'noaa_spc_preliminary-20260801-20260817'
    ), -1) as passed

  union all

  select
    'data',
    'ksdot_source_reconciles',
    exists (
      select 1
      from public.ksdot_crash_sources source
      where source.dataset_key = 'ksdot_accidents'
        and source.last_sync_status = 'loaded'
        and source.source_row_count = source.imported_row_count
        and not exists (
          select 1
          from public.ksdot_crashes crash
          where crash.dataset_key = source.dataset_key
            and crash.zip_resolution_status = 'pending'
        )
    )

  union all

  select
    'data',
    'blocked_forecasts_have_no_values',
    not exists (
      select 1
      from public.collision_demand_forecasts forecast
      where forecast.status <> 'published'
        and (
          forecast.predicted_repair_orders is not null
          or forecast.lower_repair_orders is not null
          or forecast.upper_repair_orders is not null
        )
    )

  union all

  select
    'data',
    'published_forecasts_have_customer_audience',
    not exists (
      select 1
      from public.collision_demand_forecasts forecast
      where forecast.status = 'published'
        and not exists (
          select 1
          from public.shop_users membership
          join public.app_user_roles role
            on role.profile_id = membership.user_id
           and role.role = 'customer'
          where membership.shop_id = forecast.shop_id
        )
    )
), checks as (
  select * from migration_checks
  union all select * from relation_checks
  union all select * from sequence_checks
  union all select * from function_checks
  union all select * from function_contract_checks
  union all select * from index_checks
  union all select * from privilege_checks
  union all select * from trigger_checks
  union all select * from constraint_checks
  union all select * from data_checks
)
select
  pg_catalog.bool_and(checks.passed) as ready,
  count(*)::integer as checks_run,
  count(*) filter (where not checks.passed)::integer as checks_failed,
  coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', checks.check_type,
        'name', checks.check_name
      ) order by checks.check_type, checks.check_name
    ) filter (where not checks.passed),
    '[]'::jsonb
  ) as failures
from checks;
