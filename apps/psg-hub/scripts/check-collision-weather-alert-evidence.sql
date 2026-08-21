\set ON_ERROR_STOP on

begin;

\ir ../supabase/migrations/20260820235900_collision_weather_alert_review_cases.sql

create temporary table weather_fixture_identity on commit drop as
select membership.shop_id, membership.user_id as actor_profile_id
from public.shop_users membership
join public.profiles profile on profile.id = membership.user_id
where membership.role in ('owner', 'manager')
  and not exists (
    select 1
    from public.collision_shop_mappings mapping
    where mapping.shop_id = membership.shop_id
      and mapping.mapping_status = 'mapped'
  )
order by membership.created_at
limit 1;

do $$
begin
  if not exists (select 1 from weather_fixture_identity) then
    raise exception 'Weather evidence fixture requires one unmapped owner or manager shop';
  end if;
end;
$$;

insert into public.collision_repair_sources (
  source_export_id,
  source_system,
  source_file_name,
  file_sha256,
  file_modified_at,
  row_count,
  accepted_count,
  rejected_count,
  arrival_min,
  arrival_max,
  status
) values (
  'weather-evidence-fixture',
  'weather_fixture',
  'weather-evidence-fixture.json',
  repeat('f', 64),
  '2026-01-29T12:00:00Z',
  12,
  12,
  0,
  date '2024-01-03',
  current_date,
  'loaded'
);

insert into public.collision_shop_mappings (
  source_system,
  source_shop_key,
  source_shop_name,
  shop_id,
  mapping_status,
  mapping_method,
  mapped_at
)
select
  'weather_fixture',
  'WEATHERFIXTURE',
  'Weather Evidence Fixture',
  fixture.shop_id,
  'mapped',
  'rollback_test',
  now()
from weather_fixture_identity fixture;

insert into public.collision_repair_facts (
  source_system,
  source_record_hash,
  source_export_id,
  source_shop_key,
  source_shop_name,
  arrival_date,
  repair_amount_cents,
  pay_type_raw,
  payment_category,
  is_insured,
  customer_zip
)
select
  'weather_fixture',
  fixture_record.source_record_hash,
  'weather-evidence-fixture',
  'WEATHERFIXTURE',
  'Weather Evidence Fixture',
  fixture_record.arrival_date,
  100000,
  'Customer',
  'customer',
  false,
  fixture_record.customer_zip
from (
  values
    (repeat('0', 64), date '2024-01-03', '68512'),
    (repeat('1', 64), date '2025-01-02', '68512'),
    (repeat('2', 64), date '2025-01-09', '68512'),
    (repeat('3', 64), date '2025-01-16', '68512'),
    (repeat('4', 64), date '2025-01-23', '68512'),
    (repeat('5', 64), date '2025-12-20', '68512'),
    (repeat('6', 64), date '2026-01-02', '68512'),
    (repeat('7', 64), date '2026-01-09', '68512'),
    (repeat('8', 64), date '2026-01-16', '68512'),
    (repeat('9', 64), date '2026-01-23', '68512'),
    (repeat('a', 64), current_date, '99999'),
    (repeat('b', 64), current_date - 100, '99998')
) as fixture_record(source_record_hash, arrival_date, customer_zip);

insert into public.zipcode_boundaries (
  zip_code,
  state_fips,
  boundary
) values (
  '99998',
  '31',
  public.st_multi(
    public.st_geomfromtext(
      'POLYGON((-97 40,-96 40,-96 41,-97 41,-97 40))',
      4326
    )
  )
)
on conflict (zip_code) do update set boundary = excluded.boundary;

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
  notes
) values (
  'ncei_storm_events',
  'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/',
  'details',
  extract(year from current_date - pg_catalog.make_interval(years => 1))::integer,
  'weather-control-fixture',
  'https://example.invalid/weather-control-fixture.csv.gz',
  0,
  'loaded',
  'weather-control-fixture',
  'Rollback-only control coverage fixture.'
);

