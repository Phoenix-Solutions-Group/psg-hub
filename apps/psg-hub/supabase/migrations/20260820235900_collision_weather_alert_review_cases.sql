-- Owned follow-up for severe weather signals. This records review work only;
-- it does not enable or send customer notifications.

create table public.collision_weather_alert_cases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  event_type text not null check (
    event_type in ('tornado', 'hail', 'thunderstorm wind')
  ),
  event_date date not null,
  alert_level text not null default 'high' check (alert_level = 'high'),
  threshold_basis text not null check (length(btrim(threshold_basis)) > 0),
  latest_event_at timestamptz not null,
  peak_magnitude numeric,
  magnitude_unit text,
  historical_repair_orders bigint not null check (historical_repair_orders >= 0),
  report_count integer not null check (report_count > 0),
  control_match_status text not null check (
    control_match_status in ('matched', 'unavailable')
  ),
  control_event_date date,
  control_match_years_back smallint check (control_match_years_back between 1 and 5),
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'acknowledged' check (
    status in ('acknowledged', 'closed')
  ),
  acknowledged_at timestamptz not null default now(),
  acknowledged_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  outcome text not null default 'pending' check (
    outcome in (
      'pending',
      'observed_follow_through',
      'no_observed_follow_through',
      'not_evaluable'
    )
  ),
  outcome_notes text,
  closed_at timestamptz,
  closed_by_profile_id uuid references public.profiles (id) on delete restrict,
  outcome_baseline_source_span_complete boolean,
  outcome_prior_52_week_repair_orders integer check (
    outcome_prior_52_week_repair_orders >= 0
  ),
  outcome_week_1_repair_orders integer check (outcome_week_1_repair_orders >= 0),
  outcome_week_2_repair_orders integer check (outcome_week_2_repair_orders >= 0),
  outcome_week_3_repair_orders integer check (outcome_week_3_repair_orders >= 0),
  outcome_week_4_repair_orders integer check (outcome_week_4_repair_orders >= 0),
  outcome_follow_up_weeks_complete smallint check (
    outcome_follow_up_weeks_complete between 0 and 4
  ),
  outcome_source_latest_arrival_date date,
  outcome_control_baseline_source_span_complete boolean,
  outcome_control_prior_52_week_repair_orders integer check (
    outcome_control_prior_52_week_repair_orders >= 0
  ),
  outcome_control_week_1_repair_orders integer check (
    outcome_control_week_1_repair_orders >= 0
  ),
  outcome_control_week_2_repair_orders integer check (
    outcome_control_week_2_repair_orders >= 0
  ),
  outcome_control_week_3_repair_orders integer check (
    outcome_control_week_3_repair_orders >= 0
  ),
  outcome_control_week_4_repair_orders integer check (
    outcome_control_week_4_repair_orders >= 0
  ),
  outcome_control_follow_up_weeks_complete smallint check (
    outcome_control_follow_up_weeks_complete between 0 and 4
  ),
  outcome_evidence_captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collision_weather_alert_cases_key unique (
    shop_id,
    zip_code,
    event_type,
    event_date
  ),
  constraint collision_weather_alert_cases_control_match_check check (
    (
      control_match_status = 'matched'
      and control_event_date is not null
      and control_event_date < event_date
      and control_match_years_back is not null
    )
    or (
      control_match_status = 'unavailable'
      and control_event_date is null
      and control_match_years_back is null
    )
  ),
  constraint collision_weather_alert_cases_lifecycle_check check (
    (
      status = 'acknowledged'
      and outcome = 'pending'
      and outcome_notes is null
      and closed_at is null
      and closed_by_profile_id is null
      and outcome_baseline_source_span_complete is null
      and outcome_prior_52_week_repair_orders is null
      and outcome_week_1_repair_orders is null
      and outcome_week_2_repair_orders is null
      and outcome_week_3_repair_orders is null
      and outcome_week_4_repair_orders is null
      and outcome_follow_up_weeks_complete is null
      and outcome_source_latest_arrival_date is null
      and outcome_control_baseline_source_span_complete is null
      and outcome_control_prior_52_week_repair_orders is null
      and outcome_control_week_1_repair_orders is null
      and outcome_control_week_2_repair_orders is null
      and outcome_control_week_3_repair_orders is null
      and outcome_control_week_4_repair_orders is null
      and outcome_control_follow_up_weeks_complete is null
      and outcome_evidence_captured_at is null
    )
    or (
      status = 'closed'
      and outcome <> 'pending'
      and length(btrim(outcome_notes)) between 20 and 2000
      and closed_at is not null
      and closed_by_profile_id is not null
      and outcome_baseline_source_span_complete is not null
      and outcome_prior_52_week_repair_orders is not null
      and outcome_week_1_repair_orders is not null
      and outcome_week_2_repair_orders is not null
      and outcome_week_3_repair_orders is not null
      and outcome_week_4_repair_orders is not null
      and outcome_follow_up_weeks_complete is not null
      and outcome_source_latest_arrival_date is not null
      and (
        (
          control_match_status = 'matched'
          and outcome_control_baseline_source_span_complete is not null
          and outcome_control_prior_52_week_repair_orders is not null
          and outcome_control_week_1_repair_orders is not null
          and outcome_control_week_2_repair_orders is not null
          and outcome_control_week_3_repair_orders is not null
          and outcome_control_week_4_repair_orders is not null
          and outcome_control_follow_up_weeks_complete is not null
        )
        or (
          control_match_status = 'unavailable'
          and outcome_control_baseline_source_span_complete is null
          and outcome_control_prior_52_week_repair_orders is null
          and outcome_control_week_1_repair_orders is null
          and outcome_control_week_2_repair_orders is null
          and outcome_control_week_3_repair_orders is null
          and outcome_control_week_4_repair_orders is null
          and outcome_control_follow_up_weeks_complete is null
        )
      )
      and outcome_evidence_captured_at is not null
    )
  )
);

