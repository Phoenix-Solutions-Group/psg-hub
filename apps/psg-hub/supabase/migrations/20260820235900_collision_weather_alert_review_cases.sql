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
  outcome_evidence_captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collision_weather_alert_cases_key unique (
    shop_id,
    zip_code,
    event_type,
    event_date
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
  'Service-only owned review cases for severe-threshold SPC signals. Cases capture acknowledgement and later demand follow-through; notifications remain disabled.';

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
    )::integer as week_4_repair_orders
  from public.collision_weather_alert_cases review_case
  left join public.v_collision_repair_orders repair
    on repair.shop_id = review_case.shop_id
   and repair.customer_zip = review_case.zip_code
   and repair.arrival_date >= review_case.event_date - 364
   and repair.arrival_date <= review_case.event_date + 28
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
    case_windows.week_4_repair_orders
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
      then review_case.outcome_follow_up_weeks_complete = 4
        and review_case.outcome_baseline_source_span_complete
    else live_evidence.follow_up_weeks_complete = 4
      and live_evidence.baseline_source_span_complete
  end as evidence_mature_for_close
from public.collision_weather_alert_cases review_case
join live_evidence on live_evidence.id = review_case.id;

comment on view public.v_collision_weather_alert_case_evidence is
  'Service-only exact 1-4 week shop/ZIP repair arrivals after an acknowledged severe-weather signal. Same-day arrivals are excluded; the baseline is the prior 364 calendar days. Closed cases show the evidence snapshot captured with the outcome.';

revoke all on public.v_collision_weather_alert_case_evidence from anon, authenticated;
grant select on public.v_collision_weather_alert_case_evidence to service_role;

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
        'reportCount', v_case.report_count
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'case_id', v_case.id,
    'status', v_case.status,
    'owner_profile_id', v_case.owner_profile_id,
    'created', v_inserted
  );
end;
$$;

comment on function public.acknowledge_collision_weather_alert(uuid, text, text, date, uuid) is
  'Service-only, idempotent acknowledgement of a current severe-threshold signal by a shop owner or manager.';

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
  v_observed_four_week_repair_orders integer;
  v_follow_through_threshold_repair_orders integer;
  v_expected_outcome text;
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
    evidence.evidence_source_latest_arrival_date
    into
      v_baseline_source_span_complete,
      v_prior_52_week_repair_orders,
      v_week_1_repair_orders,
      v_week_2_repair_orders,
      v_week_3_repair_orders,
      v_week_4_repair_orders,
      v_follow_up_weeks_complete,
      v_source_latest_arrival_date
  from public.v_collision_weather_alert_case_evidence evidence
  where evidence.id = p_case_id;

  if v_source_latest_arrival_date is null then
    raise exception 'Repair-arrival evidence is unavailable for this shop'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_outcome <> 'not_evaluable'
    and (not v_baseline_source_span_complete or v_follow_up_weeks_complete < 4)
  then
    raise exception 'Four complete follow-up weeks and repair history spanning the prior 52 weeks are required'
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
      'sourceLatestArrivalDate', v_case.outcome_source_latest_arrival_date
    )
  );

  return pg_catalog.jsonb_build_object(
    'case_id', v_case.id,
    'status', v_case.status,
    'outcome', v_case.outcome,
    'follow_up_weeks_complete', v_case.outcome_follow_up_weeks_complete
  );
end;
$$;

comment on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid) is
  'Service-only closure of an acknowledged weather review case with an audited 52-week baseline and exact 1-4 week repair-arrival evidence snapshot. Observed outcomes require a mature window; notifications remain disabled.';

revoke execute on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.close_collision_weather_alert_case(uuid, uuid, text, text, uuid)
  to service_role;
