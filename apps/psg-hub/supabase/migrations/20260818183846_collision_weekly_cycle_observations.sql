-- Preserve the cycle-time denominator so dashboard averages remain correct when
-- open repair orders do not yet have a completion date.
-- Rollback: recreate the prior view without cycle_time_observations.

create or replace view public.v_collision_weekly_demand
with (security_invoker = true)
as
select
  company_id,
  shop_id,
  company_name,
  date_trunc('week', arrival_date)::date as week_start,
  count(*)::integer as repair_orders,
  count(*) filter (where is_insured is true)::integer as insured_repair_orders,
  count(*) filter (where is_insured is false)::integer as non_insured_repair_orders,
  count(*) filter (where is_insured is null)::integer as unknown_payment_repair_orders,
  sum(repair_amount_cents)::bigint as repair_value_cents,
  round(avg(repair_amount_cents)::numeric / 100, 2) as average_repair_amount,
  round(avg(cycle_days)::numeric, 2) as average_cycle_days,
  count(cycle_days)::integer as cycle_time_observations
from public.v_collision_repair_orders
where arrival_date is not null
group by company_id, shop_id, company_name, date_trunc('week', arrival_date)::date;