create index collision_weather_alert_cases_shop_status_idx
  on public.collision_weather_alert_cases (shop_id, status, event_date desc);
create index collision_weather_alert_cases_owner_status_idx
  on public.collision_weather_alert_cases (owner_profile_id, status, event_date desc);

alter table public.collision_weather_alert_cases enable row level security;
revoke all on public.collision_weather_alert_cases from anon, authenticated;
grant select, insert, update on public.collision_weather_alert_cases to service_role;

create trigger collision_weather_alert_cases_updated_at
  before update on public.collision_weather_alert_cases
  for each row execute function public.update_updated_at();

comment on table public.collision_weather_alert_cases is
  'Service-only owned review cases for severe-threshold SPC signals. Acknowledgement pre-registers the nearest eligible prior-year shop/ZIP control; closure snapshots signal and control demand follow-through. Notifications remain disabled.';

-- ponytail: this scans the governed repair view twice; materialize by shop if case volume makes dashboard latency measurable.
create or replace view public.v_collision_weather_alert_case_evidence
with (security_invoker = true)
as
with shop_source_span as (
  select
    repair.shop_id,
    min(repair.arrival_date) as source_first_arrival_date,
    max(repair.arrival_date) as source_latest_arrival_date
  from public.v_collision_repair_orders repair
  where repair.arrival_date is not null
  group by repair.shop_id
), case_windows as (
  select
    review_case.id,
    count(repair.repair_order_id) filter (
      where repair.arrival_date >= review_case.event_date - 364
        and repair.arrival_date < review_case.event_date
    )::integer as prior_52_week_repair_orders,
    count(repair.repair_order_id) filter (
      where repair.arrival_date > review_case.event_date
        and repair.arrival_date <= review_case.event_date + 7
    )::integer as week_1_repair_orders,
    count(repair.repair_order_id) filter (
      where repair.arrival_date > review_case.event_date + 7
        and repair.arrival_date <= review_case.event_date + 14
    )::integer as week_2_repair_orders,
    count(repair.repair_order_id) filter (
      where repair.arrival_date > review_case.event_date + 14
        and repair.arrival_date <= review_case.event_date + 21
    )::integer as week_3_repair_orders,
    count(repair.repair_order_id) filter (
      where repair.arrival_date > review_case.event_date + 21
        and repair.arrival_date <= review_case.event_date + 28
    )::integer as week_4_repair_orders,
    count(repair.repair_order_id) filter (
      where review_case.control_event_date is not null
        and repair.arrival_date >= review_case.control_event_date - 364
        and repair.arrival_date < review_case.control_event_date
    )::integer as control_prior_52_week_repair_orders,
    count(repair.repair_order_id) filter (
      where review_case.control_event_date is not null
        and repair.arrival_date > review_case.control_event_date
        and repair.arrival_date <= review_case.control_event_date + 7
    )::integer as control_week_1_repair_orders,
    count(repair.repair_order_id) filter (
      where review_case.control_event_date is not null
        and repair.arrival_date > review_case.control_event_date + 7
        and repair.arrival_date <= review_case.control_event_date + 14
    )::integer as control_week_2_repair_orders,
    count(repair.repair_order_id) filter (
      where review_case.control_event_date is not null
        and repair.arrival_date > review_case.control_event_date + 14
        and repair.arrival_date <= review_case.control_event_date + 21
    )::integer as control_week_3_repair_orders,
    count(repair.repair_order_id) filter (
      where review_case.control_event_date is not null
        and repair.arrival_date > review_case.control_event_date + 21
        and repair.arrival_date <= review_case.control_event_date + 28
    )::integer as control_week_4_repair_orders
  from public.collision_weather_alert_cases review_case
  left join public.v_collision_repair_orders repair
    on repair.shop_id = review_case.shop_id
   and repair.customer_zip = review_case.zip_code
   and (
     (
       repair.arrival_date >= review_case.event_date - 364
       and repair.arrival_date <= review_case.event_date + 28
     )
     or (
       review_case.control_event_date is not null
       and repair.arrival_date >= review_case.control_event_date - 364
       and repair.arrival_date <= review_case.control_event_date + 28
     )
   )
  group by review_case.id
), live_evidence as (
  select
    review_case.id,
    source_span.source_latest_arrival_date,
    coalesce(
      source_span.source_first_arrival_date <= review_case.event_date - 364
        and source_span.source_latest_arrival_date >= review_case.event_date,
      false
    ) as baseline_source_span_complete,
    greatest(
      0,
      least(
        4,
        coalesce(
          floor((source_span.source_latest_arrival_date - review_case.event_date)::numeric / 7),
          0
        )
      )
    )::smallint as follow_up_weeks_complete,
    case_windows.prior_52_week_repair_orders,
    case_windows.week_1_repair_orders,
    case_windows.week_2_repair_orders,
    case_windows.week_3_repair_orders,
    case_windows.week_4_repair_orders,
    review_case.control_match_status = 'matched'
      and coalesce(
        source_span.source_first_arrival_date <= review_case.control_event_date - 364
          and source_span.source_latest_arrival_date >= review_case.control_event_date + 28,
        false
      ) as control_baseline_source_span_complete,
    case
      when review_case.control_match_status = 'matched' then greatest(
        0,
        least(
          4,
          coalesce(
            floor((source_span.source_latest_arrival_date - review_case.control_event_date)::numeric / 7),
            0
          )
        )
      )::smallint
      else 0::smallint
    end as control_follow_up_weeks_complete,
    case_windows.control_prior_52_week_repair_orders,
    case_windows.control_week_1_repair_orders,
    case_windows.control_week_2_repair_orders,
    case_windows.control_week_3_repair_orders,
    case_windows.control_week_4_repair_orders
  from public.collision_weather_alert_cases review_case
  left join shop_source_span source_span on source_span.shop_id = review_case.shop_id
  join case_windows on case_windows.id = review_case.id
)
select
  review_case.*,
  case
    when review_case.status = 'closed'
      then review_case.outcome_source_latest_arrival_date
    else live_evidence.source_latest_arrival_date
  end as evidence_source_latest_arrival_date,
  case
    when review_case.status = 'closed'
      then review_case.outcome_baseline_source_span_complete
    else live_evidence.baseline_source_span_complete
  end as evidence_baseline_source_span_complete,
  case
    when review_case.status = 'closed'
      then review_case.outcome_follow_up_weeks_complete
    else live_evidence.follow_up_weeks_complete
  end as evidence_follow_up_weeks_complete,
  case
    when review_case.status = 'closed'
      then review_case.outcome_prior_52_week_repair_orders
    else live_evidence.prior_52_week_repair_orders
  end as evidence_prior_52_week_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_week_1_repair_orders
    else live_evidence.week_1_repair_orders
  end as evidence_week_1_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_week_2_repair_orders
    else live_evidence.week_2_repair_orders
  end as evidence_week_2_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_week_3_repair_orders
    else live_evidence.week_3_repair_orders
  end as evidence_week_3_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_week_4_repair_orders
    else live_evidence.week_4_repair_orders
  end as evidence_week_4_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_baseline_source_span_complete
    when review_case.control_match_status = 'matched'
      then live_evidence.control_baseline_source_span_complete
    else null
  end as evidence_control_baseline_source_span_complete,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_follow_up_weeks_complete
    when review_case.control_match_status = 'matched'
      then live_evidence.control_follow_up_weeks_complete
    else null
  end as evidence_control_follow_up_weeks_complete,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_prior_52_week_repair_orders
    when review_case.control_match_status = 'matched'
      then live_evidence.control_prior_52_week_repair_orders
    else null
  end as evidence_control_prior_52_week_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_week_1_repair_orders
    when review_case.control_match_status = 'matched'
      then live_evidence.control_week_1_repair_orders
    else null
  end as evidence_control_week_1_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_week_2_repair_orders
    when review_case.control_match_status = 'matched'
      then live_evidence.control_week_2_repair_orders
    else null
  end as evidence_control_week_2_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_week_3_repair_orders
    when review_case.control_match_status = 'matched'
      then live_evidence.control_week_3_repair_orders
    else null
  end as evidence_control_week_3_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_control_week_4_repair_orders
    when review_case.control_match_status = 'matched'
      then live_evidence.control_week_4_repair_orders
    else null
  end as evidence_control_week_4_repair_orders,
  case
    when review_case.status = 'closed'
      then review_case.outcome_follow_up_weeks_complete = 4
        and review_case.outcome_baseline_source_span_complete
    else live_evidence.follow_up_weeks_complete = 4
      and live_evidence.baseline_source_span_complete
  end as evidence_signal_mature_for_close,
  case
    when review_case.status = 'closed'
      then review_case.control_match_status = 'matched'
        and review_case.outcome_control_follow_up_weeks_complete = 4
        and review_case.outcome_control_baseline_source_span_complete
    else review_case.control_match_status = 'matched'
      and live_evidence.control_follow_up_weeks_complete = 4
      and live_evidence.control_baseline_source_span_complete
  end as evidence_control_mature_for_close,
  case
    when review_case.status = 'closed'
      then review_case.outcome_follow_up_weeks_complete = 4
        and review_case.outcome_baseline_source_span_complete
        and review_case.control_match_status = 'matched'
        and review_case.outcome_control_follow_up_weeks_complete = 4
        and review_case.outcome_control_baseline_source_span_complete
    else live_evidence.follow_up_weeks_complete = 4
      and live_evidence.baseline_source_span_complete
      and review_case.control_match_status = 'matched'
      and live_evidence.control_follow_up_weeks_complete = 4
      and live_evidence.control_baseline_source_span_complete
  end as evidence_mature_for_close
