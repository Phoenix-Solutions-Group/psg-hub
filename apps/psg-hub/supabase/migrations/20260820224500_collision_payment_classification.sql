-- Keep Hub-native payment classification aligned with the privacy-safe FileMaker facts.
-- FileMaker facts retain their imported category; this function classifies only Hub rows.

create or replace function public.collision_payment_category(
  p_raw_pay_type text,
  p_canonical_pay_type text default null
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when source.normalized in (
      'insurance',
      'ins',
      'claim',
      '3rd party',
      'third party',
      'customer insurance',
      'claimant other insurance',
      'ins pay which party unknown',
      'insurance pay which party unknown',
      'claiment',
      'claimat'
    ) then 'insurance'
    when source.normalized in (
      'customer',
      'cust',
      'customer pay',
      'cash customer pay',
      'cp',
      'self',
      'retail'
    ) then 'customer'
    when source.normalized = 'third party pay' then 'third_party'
    when source.normalized in (
      'internal',
      'comeback',
      'rework',
      'non insurance'
    ) then 'non_insurance'
    when source.normalized = 'fleet' then 'fleet'
    when source.normalized in ('warranty', 'mfg warranty', 'factory') then 'warranty'
    when source.normalized in ('total loss', 'tloss') then 'other'
    when p_canonical_pay_type = 'insurance' then 'insurance'
    when p_canonical_pay_type = 'customer' then 'customer'
    when p_canonical_pay_type = 'warranty' then 'warranty'
    when p_canonical_pay_type = 'internal' then 'non_insurance'
    else 'unknown'
  end
  from (
    select pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.lower(coalesce(p_raw_pay_type, '')),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) as normalized
  ) source;
$$;

comment on function public.collision_payment_category(text, text) is
  'Immutable Hub repair payment classifier. Exact aliases only; unknown labels remain unknown. FileMaker facts keep their import-time category.';

update public.repair_orders repair
set pay_type = classified.pay_type
from (
  select
    candidate.id,
    case public.collision_payment_category(
      candidate.payload_jsonb #>> '{advantage2,payType}',
      null
    )
      when 'insurance' then 'insurance'
      when 'customer' then 'customer'
      when 'warranty' then 'warranty'
    end as pay_type
  from public.repair_orders candidate
  where candidate.pay_type is null
) classified
where repair.id = classified.id
  and classified.pay_type is not null;

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
    ro.payload_jsonb #>> '{advantage2,payType}' as raw_pay_type,
    ro.pay_type as canonical_pay_type,
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
    public.collision_payment_category(
      normalized.raw_pay_type,
      normalized.canonical_pay_type
    ) as payment_category
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
    coalesce(company.name, shop.name) as company_name,
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
  join public.shops shop on shop.id = mapping.shop_id
  left join public.companies company on company.id = mapping.company_id
), filemaker_shops as (
  select distinct shop_id from filemaker
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
      when categorized.payment_category in ('unknown', 'other') then null
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
    from filemaker_shops
    where filemaker_shops.shop_id = categorized.shop_id
  )
)
select * from hub
union all
select * from filemaker;

comment on view public.v_collision_repair_orders is
  'PII-minimized repair facts keyed to the PSG Hub shop. Hub rows use the governed payment classifier; a complete mapped FileMaker snapshot replaces legacy rows for that shop.';

revoke all on function public.collision_payment_category(text, text)
  from public, anon, authenticated;
grant execute on function public.collision_payment_category(text, text)
  to service_role;

revoke all on public.v_collision_repair_orders from anon, authenticated;
grant select on public.v_collision_repair_orders to service_role;
