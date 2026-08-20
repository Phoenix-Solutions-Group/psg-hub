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

revoke all on table
  public.nhtsa_dataset_sources,
  public.nhtsa_crashes,
  public.nhtsa_vehicles,
  public.nhtsa_persons,
  public.storm_event_sources,
  public.storm_events,
  public.storm_zip_monthly,
  public.zipcode_boundaries
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.nhtsa_dataset_sources,
  public.nhtsa_crashes,
  public.nhtsa_vehicles,
  public.nhtsa_persons,
  public.storm_event_sources,
  public.storm_events,
  public.storm_zip_monthly,
  public.zipcode_boundaries
to service_role;

revoke all on sequence
  public.collision_demand_forecasts_id_seq,
  public.storm_event_sources_id_seq,
  public.storm_events_id_seq
from public, anon, authenticated;

grant usage, select, update on sequence
  public.collision_demand_forecasts_id_seq,
  public.storm_event_sources_id_seq,
  public.storm_events_id_seq
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

  if exists (
    select 1
    from (values
      ('public.nhtsa_dataset_sources'),
      ('public.nhtsa_crashes'),
      ('public.nhtsa_vehicles'),
      ('public.nhtsa_persons'),
      ('public.storm_event_sources'),
      ('public.storm_events'),
      ('public.storm_zip_monthly'),
      ('public.zipcode_boundaries')
    ) as relation_names(name)
    where has_table_privilege('anon', name, 'select,insert,update,delete')
       or has_table_privilege('authenticated', name, 'select,insert,update,delete')
       or not has_table_privilege('service_role', name, 'select')
  ) then
    raise exception 'collision source tables must remain service-role-only';
  end if;

  if exists (
    select 1
    from (values
      ('public.collision_demand_forecasts_id_seq'),
      ('public.storm_event_sources_id_seq'),
      ('public.storm_events_id_seq')
    ) as sequence_names(name)
    where has_sequence_privilege('anon', name, 'usage,select,update')
       or has_sequence_privilege('authenticated', name, 'usage,select,update')
       or not has_sequence_privilege('service_role', name, 'usage')
  ) then
    raise exception 'collision source sequences must remain service-role-only';
  end if;
end
$$;
