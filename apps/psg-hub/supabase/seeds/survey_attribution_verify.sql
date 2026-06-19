-- Acceptance verification for PSG-89. Run AFTER applying
-- 20260618200000_survey_attribution_v1_4 + seeding survey_attribution_pilot.sql:
--   psql "$DATABASE_URL" -f supabase/seeds/survey_attribution_verify.sql
--
-- (Agents have no DB/console access in-sandbox — this is the operator step. The
--  TS model + helper math are verified in CI by
--  src/lib/ops/reports/__tests__/survey-attribution.test.ts.)

-- A) A survey row resolves to its RO# + attributed estimator / body tech / painter.
--    Expected: 3 rows (RESP-89001/2/3), each with ro_number set and all three
--    attributed names populated; would_recommend t / f / t.
select
  sr.response_id,
  sr.ro_number,
  round((sr.scale_emi_pct * 100)::numeric, 1) as csi,
  sr.would_recommend,
  est.name  as estimator,
  tech.name as body_tech,
  pnt.name  as painter
from public.survey_responses sr
join public.repair_orders ro on ro.id = sr.repair_order_id
left join public.repair_order_employees roe_e
  on roe_e.repair_order_id = ro.id and roe_e.role = 'estimator'
left join public.employees est on est.id = roe_e.employee_id
left join public.repair_order_employees roe_t
  on roe_t.repair_order_id = ro.id and roe_t.role = 'body_tech'
left join public.employees tech on tech.id = roe_t.employee_id
left join public.repair_order_employees roe_p
  on roe_p.repair_order_id = ro.id and roe_p.role = 'painter'
left join public.employees pnt on pnt.id = roe_p.employee_id
where sr.source = 'pilot_seed'
order by sr.ro_number;

-- B) Response rate (performance-dashboard) = returned / sent, per shop.
--    Expected: PSG Pilot Body Shop → sent 6, returned 3, response_rate_pct 50.0.
select
  d.shop_name,
  count(*)                                   as sent,
  count(r.id)                                as returned,
  round(100.0 * count(r.id) / count(*), 1)   as response_rate_pct
from public.survey_dispatches d
left join public.survey_responses r on r.response_id = d.response_id
where d.shop_name = 'PSG Pilot Body Shop'
group by d.shop_name;

-- C) Would-recommend rate, per shop. Expected: 2/3 → 66.7.
select
  shop_name,
  round(100.0 * count(*) filter (where would_recommend) / count(*), 1) as recommend_pct
from public.survey_responses
where source = 'pilot_seed'
group by shop_name;

-- D) Body-tech comeback / painter redo rates (rework over jobs), per employee.
--    Expected: Tomas Bodyworth jobs 3 comebacks 1 (33.3%); Paula Painter jobs 3 redos 1 (33.3%).
select
  e.name,
  roe.role,
  count(*)                                            as jobs,
  count(*) filter (where roe.rework)                  as rework,
  round(100.0 * count(*) filter (where roe.rework) / count(*), 1) as rework_pct
from public.repair_order_employees roe
join public.employees e on e.id = roe.employee_id
where roe.role in ('body_tech', 'painter')
group by e.name, roe.role
order by roe.role;
