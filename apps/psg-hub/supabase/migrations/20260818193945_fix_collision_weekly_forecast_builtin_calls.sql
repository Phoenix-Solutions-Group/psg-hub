-- Fix SQL-expression qualification in both collision automation functions.

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
    coalesce(event.raw_payload, '{}'::jsonb)
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

create or replace function public.run_collision_weekly_forecasts(
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_forecast_week date := pg_catalog.date_trunc('week', p_as_of_date::timestamp)::date;
  v_candidate record;
  v_prediction numeric(8,2);
  v_history_weeks integer;
  v_source_age integer;
  v_status text;
  v_reason text;
  v_published integer := 0;
  v_stale integer := 0;
  v_insufficient integer := 0;
  v_observed integer := 0;
begin
  if p_as_of_date is null or p_as_of_date > current_date + 1 then
    raise exception 'Forecast as-of date must not be null or more than one day in the future';
  end if;

  update public.collision_demand_forecasts forecast
  set actual_repair_orders = coalesce((
        select demand.repair_orders
        from public.v_collision_weekly_demand demand
        where demand.company_id = forecast.company_id
          and demand.week_start = forecast.forecast_week
      ), 0),
      absolute_error = pg_catalog.abs(
        coalesce((
          select demand.repair_orders
          from public.v_collision_weekly_demand demand
          where demand.company_id = forecast.company_id
            and demand.week_start = forecast.forecast_week
        ), 0)::numeric - forecast.predicted_repair_orders
      ),
      observed_at = pg_catalog.now()
  where forecast.status = 'published'
    and forecast.forecast_week < v_forecast_week
    and forecast.actual_repair_orders is null;

  get diagnostics v_observed = row_count;

  for v_candidate in
    select
      orders.company_id,
      orders.shop_id,
      orders.company_name,
      max(orders.arrival_date) as latest_arrival_date
    from public.v_collision_repair_orders orders
    where orders.arrival_date is not null
    group by orders.company_id, orders.shop_id, orders.company_name
  loop
    select pg_catalog.round(pg_catalog.avg(history.repair_orders), 2), count(*)::integer
      into v_prediction, v_history_weeks
    from (
      select demand.repair_orders
      from public.v_collision_weekly_demand demand
      where demand.company_id = v_candidate.company_id
        and demand.week_start < v_forecast_week
      order by demand.week_start desc
      limit 4
    ) history;

    v_source_age := greatest(0, p_as_of_date - v_candidate.latest_arrival_date);

    if v_history_weeks < 4 then
      v_status := 'insufficient_history';
      v_reason := 'At least four completed repair weeks are required.';
      v_prediction := null;
      v_insufficient := v_insufficient + 1;
    elsif v_source_age > 14 then
      v_status := 'stale_source';
      v_reason := pg_catalog.format(
        'Latest repair arrival is %s days old; live publication requires 14 days or less.',
        v_source_age
      );
      v_prediction := null;
      v_stale := v_stale + 1;
    else
      v_status := 'published';
      v_reason := 'Trailing four-week average with an empirical 80% interval calibrated on the 2024 pilot year.';
      v_published := v_published + 1;
    end if;

    insert into public.collision_demand_forecasts (
      company_id,
      shop_id,
      company_name,
      forecast_week,
      model_key,
      predicted_repair_orders,
      lower_repair_orders,
      upper_repair_orders,
      prediction_interval_pct,
      source_latest_arrival_date,
      source_age_days,
      status,
      status_reason,
      generated_at
    ) values (
      v_candidate.company_id,
      v_candidate.shop_id,
      v_candidate.company_name,
      v_forecast_week,
      'trailing4_v1',
      v_prediction,
      case when v_prediction is null then null else greatest(0, pg_catalog.floor(v_prediction - 5)::integer) end,
      case when v_prediction is null then null else pg_catalog.ceil(v_prediction + 5)::integer end,
      80,
      v_candidate.latest_arrival_date,
      v_source_age,
      v_status,
      v_reason,
      pg_catalog.now()
    )
    on conflict (company_id, forecast_week, model_key) do update set
      shop_id = excluded.shop_id,
      company_name = excluded.company_name,
      predicted_repair_orders = excluded.predicted_repair_orders,
      lower_repair_orders = excluded.lower_repair_orders,
      upper_repair_orders = excluded.upper_repair_orders,
      prediction_interval_pct = excluded.prediction_interval_pct,
      source_latest_arrival_date = excluded.source_latest_arrival_date,
      source_age_days = excluded.source_age_days,
      status = excluded.status,
      status_reason = excluded.status_reason,
      generated_at = excluded.generated_at;
  end loop;

  return pg_catalog.jsonb_build_object(
    'forecast_week', v_forecast_week,
    'published', v_published,
    'stale_source', v_stale,
    'insufficient_history', v_insufficient,
    'observations_updated', v_observed
  );
end;
$$;

comment on function public.run_collision_weekly_forecasts(date) is
  'Scores the trailing-four-week model and publishes only when repair arrivals are no more than 14 days stale. Service role only.';

revoke execute on function public.run_collision_weekly_forecasts(date)
  from public, anon, authenticated;
grant execute on function public.run_collision_weekly_forecasts(date)
  to service_role;
