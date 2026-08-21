-- Review-only severe-weather signals in repair-customer ZIPs.
-- Rollback: drop view public.v_collision_zip_alert_candidates.

create or replace view public.v_collision_zip_alert_candidates
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
  where customer_zip ~ '^[0-9]{5}$'
  group by company_id, shop_id, company_name, customer_zip
), recent_events as (
  select
    e.source_event_id,
    e.event_type_normalized,
    e.begin_time,
    e.magnitude,
    e.magnitude_type,
    z.zip_code,
    row_number() over (
      partition by e.source_event_id
      order by z.zip_code
    ) as boundary_rank
  from public.storm_events e
  join public.zipcode_boundaries z
    on e.begin_location is not null
   and public.st_covers(z.boundary, e.begin_location::geometry)
  where e.source = 'noaa_spc_preliminary_reports'
    and e.begin_time >= now() - interval '72 hours'
    and e.begin_time <= now() + interval '15 minutes'
)
select
  p.company_id,
  p.shop_id,
  p.company_name,
  p.customer_zip as zip_code,
  p.historical_repair_orders,
  e.source_event_id,
  e.event_type_normalized as event_type,
  e.begin_time as event_at,
  e.magnitude,
  e.magnitude_type as magnitude_unit,
  case
    when e.event_type_normalized = 'tornado' then 'high'
    when e.event_type_normalized = 'hail' and e.magnitude >= 1 then 'high'
    when e.event_type_normalized = 'thunderstorm wind' and e.magnitude >= 58 then 'high'
    else 'review'
  end as alert_level,
  case
    when e.event_type_normalized = 'tornado' then 'Tornado report'
    when e.event_type_normalized = 'hail' and e.magnitude >= 1 then 'Hail >= 1 inch'
    when e.event_type_normalized = 'thunderstorm wind' and e.magnitude >= 58 then 'Wind >= 58 mph'
    else 'Preliminary report below or without measured NWS severe threshold'
  end as threshold_basis,
  true as is_provisional
from portfolio p
join recent_events e
  on e.zip_code = p.customer_zip
 and e.boundary_rank = 1;

comment on view public.v_collision_zip_alert_candidates is
  'Review-only NOAA SPC preliminary tornado, hail, and wind reports in repair-customer ZIPs from the last 72 hours. High uses NWS severe thresholds; no notifications are sent.';

revoke all on public.v_collision_zip_alert_candidates from anon, authenticated;
grant select on public.v_collision_zip_alert_candidates to service_role;