from public.collision_weather_alert_cases review_case
join live_evidence on live_evidence.id = review_case.id;

comment on view public.v_collision_weather_alert_case_evidence is
  'Service-only exact 1-4 week shop/ZIP repair arrivals after an acknowledged severe-weather signal and its pre-registered prior-year control. Same-day arrivals are excluded; each baseline is the prior 364 calendar days. Closed cases show immutable evidence snapshots.';

revoke all on public.v_collision_weather_alert_case_evidence from anon, authenticated;
grant select on public.v_collision_weather_alert_case_evidence to service_role;

create or replace view public.v_collision_weather_alert_monitoring
with (security_invoker = true)
as
with evaluable_cases as (
  select
    review_case.shop_id,
    review_case.event_type,
    (review_case.outcome = 'observed_follow_through')::integer
      as signal_follow_through,
    (
      review_case.outcome_control_week_1_repair_orders
      + review_case.outcome_control_week_2_repair_orders
      + review_case.outcome_control_week_3_repair_orders
      + review_case.outcome_control_week_4_repair_orders
      >= greatest(
        2,
        floor(
          review_case.outcome_control_prior_52_week_repair_orders::numeric / 13
        )::integer + 1
      )
    )::integer as control_follow_through
  from public.collision_weather_alert_cases review_case
  where review_case.status = 'closed'
    and review_case.outcome in (
      'observed_follow_through',
      'no_observed_follow_through'
    )
    and review_case.control_match_status = 'matched'
), cohorts as (
  select
    shop_id,
    'all'::text as cohort,
    count(*)::integer as matched_case_count,
    sum(signal_follow_through)::integer as signal_follow_through_count,
    sum(control_follow_through)::integer as control_follow_through_count
  from evaluable_cases
  group by shop_id

  union all

  select
    shop_id,
    event_type as cohort,
    count(*)::integer as matched_case_count,
    sum(signal_follow_through)::integer as signal_follow_through_count,
    sum(control_follow_through)::integer as control_follow_through_count
  from evaluable_cases
  group by shop_id, event_type
)
select
  shop_id,
  cohort,
  matched_case_count,
  signal_follow_through_count,
  control_follow_through_count,
  round(100 * signal_follow_through_count::numeric / matched_case_count, 2)
    as signal_follow_through_rate_pct,
  round(100 * control_follow_through_count::numeric / matched_case_count, 2)
    as control_follow_through_rate_pct,
  round(
    100 * (
      signal_follow_through_count - control_follow_through_count
    )::numeric / matched_case_count,
    2
  ) as lift_pct_points
