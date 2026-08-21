-- PII-minimized FileMaker repair analytics. Customer and agent identity fields
-- are intentionally absent.
-- Rollback: drop views, finalize function, facts, mappings, then source ledger.

create table public.collision_repair_sources (
  source_export_id text primary key,
  source_system text not null,
  source_file_name text not null,
  file_sha256 text not null unique,
  file_modified_at timestamptz not null,
  row_count integer not null,
  accepted_count integer not null,
  rejected_count integer not null,
  arrival_min date,
  arrival_max date,
  status text not null,
  notes text,
  imported_at timestamptz not null default now(),
  check (file_sha256 ~ '^[0-9a-f]{64}$'),
  check (row_count >= 0 and accepted_count >= 0 and rejected_count >= 0),
  check (row_count = accepted_count + rejected_count),
  check (status in ('loading', 'loaded', 'failed', 'superseded')),
  check (arrival_max is null or arrival_min is null or arrival_max >= arrival_min)
);

create table public.collision_shop_mappings (
  source_system text not null,
  source_shop_key text not null,
  source_shop_name text not null,
  company_id uuid references public.companies(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  mapping_status text not null default 'unmapped',
  mapping_method text,
  mapped_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (source_system, source_shop_key),
  check (source_shop_key = upper(source_shop_key)),
  check (mapping_status in ('mapped', 'unmapped', 'conflict')),
  check (
    (mapping_status = 'mapped' and company_id is not null and shop_id is not null)
    or (mapping_status <> 'mapped' and company_id is null and shop_id is null)
  )
);

create table public.collision_repair_facts (
  source_system text not null,
  source_record_hash text not null,
  source_export_id text not null references public.collision_repair_sources(source_export_id),
  source_shop_key text not null,
  source_shop_name text not null,
  source_creation_date date,
  arrival_date date,
  completion_date date,
  repair_amount_cents bigint not null,
  pay_type_raw text,
  payment_category text not null,
  is_insured boolean,
  insurance_company_raw text,
  insurance_company_normalized text,
  customer_zip text,
  customer_state text,
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  quality_issues text[] not null default '{}',
  imported_at timestamptz not null default now(),
  primary key (source_export_id, source_record_hash),
  check (source_record_hash ~ '^[0-9a-f]{64}$'),
  check (source_shop_key = upper(source_shop_key)),
  check (repair_amount_cents >= 0),
  check (completion_date is null or arrival_date is null or completion_date >= arrival_date),
  check (payment_category in ('insurance', 'customer', 'third_party', 'non_insurance', 'fleet', 'warranty', 'other', 'unknown')),
  check (
    (payment_category = 'insurance' and is_insured is true)
    or (payment_category in ('customer', 'third_party', 'non_insurance', 'fleet', 'warranty') and is_insured is false)
    or (payment_category in ('other', 'unknown') and is_insured is null)
  ),
  check (insurance_company_normalized is null or insurance_company_raw is not null),
  check (customer_zip is null or customer_zip ~ '^[0-9]{5}$'),
  check (customer_state is null or customer_state ~ '^[A-Z]{2}$'),
  check (vehicle_year is null or vehicle_year between 1900 and 2100)
);

create index collision_repair_facts_shop_arrival_idx
  on public.collision_repair_facts (source_shop_key, arrival_date desc);
create index collision_repair_facts_record_idx
  on public.collision_repair_facts (source_system, source_record_hash);
create index collision_repair_facts_insurer_idx
  on public.collision_repair_facts (insurance_company_normalized, arrival_date desc)
  where insurance_company_normalized is not null;
create index collision_repair_facts_zip_arrival_idx
  on public.collision_repair_facts (customer_zip, arrival_date desc)
  where customer_zip is not null;
create index collision_repair_facts_arrival_idx
  on public.collision_repair_facts (arrival_date desc)
  where arrival_date is not null;

alter table public.collision_repair_sources enable row level security;
alter table public.collision_shop_mappings enable row level security;
alter table public.collision_repair_facts enable row level security;

comment on table public.collision_repair_sources is
  'File provenance and reconciliation ledger for PII-minimized collision repair imports.';
comment on table public.collision_shop_mappings is
  'Explicit mapping from FileMaker master shop keys to participating PSG Hub companies and shops.';
comment on table public.collision_repair_facts is
  'PII-minimized repair facts. Excludes customer and agent names, street addresses, email, phone, birthdate, and raw payload.';

revoke all on public.collision_repair_sources from anon, authenticated;
revoke all on public.collision_shop_mappings from anon, authenticated;
revoke all on public.collision_repair_facts from anon, authenticated;
grant select, insert, update on public.collision_repair_sources to service_role;
grant select, insert, update on public.collision_shop_mappings to service_role;
grant select, insert, update, delete on public.collision_repair_facts to service_role;

with candidate as (
  select company.id, company.shop_id
  from public.companies company
  where company.name = 'Collision Leaders of Derby'
    and company.shop_id is not null
  order by company.id
  limit 1
)
insert into public.collision_shop_mappings (
  source_system,
  source_shop_key,
  source_shop_name,
  company_id,
  shop_id,
  mapping_status,
  mapping_method,
  mapped_at
)
select
  'filemaker_repair_customer',
  'PS177',
  'Shelton Collision Repair',
  candidate.id,
  candidate.shop_id,
  'mapped',
  'existing_pilot_mapping',
  now()
from candidate
on conflict (source_system, source_shop_key) do update set
  source_shop_name = excluded.source_shop_name,
  company_id = excluded.company_id,
  shop_id = excluded.shop_id,
  mapping_status = excluded.mapping_status,
  mapping_method = excluded.mapping_method,
  mapped_at = excluded.mapped_at,
  updated_at = now();

create or replace function public.finalize_collision_repair_import(
  p_source_export_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_system text;
  v_expected integer;
  v_actual integer;
  v_removed integer := 0;
begin
  select source.source_system, source.accepted_count
    into v_source_system, v_expected
  from public.collision_repair_sources source
  where source.source_export_id = p_source_export_id
    and source.status = 'loading'
  for update;

  if v_source_system is null then
    raise exception 'Collision repair source is missing or not loading';
  end if;

  select count(*)::integer
    into v_actual
  from public.collision_repair_facts fact
  where fact.source_export_id = p_source_export_id;

  if v_actual <> v_expected then
    raise exception 'Collision repair fact count mismatch: expected %, found %', v_expected, v_actual;
  end if;

  delete from public.collision_repair_facts fact
  where fact.source_system = v_source_system
    and fact.source_export_id <> p_source_export_id;
  get diagnostics v_removed = row_count;

  update public.collision_repair_sources
  set status = 'superseded'
  where source_system = v_source_system
    and source_export_id <> p_source_export_id
    and status = 'loaded';

  update public.collision_repair_sources
  set status = 'loaded', imported_at = pg_catalog.now()
  where source_export_id = p_source_export_id;

  return pg_catalog.jsonb_build_object(
    'source_export_id', p_source_export_id,
    'loaded', v_actual,
    'stale_removed', v_removed
  );
end;
$$;

comment on function public.finalize_collision_repair_import(text) is
  'Reconciles the complete PII-minimized FileMaker snapshot before removing stale facts. Service role only.';
revoke execute on function public.finalize_collision_repair_import(text)
  from public, anon, authenticated;
grant execute on function public.finalize_collision_repair_import(text)
  to service_role;

create or replace view public.v_collision_filemaker_shop_monthly
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  date_trunc('month', fact.arrival_date)::date as month,
  count(*)::integer as repair_orders,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  count(*) filter (where fact.is_insured is false)::integer as non_insured_repair_orders,
  count(*) filter (where fact.is_insured is null)::integer as unknown_payment_repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  round(avg(fact.completion_date - fact.arrival_date), 2) as average_cycle_days,
  count(distinct fact.insurance_company_normalized) filter (
    where fact.insurance_company_normalized is not null
  )::integer as insurer_count,
  count(distinct fact.customer_zip) filter (where fact.customer_zip is not null)::integer as customer_zip_count
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
where fact.arrival_date is not null
group by fact.source_shop_key, mapping.company_id, mapping.shop_id, date_trunc('month', fact.arrival_date)::date;

create or replace view public.v_collision_filemaker_insurers
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  fact.insurance_company_normalized,
  mode() within group (order by fact.insurance_company_raw) as insurance_company_name,
  count(*)::integer as repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(fact.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
where fact.insurance_company_normalized is not null
group by fact.source_shop_key, mapping.company_id, mapping.shop_id, fact.insurance_company_normalized;

create or replace view public.v_collision_filemaker_shop_summary
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  count(*)::integer as repair_orders,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date,
  count(*) filter (where fact.is_insured is true)::integer as insured_repair_orders,
  count(*) filter (where fact.arrival_date >= date '2026-01-01')::integer as repair_orders_2026,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  count(distinct fact.insurance_company_normalized) filter (
    where fact.insurance_company_normalized is not null
  )::integer as insurer_count,
  count(distinct fact.customer_zip) filter (where fact.customer_zip is not null)::integer as customer_zip_count,
  count(*) filter (where cardinality(fact.quality_issues) > 0)::integer as quality_flagged_rows
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
group by fact.source_shop_key, mapping.company_id, mapping.shop_id;

comment on view public.v_collision_filemaker_shop_monthly is
  'PII-free monthly repair, insurance, value, cycle, insurer, and ZIP metrics for each FileMaker shop key.';
comment on view public.v_collision_filemaker_insurers is
  'PII-free carrier volume and value by FileMaker shop key; normalized labels are not claim counts.';
comment on view public.v_collision_filemaker_shop_summary is
  'PII-free source-shop coverage, freshness, value, insurer breadth, ZIP breadth, and quality flags.';

revoke all on public.v_collision_filemaker_shop_monthly from anon, authenticated;
revoke all on public.v_collision_filemaker_insurers from anon, authenticated;
revoke all on public.v_collision_filemaker_shop_summary from anon, authenticated;
grant select on public.v_collision_filemaker_shop_monthly to service_role;
grant select on public.v_collision_filemaker_insurers to service_role;
grant select on public.v_collision_filemaker_shop_summary to service_role;
