-- Keep the rollup refresh compatible with the project's safe-update guard.

create or replace function public.refresh_ksdot_crash_rollups()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rollup_rows bigint;
  total_rows bigint;
  located_rows bigint;
  matched_rows bigint;
begin
  delete from public.ksdot_crash_zip_monthly
  where dataset_key = 'ksdot_accidents';

  insert into public.ksdot_crash_zip_monthly (
    dataset_key,
    zip_code,
    month,
    total_crashes,
    fatal_crashes,
    injury_crashes,
    property_damage_crashes,
    rain_or_snow_crashes,
    deer_crashes,
    speed_related_crashes,
    work_zone_crashes,
    fatalities,
    injuries,
    vehicles,
    refreshed_at
  )
  select
    dataset_key,
    zip_code,
    date_trunc('month', occurred_on)::date,
    count(*)::integer,
    count(*) filter (where severity = 'FATAL')::integer,
    count(*) filter (where severity = 'INJURY')::integer,
    count(*) filter (where severity = 'PROPERTY DAMAGE ONLY')::integer,
    count(*) filter (where rain_or_wet_road or snow_or_ice)::integer,
    count(*) filter (where deer_involved)::integer,
    count(*) filter (where speed_related)::integer,
    count(*) filter (where work_zone)::integer,
    coalesce(sum(fatalities), 0)::integer,
    coalesce(sum(
      coalesce(disabling_injuries, 0)
      + coalesce(non_incapacitating_injuries, 0)
      + coalesce(possible_injuries, 0)
    ), 0)::integer,
    coalesce(sum(vehicle_count), 0)::integer,
    now()
  from public.ksdot_crashes
  where dataset_key = 'ksdot_accidents'
    and zip_code is not null
  group by dataset_key, zip_code, date_trunc('month', occurred_on)::date;

  get diagnostics rollup_rows = row_count;

  select
    count(*),
    count(*) filter (where location is not null),
    count(*) filter (where zip_resolution_status = 'matched')
  into total_rows, located_rows, matched_rows
  from public.ksdot_crashes
  where dataset_key = 'ksdot_accidents';

  return jsonb_build_object(
    'rollup_rows', rollup_rows,
    'total_rows', total_rows,
    'located_rows', located_rows,
    'zip_matched_rows', matched_rows
  );
end;
$$;

revoke all on function public.refresh_ksdot_crash_rollups()
  from public, anon, authenticated;
grant execute on function public.refresh_ksdot_crash_rollups() to service_role;