insert into public.storm_events (
  source,
  source_event_id,
  event_type,
  event_type_normalized,
  begin_time,
  source_year,
  source_month,
  begin_lat,
  begin_lng,
  begin_location,
  repair_demand_weight,
  import_batch_id
) values (
  'noaa_spc_preliminary_reports',
  9000000000001,
  'Tornado',
  'tornado',
  pg_catalog.now() - interval '1 hour',
  extract(year from current_date)::integer,
  extract(month from current_date)::integer,
  40.5,
  -96.5,
  public.st_setsrid(public.st_point(-96.5, 40.5), 4326)::public.geography,
  1,
  'weather-control-fixture'
);

select public.acknowledge_collision_weather_alert(
  fixture.shop_id,
  '99998',
  'tornado',
  (candidate.event_at at time zone 'UTC')::date,
  fixture.actor_profile_id
)
from weather_fixture_identity fixture
join public.v_collision_zip_alert_candidates candidate
  on candidate.shop_id = fixture.shop_id
 and candidate.zip_code = '99998'
 and candidate.event_type = 'tornado';

do $$
begin
  if not exists (
    select 1
    from public.collision_weather_alert_cases review_case
    where review_case.zip_code = '99998'
      and review_case.event_type = 'tornado'
      and review_case.event_date = (
        review_case.latest_event_at at time zone 'UTC'
      )::date
      and review_case.control_match_status = 'matched'
      and review_case.control_event_date = (
        (
          review_case.latest_event_at at time zone 'UTC'
        )::date - pg_catalog.make_interval(years => 1)
      )::date
      and review_case.control_match_years_back = 1
  ) then
    raise exception 'Acknowledgement did not pre-register the nearest eligible prior-year control';
  end if;

  if not exists (
    select 1
    from public.access_audit audit
    where audit.action = 'collision.weather_alert.acknowledge'
      and audit.payload_jsonb ->> 'zipCode' = '99998'
      and audit.payload_jsonb ->> 'controlMatchStatus' = 'matched'
      and audit.payload_jsonb ->> 'controlMatchYearsBack' = '1'
  ) then
    raise exception 'Acknowledgement audit is missing the pre-registered control';
  end if;
end;
$$;

insert into public.collision_weather_alert_cases (
  id,
  shop_id,
  zip_code,
  event_type,
  event_date,
  threshold_basis,
  latest_event_at,
  peak_magnitude,
  magnitude_unit,
  historical_repair_orders,
  report_count,
  control_match_status,
  control_event_date,
  control_match_years_back,
  owner_profile_id,
  acknowledged_by_profile_id
)
select
  'aaaaaaaa-0000-4000-8000-000000000001',
  fixture.shop_id,
  '68512',
  'hail',
  date '2026-01-01',
  'Hail >= 1 inch',
  '2026-01-01T12:00:00Z',
  1.5,
  'IN',
  2,
  1,
  'matched',
  date '2025-01-01',
  1,
  fixture.actor_profile_id,
  fixture.actor_profile_id
from weather_fixture_identity fixture;

do $$
declare
  evidence public.v_collision_weather_alert_case_evidence%rowtype;
begin
  select * into strict evidence
  from public.v_collision_weather_alert_case_evidence
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if not evidence.evidence_baseline_source_span_complete
    or evidence.evidence_follow_up_weeks_complete <> 4
    or evidence.evidence_prior_52_week_repair_orders <> 5
    or array[
      evidence.evidence_week_1_repair_orders,
      evidence.evidence_week_2_repair_orders,
      evidence.evidence_week_3_repair_orders,
      evidence.evidence_week_4_repair_orders
    ] <> array[1, 1, 1, 1]
    or not evidence.evidence_control_baseline_source_span_complete
    or evidence.evidence_control_follow_up_weeks_complete <> 4
    or evidence.evidence_control_prior_52_week_repair_orders <> 1
    or array[
      evidence.evidence_control_week_1_repair_orders,
      evidence.evidence_control_week_2_repair_orders,
      evidence.evidence_control_week_3_repair_orders,
      evidence.evidence_control_week_4_repair_orders
    ] <> array[1, 1, 1, 1]
    or not evidence.evidence_mature_for_close
  then
    raise exception 'Weather follow-up evidence did not preserve the signal and matched-control windows';
  end if;
end;
$$;

