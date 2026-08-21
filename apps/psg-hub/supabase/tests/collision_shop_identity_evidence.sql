insert into public.shops (
  id,
  client_id,
  name,
  address_street,
  address_locality,
  address_region,
  address_postal_code
)
select
  '99999999-9999-4999-8999-999999999998'::uuid,
  client.id,
  'Rollback Address Test',
  '1500 Wrong Road',
  'Lincoln',
  'NE',
  '68512'
from public.clients client
order by client.id
limit 1;

insert into public.collision_shop_mappings (
  source_system,
  source_shop_key,
  source_shop_name,
  mapping_status
) values (
  'filemaker_repair_customer',
  'PS999998',
  'Rollback Address Test',
  'unmapped'
);

set local role service_role;

do $$
declare
  v_actor uuid;
  v_result jsonb;
begin
  select role.profile_id
    into v_actor
  from public.app_user_roles role
  where role.role = 'psg_superadmin'
  order by role.profile_id
  limit 1;

  if v_actor is null then
    raise exception 'A local superadmin fixture is required';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.review_collision_shop_identity_evidence(text,text,text,text,text,text,text,text,uuid,text)',
    'execute'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.review_collision_shop_identity_evidence(text,text,text,text,text,text,text,text,uuid,text)',
    'execute'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.collision_shop_identity_evidence',
    'select'
  ) then
    raise exception 'Shop identity evidence grants are unsafe';
  end if;

  select public.review_collision_shop_identity_evidence(
    'filemaker_repair_customer',
    'PS999998',
    '1500 Center Park Rd',
    'Lincoln',
    'NE',
    '68512',
    'Rollback authoritative source',
    'https://example.com/rollback-shop',
    v_actor,
    'Rollback test verifies the exact physical shop address.'
  ) into v_result;

  if v_result ->> 'mapping_changed' <> 'false'
    or not exists (
      select 1
      from public.collision_shop_mappings mapping
      where mapping.source_shop_key = 'PS999998'
        and mapping.mapping_status = 'unmapped'
        and mapping.shop_id is null
    )
    or not exists (
      select 1
      from public.access_audit audit
      where audit.actor_profile_id = v_actor
        and audit.action = 'collision.shop_identity_evidence.review'
        and audit.payload_jsonb ->> 'sourceShopKey' = 'PS999998'
    )
  then
    raise exception 'Evidence review crossed a mapping gate or missed its audit';
  end if;

  begin
    update public.collision_shop_mappings
    set
      mapping_status = 'mapped',
      shop_id = '99999999-9999-4999-8999-999999999998'::uuid
    where source_shop_key = 'PS999998';
    raise exception 'A mismatched Hub address was accepted';
  exception
    when check_violation then null;
  end;

  update public.shops
  set address_street = '1500 Center Park Road'
  where id = '99999999-9999-4999-8999-999999999998'::uuid;

  update public.collision_shop_mappings
  set
    mapping_status = 'mapped',
    shop_id = '99999999-9999-4999-8999-999999999998'::uuid
  where source_shop_key = 'PS999998';

  if not exists (
    select 1
    from public.collision_shop_mappings mapping
    where mapping.source_shop_key = 'PS999998'
      and mapping.mapping_status = 'mapped'
  ) then
    raise exception 'A governed road/rd address match was rejected';
  end if;

  begin
    perform public.review_collision_shop_identity_evidence(
      'filemaker_repair_customer',
      'PS999998',
      '1500 Center Park Rd',
      'Lincoln',
      'NE',
      '68512',
      'Rollback authoritative source',
      'https://example.com/rollback-shop',
      v_actor,
      'Mapped shop evidence must remain immutable after approval.'
    );
    raise exception 'Mapped shop evidence was changed';
  exception
    when object_not_in_prerequisite_state then null;
  end;
end;
$$;

reset role;
