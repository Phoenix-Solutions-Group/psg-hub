-- Resolve KDOT points in bounded batches so PostgREST statement timeouts do not
-- turn a successful source import into an all-or-nothing GIS operation.

alter table public.ksdot_crashes
  add column zip_resolution_status text not null default 'pending',
  add constraint ksdot_crashes_zip_resolution_status_check
    check (zip_resolution_status in ('pending', 'matched', 'unmatched'));

create index ksdot_crashes_unresolved_idx
  on public.ksdot_crashes (dataset_key, accident_key)
  where zip_resolution_status = 'pending';

create or replace function public.resolve_ksdot_crash_zips(p_batch_size integer default 5000)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  processed_rows bigint;
  matched_rows bigint;
  unmatched_rows bigint;
begin
  with pending as materialized (
    select crash.dataset_key, crash.accident_key, crash.location
    from public.ksdot_crashes crash
    where crash.zip_resolution_status = 'pending'
    order by crash.dataset_key, crash.accident_key
    limit least(greatest(coalesce(p_batch_size, 5000), 1), 10000)
  ), resolved as materialized (
    select
      pending.dataset_key,
      pending.accident_key,
      (
        select boundary.zip_code
        from public.zipcode_boundaries boundary
        where pending.location is not null
          and boundary.boundary is not null
          and public.st_covers(boundary.boundary, pending.location)
        order by boundary.zip_code
        limit 1
      ) as zip_code
    from pending
  ), updated as (
    update public.ksdot_crashes crash
    set
      zip_code = resolved.zip_code,
      zip_resolution_status = case
        when resolved.zip_code is null then 'unmatched'
        else 'matched'
      end
    from resolved
    where crash.dataset_key = resolved.dataset_key
      and crash.accident_key = resolved.accident_key
    returning crash.zip_resolution_status
  )
  select
    count(*),
    count(*) filter (where zip_resolution_status = 'matched'),
    count(*) filter (where zip_resolution_status = 'unmatched')
  into processed_rows, matched_rows, unmatched_rows
  from updated;

  return jsonb_build_object(
    'processed_rows', processed_rows,
    'matched_rows', matched_rows,
    'unmatched_rows', unmatched_rows
  );
end;
$$;

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
  delete from public.ksdot_crash_zip_monthly;

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
  where zip_code is not null
  group by dataset_key, zip_code, date_trunc('month', occurred_on)::date;

  get diagnostics rollup_rows = row_count;

  select
    count(*),
    count(*) filter (where location is not null),
    count(*) filter (where zip_resolution_status = 'matched')
  into total_rows, located_rows, matched_rows
  from public.ksdot_crashes;

  return jsonb_build_object(
    'rollup_rows', rollup_rows,
    'total_rows', total_rows,
    'located_rows', located_rows,
    'zip_matched_rows', matched_rows
  );
end;
$$;

revoke all on function public.resolve_ksdot_crash_zips(integer)
  from public, anon, authenticated;
revoke all on function public.refresh_ksdot_crash_rollups()
  from public, anon, authenticated;

grant execute on function public.resolve_ksdot_crash_zips(integer) to service_role;
grant execute on function public.refresh_ksdot_crash_rollups() to service_role;
