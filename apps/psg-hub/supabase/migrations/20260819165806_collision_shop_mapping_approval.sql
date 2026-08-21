-- Atomically approve one FileMaker source-shop mapping and append its audit
-- event. The function is service-role-only; the app separately authenticates a
-- current PSG superadmin before calling it.
create or replace function public.approve_collision_shop_mapping(
  p_source_system text,
  p_source_shop_key text,
  p_shop_id uuid,
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
  v_shop public.shops%rowtype;
begin
  if p_source_system <> 'filemaker_repair_customer' then
    raise exception 'Unsupported collision repair source'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_source_shop_key is null
    or p_source_shop_key <> pg_catalog.upper(pg_catalog.btrim(p_source_shop_key))
  then
    raise exception 'Invalid source shop key'
      using errcode = 'invalid_parameter_value';
  end if;

  if pg_catalog.length(pg_catalog.btrim(coalesce(p_review_notes, ''))) not between 20 and 1000 then
    raise exception 'Identity review notes must contain 20 to 1000 characters'
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
    raise exception 'Source shop mapping is no longer available for approval'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select shop.*
    into v_shop
  from public.shops shop
  where shop.id = p_shop_id;

  if not found then
    raise exception 'PSG Hub shop was not found'
      using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
    from public.collision_shop_mappings mapping
    where mapping.shop_id = p_shop_id
      and mapping.mapping_status = 'mapped'
  ) then
    raise exception 'PSG Hub shop is already mapped'
      using errcode = 'unique_violation';
  end if;

  update public.collision_shop_mappings
  set
    company_id = null,
    shop_id = p_shop_id,
    mapping_status = 'mapped',
    mapping_method = 'superadmin_identity_review',
    mapped_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where source_system = p_source_system
    and source_shop_key = p_source_shop_key;

  insert into public.access_audit (
    actor_profile_id,
    target_shop_id,
    action,
    payload_jsonb
  ) values (
    p_actor_profile_id,
    p_shop_id,
    'collision.shop_mapping.approve',
    pg_catalog.jsonb_build_object(
      'sourceShopKey', v_mapping.source_shop_key,
      'sourceShopName', v_mapping.source_shop_name,
      'targetShopName', coalesce(v_shop.name, v_shop.slug, p_shop_id::text),
      'mappingMethod', 'superadmin_identity_review',
      'reviewNotes', pg_catalog.btrim(p_review_notes)
    )
  );

  return pg_catalog.jsonb_build_object(
    'source_shop_key', v_mapping.source_shop_key,
    'source_shop_name', v_mapping.source_shop_name,
    'shop_id', p_shop_id,
    'shop_name', coalesce(v_shop.name, v_shop.slug, p_shop_id::text),
    'mapping_status', 'mapped'
  );
end;
$$;

comment on function public.approve_collision_shop_mapping(text, text, uuid, uuid, text) is
  'Service-only atomic approval of a FileMaker source shop to PSG Hub shop mapping with append-only audit evidence.';

revoke execute on function public.approve_collision_shop_mapping(text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.approve_collision_shop_mapping(text, text, uuid, uuid, text)
  to service_role;