do $$
declare
  fixture weather_fixture_identity%rowtype;
begin
  select * into strict fixture from weather_fixture_identity;

  begin
    perform public.close_collision_weather_alert_case(
      'aaaaaaaa-0000-4000-8000-000000000001',
      fixture.shop_id,
      'no_observed_follow_through',
      'This outcome intentionally contradicts the measured arrivals.',
      fixture.actor_profile_id
    );
    raise exception 'Contradictory weather outcome was accepted';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

select public.close_collision_weather_alert_case(
  'aaaaaaaa-0000-4000-8000-000000000001',
  fixture.shop_id,
  'observed_follow_through',
  'Fixture confirms four complete follow-up weeks.',
  fixture.actor_profile_id
)
from weather_fixture_identity fixture;

do $$
begin
  if not exists (
    select 1
    from public.collision_weather_alert_cases review_case
    where review_case.id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and review_case.status = 'closed'
      and review_case.outcome_follow_up_weeks_complete = 4
      and review_case.outcome_prior_52_week_repair_orders = 5
      and review_case.outcome_week_4_repair_orders = 1
      and review_case.outcome_control_prior_52_week_repair_orders = 1
      and review_case.outcome_control_week_4_repair_orders = 1
      and review_case.outcome_evidence_captured_at is not null
  ) then
    raise exception 'Weather outcome did not capture its evidence snapshot';
  end if;

  if not exists (
    select 1
    from public.access_audit audit
    where audit.action = 'collision.weather_alert.close'
      and audit.payload_jsonb ->> 'caseId' = 'aaaaaaaa-0000-4000-8000-000000000001'
      and audit.payload_jsonb ->> 'followUpWeeksComplete' = '4'
      and audit.payload_jsonb ->> 'observedFourWeekRepairOrders' = '4'
      and audit.payload_jsonb ->> 'followThroughThresholdRepairOrders' = '2'
      and audit.payload_jsonb ->> 'controlObservedFourWeekRepairOrders' = '4'
      and audit.payload_jsonb ->> 'controlFollowThroughThresholdRepairOrders' = '2'
      and audit.payload_jsonb ->> 'controlOutcome' = 'observed_follow_through'
  ) then
    raise exception 'Weather outcome audit is missing the evidence snapshot';
  end if;

  if not exists (
    select 1
    from public.v_collision_weather_alert_monitoring monitoring
    join weather_fixture_identity fixture on fixture.shop_id = monitoring.shop_id
    where monitoring.cohort = 'all'
      and monitoring.matched_case_count = 1
      and monitoring.signal_follow_through_count = 1
      and monitoring.control_follow_through_count = 1
      and monitoring.signal_follow_through_rate_pct = 100
      and monitoring.control_follow_through_rate_pct = 100
      and monitoring.lift_pct_points = 0
  ) then
    raise exception 'Weather monitoring did not compare the closed signal with its matched control';
  end if;
end;
$$;

insert into public.collision_weather_alert_cases (
  id,
  shop_id,
  zip_code,
  event_type,
  event_date,
  threshold_basis,
  latest_event_at,
  historical_repair_orders,
  report_count,
  control_match_status,
  owner_profile_id,
  acknowledged_by_profile_id
)
select
  'aaaaaaaa-0000-4000-8000-000000000002',
  fixture.shop_id,
  '68512',
  'hail',
  date '2026-02-01',
  'Hail >= 1 inch',
  '2026-02-01T12:00:00Z',
  6,
  1,
  'unavailable',
  fixture.actor_profile_id,
  fixture.actor_profile_id
from weather_fixture_identity fixture;

do $$
declare
  fixture weather_fixture_identity%rowtype;
begin
  select * into strict fixture from weather_fixture_identity;

  begin
    perform public.close_collision_weather_alert_case(
      'aaaaaaaa-0000-4000-8000-000000000002',
      fixture.shop_id,
      'observed_follow_through',
      'This outcome is intentionally too early to record.',
      fixture.actor_profile_id
    );
    raise exception 'Immature observed outcome was accepted';
  exception
    when object_not_in_prerequisite_state then null;
  end;
end;
$$;

rollback;
