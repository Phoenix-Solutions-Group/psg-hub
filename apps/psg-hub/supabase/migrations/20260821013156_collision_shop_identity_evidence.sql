-- Govern exact source-shop address evidence in Supabase. A code fallback may
-- explain a candidate, but only a row here can authorize a shop mapping.

create table public.collision_shop_identity_evidence (
  source_system text not null,
  source_shop_key text not null,
  address_street text not null,
  address_locality text not null,
  address_region text not null,
  address_postal_code text not null,
  source_name text not null,
  source_url text not null,
  review_notes text not null,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  primary key (source_system, source_shop_key),
  foreign key (source_system, source_shop_key)
    references public.collision_shop_mappings(source_system, source_shop_key)
    on update cascade on delete restrict,
  check (source_system = 'filemaker_repair_customer'),
  check (source_shop_key = upper(source_shop_key)),
  check (length(btrim(address_street)) between 3 and 200),
  check (length(btrim(address_locality)) between 2 and 100),
  check (address_region ~ '^[A-Z]{2}$'),
  check (address_postal_code ~ '^[0-9]{5}$'),
  check (length(btrim(source_name)) between 3 and 200),
  check (length(source_url) between 8 and 1000),
  check (source_url ~ '^https://[^[:space:]]+$'),
  check (length(btrim(review_notes)) between 20 and 1000)
);

alter table public.collision_shop_identity_evidence enable row level security;
revoke all on public.collision_shop_identity_evidence from public, anon, authenticated;
grant select, insert, update on public.collision_shop_identity_evidence to service_role;

comment on table public.collision_shop_identity_evidence is
  'Service-only, superadmin-reviewed physical address evidence required before a FileMaker source shop can be mapped to a PSG Hub shop.';

create or replace function public.review_collision_shop_identity_evidence(
  p_source_system text,
  p_source_shop_key text,
  p_address_street text,
  p_address_locality text,
  p_address_region text,
  p_address_postal_code text,
  p_source_name text,
  p_source_url text,
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
begin
  if p_source_system <> 'filemaker_repair_customer'
    or p_source_shop_key is null
    or p_source_shop_key !~ '^PS[0-9]+$'
    or p_source_shop_key <> pg_catalog.upper(pg_catalog.btrim(p_source_shop_key))
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_address_street, ''))) not between 3 and 200
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_address_locality, ''))) not between 2 and 100
    or coalesce(p_address_region, '') !~ '^[A-Z]{2}$'
    or coalesce(p_address_postal_code, '') !~ '^[0-9]{5}$'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_source_name, ''))) not between 3 and 200
    or pg_catalog.length(coalesce(p_source_url, '')) not between 8 and 1000
    or coalesce(p_source_url, '') !~ '^https://[^[:space:]]+$'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_review_notes, ''))) not between 20 and 1000
  then
    raise exception 'Valid shop identity evidence is required'
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

  select mapping.*
    into v_mapping
  from public.collision_shop_mappings mapping
  where mapping.source_system = p_source_system
    and mapping.source_shop_key = p_source_shop_key
  for update;

  if not found then
    raise exception 'Source shop mapping was not found'
      using errcode = 'no_data_found';
  end if;

  if v_mapping.mapping_status <> 'unmapped' or v_mapping.shop_id is not null then
    raise exception 'Identity evidence is immutable after shop mapping'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into public.collision_shop_identity_evidence (
    source_system,
    source_shop_key,
    address_street,
    address_locality,
    address_region,
    address_postal_code,
    source_name,
    source_url,
    review_notes,
    reviewed_by,
    reviewed_at
  ) values (
    p_source_system,
    p_source_shop_key,
    pg_catalog.btrim(p_address_street),
    pg_catalog.btrim(p_address_locality),
    p_address_region,
    p_address_postal_code,
    pg_catalog.btrim(p_source_name),
    pg_catalog.btrim(p_source_url),
    pg_catalog.btrim(p_review_notes),
    p_actor_profile_id,
    pg_catalog.now()
  )
  on conflict (source_system, source_shop_key) do update set
    address_street = excluded.address_street,
    address_locality = excluded.address_locality,
    address_region = excluded.address_region,
    address_postal_code = excluded.address_postal_code,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    review_notes = excluded.review_notes,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at;

  insert into public.access_audit (
    actor_profile_id,
    action,
    payload_jsonb
  ) values (
    p_actor_profile_id,
    'collision.shop_identity_evidence.review',
    pg_catalog.jsonb_build_object(
      'sourceShopKey', v_mapping.source_shop_key,
      'sourceShopName', v_mapping.source_shop_name,
      'address', pg_catalog.jsonb_build_object(
        'street', pg_catalog.btrim(p_address_street),
        'locality', pg_catalog.btrim(p_address_locality),
        'region', p_address_region,
        'postalCode', p_address_postal_code
      ),
      'sourceName', pg_catalog.btrim(p_source_name),
      'sourceUrl', pg_catalog.btrim(p_source_url),
      'reviewNotes', pg_catalog.btrim(p_review_notes)
    )
  );

  return pg_catalog.jsonb_build_object(
    'source_shop_key', v_mapping.source_shop_key,
    'evidence_status', 'governed',
    'mapping_status', v_mapping.mapping_status,
    'mapping_changed', false
  );
