-- Governed Kansas crash facts for collision-demand analysis.
-- The import intentionally excludes report images, reporting agencies,
-- driver ages, and any free-text narrative fields.

create table public.ksdot_crash_sources (
  dataset_key text primary key,
  source_url text not null,
  attribution text not null,
  analysis_scope text not null,
  min_source_year smallint not null,
  max_source_year smallint not null,
  source_row_count integer not null default 0,
  imported_row_count integer not null default 0,
  located_row_count integer not null default 0,
  zip_matched_row_count integer not null default 0,
  last_sync_id uuid,
  last_sync_status text not null default 'running',
  sync_started_at timestamptz not null default now(),
  imported_at timestamptz,
  notes text,
  check (min_source_year between 2000 and 2100),
  check (max_source_year between min_source_year and 2100),
  check (last_sync_status in ('running', 'loaded', 'failed'))
);

create table public.ksdot_crashes (
  dataset_key text not null references public.ksdot_crash_sources (dataset_key)
    on delete cascade,
  accident_key text not null,
  source_object_id bigint,
  occurred_on date not null,
  source_year smallint not null,
  month smallint,
  hour smallint,
  day_of_week text,
  county text,
  city text,
  severity text,
  collision_type text,
  harmful_event text,
  weather_condition text,
  light_condition text,
  rain_or_wet_road boolean not null default false,
  snow_or_ice boolean not null default false,
  deer_involved boolean not null default false,
  speed_related boolean not null default false,
  work_zone boolean not null default false,
  traffic_units integer,
  vehicle_count integer,
  fatalities integer,
  disabling_injuries integer,
  non_incapacitating_injuries integer,
  possible_injuries integer,
  latitude double precision,
  longitude double precision,
  location geometry(point, 4326)
    generated always as (
      case
        when latitude is not null and longitude is not null
          then st_setsrid(st_makepoint(longitude, latitude), 4326)
      end
    ) stored,
  zip_code text,
  last_seen_sync_id uuid not null,
  refreshed_at timestamptz not null default now(),
  primary key (dataset_key, accident_key),
  check (source_year between 2000 and 2100),
  check (month is null or month between 1 and 12),
  check (hour is null or hour between 0 and 23),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (traffic_units is null or traffic_units >= 0),
  check (vehicle_count is null or vehicle_count >= 0),
  check (fatalities is null or fatalities >= 0),
  check (disabling_injuries is null or disabling_injuries >= 0),
  check (non_incapacitating_injuries is null or non_incapacitating_injuries >= 0),
  check (possible_injuries is null or possible_injuries >= 0)
);

create table public.ksdot_crash_zip_monthly (
  dataset_key text not null references public.ksdot_crash_sources (dataset_key)
    on delete cascade,
  zip_code text not null,
  month date not null,
  total_crashes integer not null,
  fatal_crashes integer not null,
  injury_crashes integer not null,
  property_damage_crashes integer not null,
  rain_or_snow_crashes integer not null,
  deer_crashes integer not null,
  speed_related_crashes integer not null,
  work_zone_crashes integer not null,
  fatalities integer not null,
  injuries integer not null,
  vehicles integer not null,
  refreshed_at timestamptz not null default now(),
  primary key (dataset_key, zip_code, month)
);

create index ksdot_crashes_year_idx
  on public.ksdot_crashes (dataset_key, source_year);
create index ksdot_crashes_zip_date_idx
  on public.ksdot_crashes (zip_code, occurred_on);
create index ksdot_crashes_date_idx
  on public.ksdot_crashes (occurred_on);
create index ksdot_crashes_location_idx
  on public.ksdot_crashes using gist (location);
create index ksdot_crash_zip_monthly_month_idx
  on public.ksdot_crash_zip_monthly (month);

alter table public.ksdot_crash_sources enable row level security;
alter table public.ksdot_crashes enable row level security;
alter table public.ksdot_crash_zip_monthly enable row level security;

create or replace function public.refresh_ksdot_crash_rollups()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resolved_rows bigint;
  rollup_rows bigint;
  total_rows bigint;
  located_rows bigint;
  matched_rows bigint;
