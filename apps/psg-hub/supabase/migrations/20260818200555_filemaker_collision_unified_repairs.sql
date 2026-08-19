-- Prefer a complete, mapped FileMaker snapshot over legacy pilot rows for the
-- same company. This is a source-priority rule, not a union that double counts.

create or replace view public.v_collision_repair_orders
with (security_invoker = true)
as
with normalized as (
  select
    ro.id as repair_order_id,
    ro.company_id,
    c.shop_id,
    c.name as company_name,
    case
      when ro.dates_json ->> 'date_in' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (ro.dates_json ->> 'date_in')::date
    end as arrival_date,
    case
      when ro.dates_json ->> 'date_out' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (ro.dates_json ->> 'date_out')::date
    end as completion_date,
    ro.repair_amount_cents,
    lower(regexp_replace(
      btrim(coalesce(ro.payload_jsonb #>> '{advantage2,payType}', '')),
      '\s+',
      ' ',
      'g'
    )) as normalized_pay_type,
    nullif(upper(left(
      regexp_replace(coalesce(rc.address ->> 'postal_code', ''), '[^0-9]', '', 'g'),
      5
    )), '') as customer_zip,
    nullif(upper(btrim(rc.address ->> 'state')), '') as customer_state,
    nullif(btrim(ro.payload_jsonb #>> '{vehicle,make}'), '') as vehicle_make,
    nullif(btrim(ro.payload_jsonb #>> '{vehicle,model}'), '') as vehicle_model,
    ic.name as insurance_company_name,
    ro.status,
    ro.total_loss_flag,
    ro.source_system
  from public.repair_orders ro
  join public.repair_customers rc on rc.id = ro.repair_customer_id
  join public.companies c on c.id = ro.company_id
  left join public.insurance_companies ic on ic.id = ro.insurance_company_id
), categorized as (
  select
    normalized.*,
    case
      when normalized_pay_type in (
        'customer insurance',
        'claimant (other insurance)'
      ) then 'insurance'
      when normalized_pay_type = 'customer pay' then 'customer'
      when normalized_pay_type = 'third party pay' then 'third_party'
      when normalized_pay_type = 'non-insurance' then 'non_insurance'
      else 'unknown'
    end as payment_category
  from normalized
), filemaker as (
  select
    (
      substring(fact.source_record_hash, 1, 8) || '-' ||
      substring(fact.source_record_hash, 9, 4) || '-' ||
      substring(fact.source_record_hash, 13, 4) || '-' ||
      substring(fact.source_record_hash, 17, 4) || '-' ||
      substring(fact.source_record_hash, 21, 12)
    )::uuid as repair_order_id,
    mapping.company_id,
    mapping.shop_id,
    company.name as company_name,
    fact.arrival_date,
    fact.completion_date,
    fact.completion_date - fact.arrival_date as cycle_days,
    fact.repair_amount_cents::integer as repair_amount_cents,
    round(fact.repair_amount_cents::numeric / 100, 2) as repair_amount,
    fact.payment_category,
    fact.is_insured,
    fact.customer_zip,
    fact.customer_state,
    fact.vehicle_make,
    fact.vehicle_model,
    fact.insurance_company_raw as insurance_company_name,
    'historical'::text as status,
    regexp_replace(lower(coalesce(fact.pay_type_raw, '')), '[^a-z0-9]+', ' ', 'g')
      in ('total loss', 'tloss') as total_loss_flag,
    fact.source_system
  from public.collision_repair_facts fact
  join public.collision_repair_sources source
    on source.source_export_id = fact.source_export_id
   and source.status = 'loaded'
  join public.collision_shop_mappings mapping
    on mapping.source_system = fact.source_system
   and mapping.source_shop_key = fact.source_shop_key
   and mapping.mapping_status = 'mapped'
  join public.companies company on company.id = mapping.company_id
), filemaker_companies as (
  select distinct company_id from filemaker
), hub as (
  select
    categorized.repair_order_id,
    categorized.company_id,
    categorized.shop_id,
    categorized.company_name,
    categorized.arrival_date,
    categorized.completion_date,
    categorized.completion_date - categorized.arrival_date as cycle_days,
    categorized.repair_amount_cents,
    round(categorized.repair_amount_cents::numeric / 100, 2) as repair_amount,
    categorized.payment_category,
    case
      when categorized.payment_category = 'insurance' then true
      when categorized.payment_category = 'unknown' then null
      else false
    end as is_insured,
    categorized.customer_zip,
    categorized.customer_state,
    categorized.vehicle_make,
    categorized.vehicle_model,
    categorized.insurance_company_name,
    categorized.status,
    categorized.total_loss_flag,
    categorized.source_system
  from categorized
  where not exists (
    select 1
    from filemaker_companies
    where filemaker_companies.company_id = categorized.company_id
  )
)
select * from hub
union all
select * from filemaker;

comment on view public.v_collision_repair_orders is
  'PII-minimized repair-order facts. A complete mapped FileMaker snapshot replaces legacy pilot rows for that company to prevent double counting.';

revoke all on public.v_collision_repair_orders from anon, authenticated;
revoke all on public.v_collision_weekly_demand from anon, authenticated;
revoke all on public.v_collision_weather_monthly from anon, authenticated;
revoke all on public.v_collision_forecast_training_weekly from anon, authenticated;
revoke all on public.v_collision_ksdot_monthly from anon, authenticated;
revoke all on public.v_collision_zip_alert_candidates from anon, authenticated;
grant select on public.v_collision_repair_orders to service_role;
grant select on public.v_collision_weekly_demand to service_role;
grant select on public.v_collision_weather_monthly to service_role;
grant select on public.v_collision_forecast_training_weekly to service_role;
grant select on public.v_collision_ksdot_monthly to service_role;
grant select on public.v_collision_zip_alert_candidates to service_role;