end;
$$;

comment on function public.review_collision_shop_identity_evidence(text, text, text, text, text, text, text, text, uuid, text) is
  'Service-only superadmin review of authoritative shop address evidence. Never maps a shop.';

revoke execute on function public.review_collision_shop_identity_evidence(text, text, text, text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_collision_shop_identity_evidence(text, text, text, text, text, text, text, text, uuid, text)
  to service_role;

create or replace function private.enforce_collision_shop_identity_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_evidence public.collision_shop_identity_evidence%rowtype;
  v_shop public.shops%rowtype;
  v_expected_street text;
  v_actual_street text;
begin
  if new.mapping_status <> 'mapped'
    or (
      tg_op = 'UPDATE'
      and old.mapping_status = 'mapped'
      and old.shop_id is not distinct from new.shop_id
    )
  then
    return new;
  end if;

  select evidence.*
    into v_evidence
  from public.collision_shop_identity_evidence evidence
  where evidence.source_system = new.source_system
    and evidence.source_shop_key = new.source_shop_key;

  if not found then
    raise exception 'Governed shop identity evidence is required before mapping'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select shop.*
    into v_shop
  from public.shops shop
  where shop.id = new.shop_id;

  if not found then
    raise exception 'PSG Hub shop was not found'
      using errcode = 'no_data_found';
  end if;

  -- ponytail: canonicalize road/rd for the two verified pilots; add USPS
  -- normalization when governed identity coverage expands beyond those locations.
  v_expected_street := pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.lower(v_evidence.address_street), '[^a-z0-9]+', ' ', 'g'),
    E'\\mroad\\M',
    'rd',
    'g'
  ));
  v_actual_street := pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.lower(coalesce(v_shop.address_street, '')), '[^a-z0-9]+', ' ', 'g'),
    E'\\mroad\\M',
    'rd',
    'g'
  ));

  if v_expected_street is distinct from v_actual_street
    or pg_catalog.lower(pg_catalog.btrim(v_evidence.address_locality))
      is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(v_shop.address_locality, '')))
    or v_evidence.address_region
      is distinct from pg_catalog.upper(pg_catalog.btrim(coalesce(v_shop.address_region, '')))
    or v_evidence.address_postal_code
      is distinct from pg_catalog.btrim(coalesce(v_shop.address_postal_code, ''))
  then
    raise exception 'Hub shop address does not match governed identity evidence'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists collision_shop_mapping_identity_gate
  on public.collision_shop_mappings;
create trigger collision_shop_mapping_identity_gate
  before insert or update
  on public.collision_shop_mappings
  for each row
  execute function private.enforce_collision_shop_identity_evidence();

comment on function private.enforce_collision_shop_identity_evidence() is
  'Rejects new mapped FileMaker shop rows unless a governed evidence address matches the target Hub shop exactly after limited canonicalization.';