begin
  with resolved as materialized (
    select
      crash.dataset_key,
      crash.accident_key,
      (
        select boundary.zip_code
        from public.zipcode_boundaries boundary
        where boundary.boundary is not null
          and public.st_covers(boundary.boundary, crash.location)
        order by boundary.zip_code
        limit 1
      ) as zip_code
    from public.ksdot_crashes crash
    where crash.zip_code is null
      and crash.location is not null
  )
  update public.ksdot_crashes crash
  set zip_code = resolved.zip_code
  from resolved
  where crash.dataset_key = resolved.dataset_key
    and crash.accident_key = resolved.accident_key
    and resolved.zip_code is not null;

  get diagnostics resolved_rows = row_count;

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
    count(*) filter (where zip_code is not null)
  into total_rows, located_rows, matched_rows
  from public.ksdot_crashes;

  return jsonb_build_object(
    'resolved_rows', resolved_rows,
    'rollup_rows', rollup_rows,
    'total_rows', total_rows,
    'located_rows', located_rows,
    'zip_matched_rows', matched_rows
  );
end;
$$;

create view public.v_collision_ksdot_monthly
with (security_invoker = true)
as
with portfolio as (
  select
    company_id,
    shop_id,
    company_name,
    customer_zip,
    count(*)::bigint as historical_repair_orders
  from public.v_collision_repair_orders
  where customer_state = 'KS'
    and customer_zip ~ '^[0-9]{5}$'
  group by company_id, shop_id, company_name, customer_zip
), months as (
  select distinct month
  from public.ksdot_crash_zip_monthly
), exposure as (
  select
    portfolio.company_id,
    portfolio.shop_id,
    portfolio.company_name,
    months.month,
    count(*)::integer as customer_zip_count,
    count(crashes.zip_code)::integer as crash_active_zip_count,
    coalesce(sum(crashes.total_crashes), 0)::integer as total_crashes,
    coalesce(sum(crashes.fatal_crashes), 0)::integer as fatal_crashes,
    coalesce(sum(crashes.injury_crashes), 0)::integer as injury_crashes,
    coalesce(sum(crashes.property_damage_crashes), 0)::integer
      as property_damage_crashes,
    coalesce(sum(crashes.rain_or_snow_crashes), 0)::integer
      as rain_or_snow_crashes,
    coalesce(sum(crashes.vehicles), 0)::integer as vehicles,
    round(
      sum(coalesce(crashes.total_crashes, 0) * portfolio.historical_repair_orders)::numeric
        / nullif(sum(portfolio.historical_repair_orders), 0),
      4
    ) as weighted_crash_exposure,
    max(crashes.refreshed_at) as crash_refreshed_at
  from portfolio
  cross join months
  left join public.ksdot_crash_zip_monthly crashes
    on crashes.zip_code = portfolio.customer_zip
   and crashes.month = months.month
  group by
    portfolio.company_id,
    portfolio.shop_id,
    portfolio.company_name,
    months.month
)
select * from exposure;

comment on table public.ksdot_crash_sources is
  'Provenance and refresh status for official KDOT statewide crash imports.';
comment on table public.ksdot_crashes is
  'PII-minimized KDOT crash facts. Report images, agencies, driver ages, and narratives are not stored.';
comment on table public.ksdot_crash_zip_monthly is
  'ZIP-month KDOT crash aggregates refreshed atomically after a successful source import.';
comment on view public.v_collision_ksdot_monthly is
  'Monthly KDOT crashes in each company customer-ZIP portfolio. Exposure is not an insurer claim estimate.';

revoke all on public.ksdot_crash_sources from anon, authenticated;
revoke all on public.ksdot_crashes from anon, authenticated;
revoke all on public.ksdot_crash_zip_monthly from anon, authenticated;
revoke all on public.v_collision_ksdot_monthly from anon;
revoke all on function public.refresh_ksdot_crash_rollups() from public, anon, authenticated;

grant select, insert, update, delete on public.ksdot_crash_sources to service_role;
grant select, insert, update, delete on public.ksdot_crashes to service_role;
grant select, insert, update, delete on public.ksdot_crash_zip_monthly to service_role;
grant select on public.v_collision_ksdot_monthly to authenticated, service_role;
grant execute on function public.refresh_ksdot_crash_rollups() to service_role;
