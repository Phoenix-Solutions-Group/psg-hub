-- Demo-only seed: Riverside operational-report rows. [PSG-2984]
--
-- NOT auto-run. Apply intentionally after the approved Riverside demo account
-- exists:
--   psql "$DATABASE_URL" -f supabase/seeds/riverside_operational_reports.sql
--
-- The seed refuses to create or guess a company/customer. It only attaches to
-- the existing .example Riverside demo shop and its .invalid repair customer.
-- Re-applying is safe: the canonical (company_id, ro_number) key updates these
-- five rows instead of creating duplicates.

begin;

do $$
declare
  riverside_company_id uuid;
  riverside_customer_id uuid;
begin
  select c.id
    into strict riverside_company_id
    from public.companies c
    join public.shops s on s.id = c.shop_id
   where s.name = 'Riverside Collision'
     and s.url like '%.example';

  select rc.id
    into strict riverside_customer_id
    from public.repair_customers rc
   where rc.company_id = riverside_company_id
     and rc.first_name = 'Maria'
     and rc.last_name = 'Alvarez'
     and rc.email = 'maria.alvarez@example.invalid';

  insert into public.repair_orders (
    repair_customer_id,
    company_id,
    ro_number,
    status,
    repair_amount_cents,
    pay_type,
    dates_json,
    payload_jsonb,
    created_at,
    updated_at
  ) values
    (riverside_customer_id, riverside_company_id, 'DEMO-RIV-2026-07-01', 'closed', 725000, 'insurance', '{"date_in":"2026-07-03","date_out":"2026-07-10"}'::jsonb, '{"demoSeed":"psg-2975-operational-reports"}'::jsonb, '2026-07-03T14:00:00.000Z', '2026-07-03T14:00:00.000Z'),
    (riverside_customer_id, riverside_company_id, 'DEMO-RIV-2026-07-02', 'closed', 480000, 'customer',  '{"date_in":"2026-07-14","date_out":"2026-07-18"}'::jsonb, '{"demoSeed":"psg-2975-operational-reports"}'::jsonb, '2026-07-14T14:00:00.000Z', '2026-07-14T14:00:00.000Z'),
    (riverside_customer_id, riverside_company_id, 'DEMO-RIV-2026-07-03', 'open',   645000, 'insurance', '{"date_in":"2026-07-27"}'::jsonb,                         '{"demoSeed":"psg-2975-operational-reports"}'::jsonb, '2026-07-27T14:00:00.000Z', '2026-07-27T14:00:00.000Z'),
    (riverside_customer_id, riverside_company_id, 'DEMO-RIV-2026-08-01', 'closed', 910000, 'insurance', '{"date_in":"2026-08-04","date_out":"2026-08-12"}'::jsonb, '{"demoSeed":"psg-2975-operational-reports"}'::jsonb, '2026-08-04T14:00:00.000Z', '2026-08-04T14:00:00.000Z'),
    (riverside_customer_id, riverside_company_id, 'DEMO-RIV-2026-08-02', 'open',   565000, 'warranty',  '{"date_in":"2026-08-21"}'::jsonb,                         '{"demoSeed":"psg-2975-operational-reports"}'::jsonb, '2026-08-21T14:00:00.000Z', '2026-08-21T14:00:00.000Z')
  on conflict (company_id, ro_number) do update set
    repair_customer_id  = excluded.repair_customer_id,
    status              = excluded.status,
    repair_amount_cents = excluded.repair_amount_cents,
    pay_type            = excluded.pay_type,
    dates_json          = excluded.dates_json,
    payload_jsonb       = excluded.payload_jsonb,
    created_at          = excluded.created_at,
    updated_at          = excluded.updated_at;
exception
  when no_data_found then
    raise exception 'Approved Riverside demo company/customer was not found; no rows were written';
  when too_many_rows then
    raise exception 'Riverside demo company/customer is ambiguous; no rows were written';
end $$;

commit;
