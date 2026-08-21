create table public.collision_insurer_alias_reviews (
  source_label_normalized text primary key,
  canonical_insurer_key text,
  canonical_insurer_name text,
  review_status text not null default 'candidate',
  review_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_label_normalized = btrim(source_label_normalized)),
  check (source_label_normalized <> ''),
  check (review_status in ('candidate', 'approved', 'rejected')),
  check (
    canonical_insurer_key is null
    or canonical_insurer_key ~ '^[a-z0-9]+( [a-z0-9]+)*$'
  ),
  check (
    review_status <> 'approved'
    or (
      canonical_insurer_key is not null
      and canonical_insurer_name is not null
      and btrim(canonical_insurer_name) <> ''
      and reviewed_by is not null
      and reviewed_at is not null
    )
  ),
  check (
    review_status = 'candidate'
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index collision_insurer_alias_reviews_reviewer_idx
  on public.collision_insurer_alias_reviews (reviewed_by)
  where reviewed_by is not null;

alter table public.collision_insurer_alias_reviews enable row level security;
revoke all on public.collision_insurer_alias_reviews from anon, authenticated;
grant select, insert, update on public.collision_insurer_alias_reviews to service_role;

insert into public.collision_insurer_alias_reviews (source_label_normalized)
select distinct fact.insurance_company_normalized
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
where fact.insurance_company_normalized is not null
on conflict (source_label_normalized) do nothing;

create or replace view public.v_collision_insurer_alias_candidates
with (security_invoker = true)
as
select
  fact.source_shop_key,
  max(fact.source_shop_name) as source_shop_name,
  mapping.company_id,
  mapping.shop_id,
  fact.insurance_company_normalized as source_label_normalized,
  mode() within group (order by fact.insurance_company_raw) as source_label_name,
  coalesce(review.review_status, 'candidate') as review_status,
  review.canonical_insurer_key,
  review.canonical_insurer_name,
  count(*)::integer as repair_orders,
  sum(fact.repair_amount_cents)::bigint as repair_value_cents,
  min(fact.arrival_date) as first_arrival_date,
  max(fact.arrival_date) as latest_arrival_date
from public.collision_repair_facts fact
join public.collision_repair_sources source
  on source.source_export_id = fact.source_export_id
 and source.status = 'loaded'
left join public.collision_shop_mappings mapping
  on mapping.source_system = fact.source_system
 and mapping.source_shop_key = fact.source_shop_key
left join public.collision_insurer_alias_reviews review
  on review.source_label_normalized = fact.insurance_company_normalized
where fact.insurance_company_normalized is not null
group by
  fact.source_shop_key,
  mapping.company_id,
  mapping.shop_id,
  fact.insurance_company_normalized,
  review.review_status,
  review.canonical_insurer_key,
  review.canonical_insurer_name;

create or replace view public.v_collision_filemaker_insurers
with (security_invoker = true)
as
with labeled as (
  select
    fact.*,
    mapping.company_id,
    mapping.shop_id,
    case
      when review.review_status = 'approved'
        then 'canonical:' || review.canonical_insurer_key
      else 'source:' || fact.insurance_company_normalized
    end as insurer_group_key,
    case
      when review.review_status = 'approved'
        then review.canonical_insurer_key
      else fact.insurance_company_normalized
    end as insurer_key,
    case
      when review.review_status = 'approved'
        then review.canonical_insurer_name
      else fact.insurance_company_raw
    end as insurer_name,
    coalesce(review.review_status, 'candidate') as alias_review_status
  from public.collision_repair_facts fact
  join public.collision_repair_sources source
    on source.source_export_id = fact.source_export_id
   and source.status = 'loaded'
  left join public.collision_shop_mappings mapping
    on mapping.source_system = fact.source_system
   and mapping.source_shop_key = fact.source_shop_key
  left join public.collision_insurer_alias_reviews review
    on review.source_label_normalized = fact.insurance_company_normalized
  where fact.insurance_company_normalized is not null
)
select
  labeled.source_shop_key,
  max(labeled.source_shop_name) as source_shop_name,
  labeled.company_id,
  labeled.shop_id,
  mode() within group (order by labeled.insurer_key) as insurance_company_normalized,
  mode() within group (order by labeled.insurer_name) as insurance_company_name,
  count(*)::integer as repair_orders,
  sum(labeled.repair_amount_cents)::bigint as repair_value_cents,
  round(avg(labeled.repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  min(labeled.arrival_date) as first_arrival_date,
  max(labeled.arrival_date) as latest_arrival_date,
  mode() within group (order by labeled.alias_review_status) as alias_review_status
from labeled
group by
  labeled.source_shop_key,
  labeled.company_id,
  labeled.shop_id,
  labeled.insurer_group_key;

comment on table public.collision_insurer_alias_reviews is
  'Service-only insurer-label review decisions. No labels are merged until explicitly approved.';
comment on view public.v_collision_insurer_alias_candidates is
  'Service-only carrier-label review queue with repair volume and value; labels are not insurer claim counts.';
comment on view public.v_collision_filemaker_insurers is
  'PII-free carrier-tagged repair volume and value. Only explicitly approved aliases are canonically merged; these are not insurer claim counts.';

revoke all on public.v_collision_insurer_alias_candidates from public, anon, authenticated;
revoke all on public.v_collision_filemaker_insurers from public, anon, authenticated;
grant select on public.v_collision_insurer_alias_candidates to service_role;
grant select on public.v_collision_filemaker_insurers to service_role;
