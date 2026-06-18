-- Pilot seed: rental + cycle-time for rental-car-analysis. [PSG-96]
-- Proves the 20260618210000_rental_cycle_time_v1_5 data model end-to-end: each
-- pilot RO gets an insurer, in/out dates (→ cycle time), and a rental assignment
-- (days + cost), so the report's shop / insurer / rentalDays / cycleTime / cost
-- columns all resolve to live data.
--
-- DEPENDS ON survey_attribution_pilot.sql — it reuses that file's shop
-- ("PSG Pilot Body Shop", id …089000) and repair orders (RO-89001/2/3,
-- ids …089001/2/3). Apply that seed first:
--   psql "$DATABASE_URL" -f supabase/seeds/survey_attribution_pilot.sql
--   psql "$DATABASE_URL" -f supabase/seeds/rental_cycle_time_pilot.sql
--
-- NOT auto-run (config.toml [db.seed] points only at ./seed.sql). Fully
-- idempotent — fixed UUIDs + ON CONFLICT + deterministic rental_ref — so
-- re-applying backfills, never dupes.
--
-- Expected rental-car-analysis row (one shop × one insurer, per-RO averages):
--   RO-89001: rental 10d / $420.00, in 2026-04-20 → out 2026-04-28  → cycle 8d
--   RO-89002: rental 14d / $602.00, in 2026-04-22 → out 2026-05-04  → cycle 12d
--   RO-89003: rental  6d / $258.00, in 2026-05-01 → out 2026-05-06  → cycle 5d
--   → rentalDays avg = 10.0, cycleTime avg = 8.3, cost avg = $426.67

begin;

-- 1. Insurer (spine master data; report's `insurer` column).
insert into public.insurance_companies (id, name)
values ('00000000-0000-4000-8000-0000000960c1', 'Gecko Mutual Insurance')
on conflict (id) do nothing;

-- 2. Attach the insurer + in/out dates to the pilot ROs. dates_json keys
--    date_in / date_out drive cycleTime (= date_out - date_in).
update public.repair_orders
  set insurance_company_id = '00000000-0000-4000-8000-0000000960c1',
      dates_json = '{"date_in":"2026-04-20","date_out":"2026-04-28"}'::jsonb
  where id = '00000000-0000-4000-8000-000000089001';
update public.repair_orders
  set insurance_company_id = '00000000-0000-4000-8000-0000000960c1',
      dates_json = '{"date_in":"2026-04-22","date_out":"2026-05-04"}'::jsonb
  where id = '00000000-0000-4000-8000-000000089002';
update public.repair_orders
  set insurance_company_id = '00000000-0000-4000-8000-0000000960c1',
      dates_json = '{"date_in":"2026-05-01","date_out":"2026-05-06"}'::jsonb
  where id = '00000000-0000-4000-8000-000000089003';

-- 3. Rental assignments (rentalDays + cost). rental_ref = '<ro>:<start_date>'.
insert into public.rental_assignments
  (id, repair_order_id, company_id, rental_provider, rental_days, rental_cost, start_date, end_date, rental_ref) values
  ('00000000-0000-4000-8000-000000096a01', '00000000-0000-4000-8000-000000089001', '00000000-0000-4000-8000-000000089000', 'Hertz', 10, 420.00, '2026-04-20', '2026-04-30', 'RO-89001:2026-04-20'),
  ('00000000-0000-4000-8000-000000096a02', '00000000-0000-4000-8000-000000089002', '00000000-0000-4000-8000-000000089000', 'Enterprise', 14, 602.00, '2026-04-22', '2026-05-06', 'RO-89002:2026-04-22'),
  ('00000000-0000-4000-8000-000000096a03', '00000000-0000-4000-8000-000000089003', '00000000-0000-4000-8000-000000089000', 'Enterprise', 6, 258.00, '2026-05-01', '2026-05-07', 'RO-89003:2026-05-01')
on conflict (rental_ref) do update set
  rental_days = excluded.rental_days,
  rental_cost = excluded.rental_cost,
  end_date    = excluded.end_date;

commit;