from cohorts;

comment on view public.v_collision_weather_alert_monitoring is
  'Service-only descriptive comparison of closed severe-weather review cases with their pre-registered shop/ZIP controls. Rates do not authorize notifications or operational changes.';

revoke all on public.v_collision_weather_alert_monitoring from anon, authenticated;
grant select on public.v_collision_weather_alert_monitoring to service_role;

create or replace function public.acknowledge_collision_weather_alert(
  p_shop_id uuid,
  p_zip_code text,
  p_event_type text,
  p_event_date date,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_zip_code text := pg_catalog.btrim(coalesce(p_zip_code, ''));
  v_event_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_event_type, '')));
  v_case public.collision_weather_alert_cases%rowtype;
  v_latest_event_at timestamptz;
  v_peak_magnitude numeric;
  v_magnitude_unit text;
  v_threshold_basis text;
  v_historical_repair_orders bigint;
  v_report_count integer;
  v_control_event_date date;
  v_control_match_years_back smallint;
  v_inserted boolean := false;
begin
  if p_shop_id is null
    or v_zip_code !~ '^[0-9]{5}$'
    or v_event_type not in ('tornado', 'hail', 'thunderstorm wind')
    or p_event_date is null
  then
    raise exception 'A valid shop, ZIP, event type, and event date are required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1
    from public.shop_users membership
    where membership.shop_id = p_shop_id
      and membership.user_id = p_actor_profile_id
      and membership.role in ('owner', 'manager')
  ) then
    raise exception 'A current shop owner or manager is required'
      using errcode = 'insufficient_privilege';
  end if;

  select
    max(candidate.event_at),
    max(candidate.magnitude),
    max(candidate.magnitude_unit),
    max(candidate.threshold_basis),
    max(candidate.historical_repair_orders),
    count(distinct candidate.source_event_id)::integer
    into
      v_latest_event_at,
      v_peak_magnitude,
      v_magnitude_unit,
      v_threshold_basis,
      v_historical_repair_orders,
      v_report_count
  from public.v_collision_zip_alert_candidates candidate
  where candidate.shop_id = p_shop_id
    and candidate.zip_code = v_zip_code
    and candidate.event_type = v_event_type
    and (candidate.event_at at time zone 'UTC')::date = p_event_date
    and candidate.alert_level = 'high';

  if v_report_count = 0 then
    raise exception 'This severe-weather signal is no longer available for acknowledgement'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  with source_span as (
    select
      min(repair.arrival_date) as source_first_arrival_date,
      max(repair.arrival_date) as source_latest_arrival_date
    from public.v_collision_repair_orders repair
    where repair.shop_id = p_shop_id
  ), prior_years as (
    select
      prior.years_back::smallint as years_back,
      (p_event_date - pg_catalog.make_interval(years => prior.years_back))::date
        as control_event_date
    from pg_catalog.generate_series(1, 5) prior(years_back)
  )
  select prior.control_event_date, prior.years_back
    into v_control_event_date, v_control_match_years_back
  from prior_years prior
  cross join source_span
  where source_span.source_first_arrival_date <= prior.control_event_date - 364
    and source_span.source_latest_arrival_date >= prior.control_event_date + 28
    and exists (
      select 1
      from public.zipcode_boundaries boundary
      where boundary.zip_code = v_zip_code
    )
    and not exists (
      select 1
      from pg_catalog.generate_series(
        extract(year from prior.control_event_date)::integer,
        extract(year from prior.control_event_date + 28)::integer
      ) required_year(source_year)
      where not exists (
        select 1
        from public.storm_event_sources source
        where source.source_key = 'ncei_storm_events'
          and source.file_family = 'details'
          and source.source_year = required_year.source_year
          and source.status = 'loaded'
      )
    )
    and not exists (
      select 1
      from public.storm_zip_monthly storm
      where storm.zip = v_zip_code
        and storm.month between
          pg_catalog.date_trunc('month', prior.control_event_date)::date
          and pg_catalog.date_trunc('month', prior.control_event_date + 28)::date
        and (
          coalesce(storm.tornado_events, 0) > 0
          or coalesce(storm.max_hail_size, 0) >= 1
          or coalesce(storm.max_wind_speed, 0) >= 50
        )
    )
  order by prior.years_back
  limit 1;

  insert into public.collision_weather_alert_cases (
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
  ) values (
    p_shop_id,
    v_zip_code,
    v_event_type,
    p_event_date,
    v_threshold_basis,
    v_latest_event_at,
    v_peak_magnitude,
    v_magnitude_unit,
    v_historical_repair_orders,
    v_report_count,
    case when v_control_event_date is null then 'unavailable' else 'matched' end,
    v_control_event_date,
    v_control_match_years_back,
    p_actor_profile_id,
    p_actor_profile_id
  )
  on conflict (shop_id, zip_code, event_type, event_date) do nothing
  returning * into v_case;

  if found then
    v_inserted := true;
  else
    select review_case.*
      into strict v_case
    from public.collision_weather_alert_cases review_case
    where review_case.shop_id = p_shop_id
      and review_case.zip_code = v_zip_code
      and review_case.event_type = v_event_type
      and review_case.event_date = p_event_date;
  end if;

  if v_inserted then
    insert into public.access_audit (
      actor_profile_id,
      target_shop_id,
      action,
      payload_jsonb
    ) values (
      p_actor_profile_id,
      p_shop_id,
      'collision.weather_alert.acknowledge',
      pg_catalog.jsonb_build_object(
        'caseId', v_case.id,
        'zipCode', v_case.zip_code,
        'eventType', v_case.event_type,
        'eventDate', v_case.event_date,
        'reportCount', v_case.report_count,
        'controlMatchStatus', v_case.control_match_status,
        'controlEventDate', v_case.control_event_date,
        'controlMatchYearsBack', v_case.control_match_years_back
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'case_id', v_case.id,
    'status', v_case.status,
    'owner_profile_id', v_case.owner_profile_id,
    'control_match_status', v_case.control_match_status,
    'control_event_date', v_case.control_event_date,
    'created', v_inserted
  );
end;
$$;

comment on function public.acknowledge_collision_weather_alert(uuid, text, text, date, uuid) is
  'Service-only, idempotent acknowledgement of a current severe-threshold signal by a shop owner or manager. The nearest eligible one-to-five-year prior shop/ZIP control is pre-registered without using follow-up outcomes.';

revoke execute on function public.acknowledge_collision_weather_alert(uuid, text, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_collision_weather_alert(uuid, text, text, date, uuid)
  to service_role;

create or replace function public.close_collision_weather_alert_case(
  p_case_id uuid,
  p_shop_id uuid,
  p_outcome text,
  p_outcome_notes text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outcome text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_outcome, '')));
  v_notes text := pg_catalog.btrim(coalesce(p_outcome_notes, ''));
  v_case public.collision_weather_alert_cases%rowtype;
  v_baseline_source_span_complete boolean;
  v_prior_52_week_repair_orders integer;
  v_week_1_repair_orders integer;
  v_week_2_repair_orders integer;
  v_week_3_repair_orders integer;
  v_week_4_repair_orders integer;
  v_follow_up_weeks_complete smallint;
  v_source_latest_arrival_date date;
  v_control_baseline_source_span_complete boolean;
  v_control_prior_52_week_repair_orders integer;
  v_control_week_1_repair_orders integer;
  v_control_week_2_repair_orders integer;
  v_control_week_3_repair_orders integer;
  v_control_week_4_repair_orders integer;
  v_control_follow_up_weeks_complete smallint;
  v_observed_four_week_repair_orders integer;
  v_follow_through_threshold_repair_orders integer;
  v_expected_outcome text;
  v_control_observed_four_week_repair_orders integer;
  v_control_follow_through_threshold_repair_orders integer;
  v_control_expected_outcome text;
