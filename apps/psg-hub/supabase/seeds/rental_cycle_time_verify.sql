-- Acceptance verification for PSG-96. Run AFTER applying
-- 20260618210000_rental_cycle_time_v1_5 + seeding (survey_attribution_pilot.sql
-- then rental_cycle_time_pilot.sql):
--   psql "$DATABASE_URL" -f supabase/seeds/rental_cycle_time_verify.sql
--
-- (Agents have no DB/console access in-sandbox — this is the operator step. The
--  TS run + cycle-time math are verified in CI by
--  src/lib/ops/reports/__tests__/live-survey.test.ts → rentalCarAnalysisRun.)

-- A) Per-RO source rows: insurer, rental days/cost, and derived cycle time.
--    Expected (3 rows, RO-89001/2/3):
--      RO-89001 | Gecko Mutual Insurance | 10 | 420.00 | cycle 8
--      RO-89002 | Gecko Mutual Insurance | 14 | 602.00 | cycle 12
--      RO-89003 | Gecko Mutual Insurance |  6 | 258.00 | cycle 5
select
  ro.ro_number,
  ic.name as insurer,
  ra.rental_days,
  ra.rental_cost,
  ((ro.dates_json->>'date_out')::date - (ro.dates_json->>'date_in')::date) as cycle_days
from public.rental_assignments ra
join public.repair_orders ro on ro.id = ra.repair_order_id
left join public.insurance_companies ic on ic.id = ro.insurance_company_id
where ra.rental_ref like 'RO-8900%'
order by ro.ro_number;

-- B) Report-shaped aggregate: one row per shop × insurer, per-RO averages.
--    Expected: PSG Pilot Body Shop | Gecko Mutual Insurance |
--              rental_days_avg 10.0 | cycle_days_avg 8.3 | cost_avg 426.67
select
  c.name as shop,
  ic.name as insurer,
  round(avg(ra.rental_days)::numeric, 1) as rental_days_avg,
  round(
    avg((ro.dates_json->>'date_out')::date - (ro.dates_json->>'date_in')::date)::numeric,
    1
  ) as cycle_days_avg,
  round(avg(ra.rental_cost)::numeric, 2) as cost_avg
from public.rental_assignments ra
join public.repair_orders ro on ro.id = ra.repair_order_id
join public.companies c on c.id = ro.company_id
left join public.insurance_companies ic on ic.id = ro.insurance_company_id
where ra.rental_ref like 'RO-8900%'
group by c.name, ic.name
order by c.name, ic.name;
