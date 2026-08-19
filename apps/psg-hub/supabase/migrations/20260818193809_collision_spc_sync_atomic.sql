-- Atomically replace a bounded rolling window of NOAA SPC preliminary reports.
-- Rollback: drop function public.replace_spc_preliminary_events.

create or replace function public.replace_spc_preliminary_events(
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_events jsonb,
  p_source jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_window_start is null
     or p_window_end is null
     or p_window_end <= p_window_start
     or p_window_end - p_window_start > interval '4 days' then
    raise exception 'SPC replacement window must be greater than zero and at most four days';
  end if;

  if p_events is null or pg_catalog.jsonb_typeof(p_events) <> 'array' then
    raise exception 'SPC event payload must be an array';
  end if;

  if pg_catalog.jsonb_array_length(p_events) > 25000 then
    raise exception 'SPC event payload must contain at most 25000 rows';
  end if;

  if p_source is null
     or pg_catalog.jsonb_typeof(p_source) <> 'object'
     or p_source ->> 'source_key' is distinct from 'noaa_spc_preliminary_reports'
     or p_source ->> 'file_family' is distinct from 'daily_reports'
     or p_source ->> 'status' is distinct from 'loaded_provisional' then
    raise exception 'Invalid SPC source metadata';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_events) as event(
      source text,
      source_event_id bigint,
      event_type_normalized text,
      begin_time timestamptz,
      begin_lat double precision,
      begin_lng double precision
    )
    where event.source is distinct from 'noaa_spc_preliminary_reports'
       or event.source_event_id is null
       or event.event_type_normalized is null
       or event.event_type_normalized not in ('tornado', 'hail', 'thunderstorm wind')
       or event.begin_time is null
       or event.begin_time < p_window_start
       or event.begin_time >= p_window_end
       or event.begin_lat is null
       or event.begin_lat not between -90 and 90
       or event.begin_lng is null
       or event.begin_lng not between -180 and 180
  ) then
    raise exception 'SPC event payload failed source, time, type, or coordinate validation';
  end if;

  delete from public.storm_events
  where source = 'noaa_spc_preliminary_reports'
    and begin_time >= p_window_start
    and begin_time < p_window_end;

  insert into public.storm_events (
    source,
    source_event_id,
    event_type,
    event_type_normalized,
    begin_time,
    end_time,
    state,
    source_year,
    source_month,
    month_name,
    magnitude,
    magnitude_type,
    begin_lat,
    begin_lng,
    end_lat,
    end_lng,
    begin_location,
    end_location,
    repair_demand_weight,
    import_batch_id,
    imported_at,
    raw_payload
  )
  select
    event.source,
    event.source_event_id,
    event.event_type,
    event.event_type_normalized,
    event.begin_time,
    event.end_time,
    event.state,
    event.source_year,
    event.source_month,
    event.month_name,
    event.magnitude,
    event.magnitude_type,
    event.begin_lat,
    event.begin_lng,
    event.end_lat,
    event.end_lng,
    public.st_setsrid(public.st_makepoint(event.begin_lng, event.begin_lat), 4326)::public.geography,
    public.st_setsrid(public.st_makepoint(event.end_lng, event.end_lat), 4326)::public.geography,
    event.repair_demand_weight,
    event.import_batch_id,
    pg_catalog.now(),
    pg_catalog.coalesce(event.raw_payload, '{}'::jsonb)
  from pg_catalog.jsonb_to_recordset(p_events) as event(
    source text,
    source_event_id bigint,
    event_type text,
    event_type_normalized text,
    begin_time timestamptz,
    end_time timestamptz,
    state text,
    source_year integer,
    source_month integer,
    month_name text,
    magnitude numeric,
    magnitude_type text,
    begin_lat double precision,
    begin_lng double precision,
    end_lat double precision,
    end_lng double precision,
    repair_demand_weight numeric,
    import_batch_id text,
    raw_payload jsonb
  )
  on conflict (source, source_event_id) do update set
    event_type = excluded.event_type,
    event_type_normalized = excluded.event_type_normalized,
    begin_time = excluded.begin_time,
    end_time = excluded.end_time,
    state = excluded.state,
    source_year = excluded.source_year,
    source_month = excluded.source_month,
    month_name = excluded.month_name,
    magnitude = excluded.magnitude,
    magnitude_type = excluded.magnitude_type,
    begin_lat = excluded.begin_lat,
    begin_lng = excluded.begin_lng,
    end_lat = excluded.end_lat,
    end_lng = excluded.end_lng,
    begin_location = excluded.begin_location,
    end_location = excluded.end_location,
    repair_demand_weight = excluded.repair_demand_weight,
    import_batch_id = excluded.import_batch_id,
    imported_at = excluded.imported_at,
    raw_payload = excluded.raw_payload;

  get diagnostics v_inserted = row_count;

  insert into public.storm_event_sources (
    source_key,
    source_url,
    file_family,
    source_year,
    cycle,
    file_url,
    row_count,
    status,
    import_batch_id,
    notes,
    imported_at
  )
  select
    source.source_key,
    source.source_url,
    source.file_family,
    source.source_year,
    source.cycle,
    source.file_url,
    source.row_count,
    source.status,
    source.import_batch_id,
    source.notes,
    pg_catalog.now()
  from pg_catalog.jsonb_to_record(p_source) as source(
    source_key text,
    source_url text,
    file_family text,
    source_year integer,
    cycle text,
    file_url text,
    row_count integer,
    status text,
    import_batch_id text,
    notes text
  )
  on conflict (source_key, file_family, source_year, cycle) do update set
    source_url = excluded.source_url,
    file_url = excluded.file_url,
    row_count = excluded.row_count,
    status = excluded.status,
    import_batch_id = excluded.import_batch_id,
    notes = excluded.notes,
    imported_at = excluded.imported_at;

  return v_inserted;
end;
$$;

comment on function public.replace_spc_preliminary_events(timestamptz, timestamptz, jsonb, jsonb) is
  'Atomically validates and replaces at most four convective days of NOAA SPC preliminary reports. Service role only.';

revoke execute on function public.replace_spc_preliminary_events(timestamptz, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_spc_preliminary_events(timestamptz, timestamptz, jsonb, jsonb)
  to service_role;