begin
  if p_case_id is null
    or p_shop_id is null
    or v_outcome not in (
      'observed_follow_through',
      'no_observed_follow_through',
      'not_evaluable'
    )
    or pg_catalog.length(v_notes) not between 20 and 2000
  then
    raise exception 'A valid case, outcome, and 20 to 2000 character note are required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1
    from public.shop_users membership
    where membership.shop_id = p_shop_id
      and membership.user_id = p_actor_profile_id
      and membership.role in ('owner', 'manager')
  ) then
    raise exception 'A current shop owner or manager is required'
      using errcode = 'insufficient_privilege';
  end if;

  select review_case.*
    into v_case
  from public.collision_weather_alert_cases review_case
  where review_case.id = p_case_id
    and review_case.shop_id = p_shop_id
  for update;

  if not found then
    raise exception 'Weather review case was not found'
      using errcode = 'no_data_found';
  end if;
  if v_case.status <> 'acknowledged' or v_case.outcome <> 'pending' then
    raise exception 'Weather review case is already closed'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select
    evidence.evidence_baseline_source_span_complete,
    evidence.evidence_prior_52_week_repair_orders,
    evidence.evidence_week_1_repair_orders,
    evidence.evidence_week_2_repair_orders,
    evidence.evidence_week_3_repair_orders,
    evidence.evidence_week_4_repair_orders,
    evidence.evidence_follow_up_weeks_complete,
    evidence.evidence_source_latest_arrival_date,
    evidence.evidence_control_baseline_source_span_complete,
    evidence.evidence_control_prior_52_week_repair_orders,
    evidence.evidence_control_week_1_repair_orders,
    evidence.evidence_control_week_2_repair_orders,
    evidence.evidence_control_week_3_repair_orders,
    evidence.evidence_control_week_4_repair_orders,
    evidence.evidence_control_follow_up_weeks_complete
    into
      v_baseline_source_span_complete,
      v_prior_52_week_repair_orders,
      v_week_1_repair_orders,
      v_week_2_repair_orders,
      v_week_3_repair_orders,
      v_week_4_repair_orders,
      v_follow_up_weeks_complete,
      v_source_latest_arrival_date,
      v_control_baseline_source_span_complete,
      v_control_prior_52_week_repair_orders,
      v_control_week_1_repair_orders,
      v_control_week_2_repair_orders,
      v_control_week_3_repair_orders,
      v_control_week_4_repair_orders,
      v_control_follow_up_weeks_complete
  from public.v_collision_weather_alert_case_evidence evidence
  where evidence.id = p_case_id;

  if v_source_latest_arrival_date is null then
    raise exception 'Repair-arrival evidence is unavailable for this shop'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_outcome <> 'not_evaluable'
    and (
      not v_baseline_source_span_complete
      or v_follow_up_weeks_complete < 4
      or v_case.control_match_status <> 'matched'
      or not v_control_baseline_source_span_complete
      or v_control_follow_up_weeks_complete < 4
    )
  then
    raise exception 'Four complete signal weeks, a prior 52-week baseline, and a complete pre-registered matched control are required'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_observed_four_week_repair_orders :=
    v_week_1_repair_orders +
    v_week_2_repair_orders +
    v_week_3_repair_orders +
    v_week_4_repair_orders;
  v_follow_through_threshold_repair_orders := greatest(
    2,
    floor(v_prior_52_week_repair_orders::numeric / 13)::integer + 1
  );
  v_expected_outcome := case
    when v_observed_four_week_repair_orders >= v_follow_through_threshold_repair_orders
      then 'observed_follow_through'
    else 'no_observed_follow_through'
  end;

  if v_case.control_match_status = 'matched' then
    v_control_observed_four_week_repair_orders :=
      v_control_week_1_repair_orders +
      v_control_week_2_repair_orders +
      v_control_week_3_repair_orders +
      v_control_week_4_repair_orders;
    v_control_follow_through_threshold_repair_orders := greatest(
      2,
      floor(v_control_prior_52_week_repair_orders::numeric / 13)::integer + 1
    );
    v_control_expected_outcome := case
      when v_control_observed_four_week_repair_orders >=
        v_control_follow_through_threshold_repair_orders
        then 'observed_follow_through'
      else 'no_observed_follow_through'
    end;
  end if;

  if v_outcome <> 'not_evaluable' and v_outcome <> v_expected_outcome then
    raise exception 'The selected outcome does not match the governed repair-arrival evidence'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.collision_weather_alert_cases
  set
    status = 'closed',
    outcome = v_outcome,
    outcome_notes = v_notes,
    closed_at = pg_catalog.now(),
    closed_by_profile_id = p_actor_profile_id,
    outcome_baseline_source_span_complete = v_baseline_source_span_complete,
    outcome_prior_52_week_repair_orders = v_prior_52_week_repair_orders,
    outcome_week_1_repair_orders = v_week_1_repair_orders,
    outcome_week_2_repair_orders = v_week_2_repair_orders,
    outcome_week_3_repair_orders = v_week_3_repair_orders,
    outcome_week_4_repair_orders = v_week_4_repair_orders,
    outcome_follow_up_weeks_complete = v_follow_up_weeks_complete,
    outcome_source_latest_arrival_date = v_source_latest_arrival_date,
    outcome_control_baseline_source_span_complete = case
      when v_case.control_match_status = 'matched'
        then v_control_baseline_source_span_complete
      else null
    end,
    outcome_control_prior_52_week_repair_orders = case
      when v_case.control_match_status = 'matched'
        then v_control_prior_52_week_repair_orders
      else null
    end,
    outcome_control_week_1_repair_orders = case
      when v_case.control_match_status = 'matched'
        then v_control_week_1_repair_orders
      else null
    end,
    outcome_control_week_2_repair_orders = case
      when v_case.control_match_status = 'matched'
        then v_control_week_2_repair_orders
      else null
    end,
    outcome_control_week_3_repair_orders = case
      when v_case.control_match_status = 'matched'
        then v_control_week_3_repair_orders
      else null
    end,
    outcome_control_week_4_repair_orders = case
      when v_case.control_match_status = 'matched'
        then v_control_week_4_repair_orders
      else null
    end,
    outcome_control_follow_up_weeks_complete = case
      when v_case.control_match_status = 'matched'
        then v_control_follow_up_weeks_complete
      else null
    end,
    outcome_evidence_captured_at = pg_catalog.now()
  where id = p_case_id
  returning * into v_case;

  insert into public.access_audit (
    actor_profile_id,
    target_shop_id,
    action,
    payload_jsonb
  ) values (
    p_actor_profile_id,
    p_shop_id,
    'collision.weather_alert.close',
    pg_catalog.jsonb_build_object(
      'caseId', v_case.id,
      'zipCode', v_case.zip_code,
      'eventType', v_case.event_type,
      'eventDate', v_case.event_date,
      'outcome', v_case.outcome,
      'outcomeNotes', v_case.outcome_notes,
      'baselineSourceSpanComplete', v_case.outcome_baseline_source_span_complete,
      'prior52WeekRepairOrders', v_case.outcome_prior_52_week_repair_orders,
      'week1RepairOrders', v_case.outcome_week_1_repair_orders,
      'week2RepairOrders', v_case.outcome_week_2_repair_orders,
      'week3RepairOrders', v_case.outcome_week_3_repair_orders,
      'week4RepairOrders', v_case.outcome_week_4_repair_orders,
      'observedFourWeekRepairOrders', v_observed_four_week_repair_orders,
      'followThroughThresholdRepairOrders', v_follow_through_threshold_repair_orders,
      'followUpWeeksComplete', v_case.outcome_follow_up_weeks_complete,
      'sourceLatestArrivalDate', v_case.outcome_source_latest_arrival_date,
      'controlMatchStatus', v_case.control_match_status,
      'controlEventDate', v_case.control_event_date,
      'controlBaselineSourceSpanComplete', v_case.outcome_control_baseline_source_span_complete,
      'controlPrior52WeekRepairOrders', v_case.outcome_control_prior_52_week_repair_orders,
      'controlWeek1RepairOrders', v_case.outcome_control_week_1_repair_orders,
      'controlWeek2RepairOrders', v_case.outcome_control_week_2_repair_orders,
      'controlWeek3RepairOrders', v_case.outcome_control_week_3_repair_orders,
      'controlWeek4RepairOrders', v_case.outcome_control_week_4_repair_orders,
      'controlObservedFourWeekRepairOrders', v_control_observed_four_week_repair_orders,
      'controlFollowThroughThresholdRepairOrders', v_control_follow_through_threshold_repair_orders,
      'controlOutcome', v_control_expected_outcome
    )
  );

  return pg_catalog.jsonb_build_object(
    'case_id', v_case.id,
    'status', v_case.status,
    'outcome', v_case.outcome,
    'follow_up_weeks_complete', v_case.outcome_follow_up_weeks_complete,
    'control_match_status', v_case.control_match_status,
    'control_outcome', v_control_expected_outcome
  );
end;
$$;

comment on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid) is
  'Service-only closure of an acknowledged weather review case with audited signal and pre-registered matched-control evidence snapshots. Observed outcomes require mature 52-week baselines and exact 1-4 week windows; notifications remain disabled.';

revoke execute on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid)
  to service_role;
