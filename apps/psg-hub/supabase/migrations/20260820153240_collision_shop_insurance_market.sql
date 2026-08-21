-- Rollback: drop public.collision_shop_insurance_appetite_evidence.
begin;

create table if not exists public.collision_shop_insurance_appetite_evidence (
  registry_source text not null,
  registry_type text not null,
  registry_id text not null,
  naics_code text not null,
  carrier_name text not null,
  evidence_type text not null,
  evidence_scope text not null,
  state_codes text[] not null default '{}',
  coverage_types text[] not null,
  source_name text not null,
  source_url text not null,
  evidence_summary text not null,
  observed_on date not null,
  valid_through date,
  is_current boolean not null default true,
  imported_at timestamptz not null default now(),
  primary key (
    registry_source,
    registry_type,
    registry_id,
    naics_code,
    evidence_type,
    source_url
  ),
  foreign key (registry_source, registry_type, registry_id)
    references public.collision_insurer_registry (source, record_type, registry_id),
  check (registry_source = btrim(registry_source) and registry_source <> ''),
  check (registry_type in ('group', 'company')),
  check (registry_id ~ '^[0-9]+$'),
  check (naics_code = '811121'),
  check (carrier_name = btrim(carrier_name) and carrier_name <> ''),
  check (evidence_type in ('carrier_appetite', 'state_authorization', 'policy_observation')),
  check (evidence_scope in ('national_marketing', 'state_specific', 'psg_customer')),
  check (cardinality(coverage_types) > 0),
  check (
    coverage_types <@ array[
      'businessowners_policy',
      'business_income',
      'commercial_auto',
      'commercial_property',
      'cyber',
      'equipment_breakdown',
      'garage_liability',
      'garagekeepers',
      'general_liability',
      'umbrella',
      'workers_compensation'
    ]::text[]
  ),
  check (
    cardinality(state_codes) = 0
    or array_to_string(state_codes, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ),
  check (evidence_scope <> 'state_specific' or cardinality(state_codes) > 0),
  constraint collision_shop_insurance_evidence_contract check (
    case evidence_type
      when 'carrier_appetite' then
        evidence_scope in ('national_marketing', 'state_specific')
      when 'state_authorization' then
        registry_type = 'company'
        and evidence_scope = 'state_specific'
        and cardinality(state_codes) > 0
      when 'policy_observation' then
        registry_type = 'company'
        and evidence_scope = 'psg_customer'
        and cardinality(state_codes) > 0
        and valid_through is not null
      else false
    end
  ),
  check (source_name = btrim(source_name) and source_name <> ''),
  check (source_url ~ '^https://'),
  check (evidence_summary = btrim(evidence_summary) and evidence_summary <> ''),
  check (valid_through is null or valid_through >= observed_on)
);

alter table public.collision_shop_insurance_appetite_evidence
  enable row level security;

revoke all on public.collision_shop_insurance_appetite_evidence
  from public, anon, authenticated;
grant select, insert, update on public.collision_shop_insurance_appetite_evidence
  to service_role;

comment on table public.collision_shop_insurance_appetite_evidence is
  'Service-only evidence that an insurer targets NAICS 811121 body shops. Carrier appetite does not prove state authorization, bindability, or an active PSG customer policy.';

commit;
