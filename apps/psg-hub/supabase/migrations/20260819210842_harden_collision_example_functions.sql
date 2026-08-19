alter function public.collision_targeting_examples(text, integer, integer)
  set search_path to pg_catalog, public;

alter function public.storm_demand_examples(integer, integer)
  set search_path to pg_catalog, public;

revoke execute on function public.collision_targeting_examples(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.storm_demand_examples(integer, integer)
  from public, anon, authenticated;

grant execute on function public.collision_targeting_examples(text, integer, integer)
  to service_role;
grant execute on function public.storm_demand_examples(integer, integer)
  to service_role;

do $$
begin
  if exists (
    select 1
    from pg_proc
    where oid in (
      to_regprocedure('public.collision_targeting_examples(text,integer,integer)'),
      to_regprocedure('public.storm_demand_examples(integer,integer)')
    )
      and not ('search_path=pg_catalog, public' = any(coalesce(proconfig, array[]::text[])))
  ) then
    raise exception 'collision example functions must use a fixed search_path';
  end if;

  if exists (
    select 1
    from (values
      ('public.collision_targeting_examples(text,integer,integer)'),
      ('public.storm_demand_examples(integer,integer)')
    ) as function_signatures(signature)
    where has_function_privilege('anon', signature, 'execute')
       or has_function_privilege('authenticated', signature, 'execute')
       or not has_function_privilege('service_role', signature, 'execute')
  ) then
    raise exception 'collision example function grants are not service-role-only';
  end if;
end
$$;
