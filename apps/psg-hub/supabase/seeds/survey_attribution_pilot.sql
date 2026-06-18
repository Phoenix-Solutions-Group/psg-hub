-- Pilot seed: survey attribution + response-rate/recommend. [PSG-89]
-- Proves the 20260618200000_survey_attribution_v1_4 data model end-to-end:
-- a survey row resolves to its RO# and its attributed estimator / body tech /
-- painter, and the surveys_sent denominator + would_recommend are populated.
--
-- NOT auto-run. config.toml [db.seed] points only at ./seed.sql, so this file is
-- applied INTENTIONALLY (local: `psql "$DATABASE_URL" -f supabase/seeds/survey_attribution_pilot.sql`;
-- prod pilot: operator-gated, same protocol as the ops migrations). It is fully
-- idempotent — fixed UUIDs + ON CONFLICT — so re-applying backfills, never dupes.
--
-- Shop: "PSG Pilot Body Shop". 3 repair orders, each attributed to the same
-- estimator/tech/painter; RO-89002 carries a body-tech comeback, RO-89003 a
-- painter redo. 3 of 6 dispatched surveys came back (→ 50% response rate);
-- 2 of 3 responders would recommend.

begin;

-- 1. Company (shop).
insert into public.companies (id, name, status)
values ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', 'active')
on conflict (id) do nothing;

-- 2. Vehicle (master data).
insert into public.vehicles (id, make, model)
values ('00000000-0000-4000-8000-000000089ee1', 'Honda', 'Accord')
on conflict (id) do nothing;

-- 3. Employees (estimator / body tech / painter).
insert into public.employees (id, company_id, name, role) values
  ('00000000-0000-4000-8000-000000089e51', '00000000-0000-4000-8000-000000089000', 'Erin Estimadora', 'estimator'),
  ('00000000-0000-4000-8000-000000089b71', '00000000-0000-4000-8000-000000089000', 'Tomas Bodyworth', 'body_tech'),
  ('00000000-0000-4000-8000-000000089a17', '00000000-0000-4000-8000-000000089000', 'Paula Painter',   'painter')
on conflict (id) do nothing;

-- 4. Repair customer.
insert into public.repair_customers (id, company_id, first_name, last_name)
values ('00000000-0000-4000-8000-000000089c11', '00000000-0000-4000-8000-000000089000', 'Dana', 'Driver')
on conflict (id) do nothing;

-- 5. Repair orders.
insert into public.repair_orders (id, repair_customer_id, company_id, ro_number, vehicle_id, status) values
  ('00000000-0000-4000-8000-000000089001', '00000000-0000-4000-8000-000000089c11', '00000000-0000-4000-8000-000000089000', 'RO-89001', '00000000-0000-4000-8000-000000089ee1', 'closed'),
  ('00000000-0000-4000-8000-000000089002', '00000000-0000-4000-8000-000000089c11', '00000000-0000-4000-8000-000000089000', 'RO-89002', '00000000-0000-4000-8000-000000089ee1', 'closed'),
  ('00000000-0000-4000-8000-000000089003', '00000000-0000-4000-8000-000000089c11', '00000000-0000-4000-8000-000000089000', 'RO-89003', '00000000-0000-4000-8000-000000089ee1', 'closed')
on conflict (id) do nothing;

-- 6. RO ↔ employee attribution. RO-89002 has a body-tech comeback (rework);
--    RO-89003 has a painter redo (rework).
insert into public.repair_order_employees (repair_order_id, employee_id, role, rework) values
  ('00000000-0000-4000-8000-000000089001', '00000000-0000-4000-8000-000000089e51', 'estimator', false),
  ('00000000-0000-4000-8000-000000089001', '00000000-0000-4000-8000-000000089b71', 'body_tech', false),
  ('00000000-0000-4000-8000-000000089001', '00000000-0000-4000-8000-000000089a17', 'painter',   false),
  ('00000000-0000-4000-8000-000000089002', '00000000-0000-4000-8000-000000089e51', 'estimator', false),
  ('00000000-0000-4000-8000-000000089002', '00000000-0000-4000-8000-000000089b71', 'body_tech', true),
  ('00000000-0000-4000-8000-000000089002', '00000000-0000-4000-8000-000000089a17', 'painter',   false),
  ('00000000-0000-4000-8000-000000089003', '00000000-0000-4000-8000-000000089e51', 'estimator', false),
  ('00000000-0000-4000-8000-000000089003', '00000000-0000-4000-8000-000000089b71', 'body_tech', false),
  ('00000000-0000-4000-8000-000000089003', '00000000-0000-4000-8000-000000089a17', 'painter',   true)
on conflict (repair_order_id, role, employee_id) do update set rework = excluded.rework;

-- 7. Survey responses — resolved to their RO + recommend captured.
--    scale_emi_pct is the 0..1 fraction (display ×100): 97%, 86%, 92%.
insert into public.survey_responses
  (id, shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04,
   source, response_id, repair_order_id, ro_number, would_recommend) values
  (89000001, 'PSG Pilot Body Shop', '2026-05-04', 0.970000, 9.7, 9.6, 9.8, 9.9, 'pilot_seed', 'RESP-89001', '00000000-0000-4000-8000-000000089001', 'RO-89001', true),
  (89000002, 'PSG Pilot Body Shop', '2026-05-12', 0.860000, 8.5, 8.7, 8.4, 8.8, 'pilot_seed', 'RESP-89002', '00000000-0000-4000-8000-000000089002', 'RO-89002', false),
  (89000003, 'PSG Pilot Body Shop', '2026-05-20', 0.920000, 9.1, 9.3, 9.0, 9.2, 'pilot_seed', 'RESP-89003', '00000000-0000-4000-8000-000000089003', 'RO-89003', true)
on conflict (id) do update set
  repair_order_id = excluded.repair_order_id,
  ro_number       = excluded.ro_number,
  would_recommend = excluded.would_recommend;

-- 8. Survey dispatches (surveys_sent). 6 sent, 3 responded → 50% response rate.
--    dispatch_ref = '<shop>:<ro>:<sent_date>' (deterministic import idempotency).
insert into public.survey_dispatches
  (company_id, shop_name, repair_order_id, ro_number, sent_date, channel, response_id, dispatch_ref) values
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', '00000000-0000-4000-8000-000000089001', 'RO-89001', '2026-05-01', 'email', 'RESP-89001', 'PSG Pilot Body Shop:RO-89001:2026-05-01'),
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', '00000000-0000-4000-8000-000000089002', 'RO-89002', '2026-05-08', 'email', 'RESP-89002', 'PSG Pilot Body Shop:RO-89002:2026-05-08'),
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', '00000000-0000-4000-8000-000000089003', 'RO-89003', '2026-05-15', 'email', 'RESP-89003', 'PSG Pilot Body Shop:RO-89003:2026-05-15'),
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', null, 'RO-89004', '2026-05-18', 'email', null, 'PSG Pilot Body Shop:RO-89004:2026-05-18'),
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', null, 'RO-89005', '2026-05-22', 'email', null, 'PSG Pilot Body Shop:RO-89005:2026-05-22'),
  ('00000000-0000-4000-8000-000000089000', 'PSG Pilot Body Shop', null, 'RO-89006', '2026-05-25', 'sms',   null, 'PSG Pilot Body Shop:RO-89006:2026-05-25')
on conflict (dispatch_ref) do nothing;

commit;
