begin;

insert into public.companies (id, name)
values ('aa000000-0000-4000-8000-000000000001', 'Weather coverage check');

insert into public.repair_customers (id, company_id, first_name, last_name, address)
values
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000001', 'Synthetic', 'One', '{"postal_code":"11111","state":"TS"}'),
  ('aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000001', 'Synthetic', 'Two', '{"postal_code":"11111","state":"TS"}'),
  ('aa000000-0000-4000-8000-000000000013', 'aa000000-0000-4000-8000-000000000001', 'Synthetic', 'Three', '{"postal_code":"22222","state":"TS"}'),
  ('aa000000-0000-4000-8000-000000000014', 'aa000000-0000-4000-8000-000000000001', 'Synthetic', 'Four', '{"postal_code":"33333","state":"TS"}');

insert into public.repair_orders (
  id,
  repair_customer_id,
  company_id,
  ro_number,
  dates_json,
  repair_amount_cents
)
values
  ('aa000000-0000-4000-8000-000000000021', 'aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000001', 'weather-1', '{"date_in":"2026-01-05","date_out":"2026-01-08"}', 100000),
  ('aa000000-0000-4000-8000-000000000022', 'aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000001', 'weather-2', '{"date_in":"2026-01-06","date_out":"2026-01-09"}', 100000),
  ('aa000000-0000-4000-8000-000000000023', 'aa000000-0000-4000-8000-000000000013', 'aa000000-0000-4000-8000-000000000001', 'weather-3', '{"date_in":"2026-01-07","date_out":"2026-01-10"}', 100000),
  ('aa000000-0000-4000-8000-000000000024', 'aa000000-0000-4000-8000-000000000014', 'aa000000-0000-4000-8000-000000000001', 'weather-4', '{"date_in":"2026-01-08","date_out":"2026-01-11"}', 100000);

insert into public.zipcode_boundaries (zip_code, state_fips)
values ('11111', '00'), ('22222', '00');

insert into public.storm_zip_monthly (
  zip,
  month,
  state,
  total_events,
  hail_events,
  wind_events,
  tornado_events,
  weighted_storm_demand_score,
  refreshed_at
)
values ('11111', '2026-01-01', 'TS', 3, 1, 1, 1, 10, '2026-02-01T00:00:00Z');

do $$
declare
  result record;
begin
  select * into strict result
  from public.v_collision_weather_monthly
  where company_id = 'aa000000-0000-4000-8000-000000000001'
    and month = date '2026-01-01';

  if result.customer_zip_count <> 3
    or result.weather_zip_count <> 2
    or result.weather_coverage_pct <> 75.00
    or result.weighted_total_events <> 1.5000
    or result.weather_refreshed_at <> '2026-02-01T00:00:00Z'::timestamptz then
    raise exception 'weather coverage check failed: %', row_to_json(result);
  end if;
end
$$;

rollback;
