-- PSG-352 — Canonical repair_orders invoiced-$ + pay-type data model.
--
-- repair_orders has had NO canonical invoiced-amount or pay-type column: the
-- figures lived sparsely + disjointly in payload_jsonb (CCC/BMS wrote
-- "bms.totals.grandTotal"; Advantage2.0 wrote advantage2.payType — they never
-- co-occur), so the three dollar-aggregation Volume reports (processing-recap,
-- invoicing-recap, recap-trailing) could not be wired without fabricating a $0
-- for the majority of real ROs. This adds the canonical columns. Wiring the
-- reports themselves is PSG-46, NOT this migration.
--
-- Additive + idempotent (add column if not exists; constraint + backfill guarded
-- and only-where-null) so it is safe to re-run.
--
-- HONEST SOURCING (held on PSG-48): a missing/unparseable amount stays NULL,
-- never 0. An unrecognized pay-type stays NULL, never a bogus bucket.
--
-- RLS — NO NEW POLICY. public.repair_orders is already gated by the row-level
-- policy `repair_orders_ops_all`
--   (for all to authenticated
--    using/with check (private.current_user_has_fn('manage_companies')))
-- created in 20260618170000_ops_foundation_v1_1.sql (the manage_companies
-- table loop). New columns inherit that policy automatically — default-deny is
-- preserved and the service role continues to bypass RLS for ingestion +
-- reports. No INSERT/UPDATE/SELECT column-level policy is added or needed.

-- 1. Columns ---------------------------------------------------------------
alter table public.repair_orders
  add column if not exists repair_amount_cents integer;

comment on column public.repair_orders.repair_amount_cents is
  'PSG-352 canonical invoiced amount in integer cents (avoids float drift). '
  'NULL = unknown/not-sourced; never coerced to 0.';

alter table public.repair_orders
  add column if not exists pay_type text;

comment on column public.repair_orders.pay_type is
  'PSG-352 canonical pay type bucket. NULL = unknown/unrecognized.';

-- CHECK guarded so the migration is idempotent (no ADD CONSTRAINT IF NOT EXISTS
-- in Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'repair_orders_pay_type_check'
      and conrelid = 'public.repair_orders'::regclass
  ) then
    alter table public.repair_orders
      add constraint repair_orders_pay_type_check
      check (pay_type is null or pay_type in ('insurance', 'customer', 'internal', 'warranty'));
  end if;
end $$;

-- 2. Backfill — invoiced amount from the CCC/BMS grand total ----------------
-- Only where currently NULL (idempotent). The regex guards `::numeric` against
-- dirty/non-numeric payload values so the migration can never throw on bad data
-- (a non-match is simply skipped → stays NULL, honest).
update public.repair_orders
set repair_amount_cents = round((payload_jsonb->>'bms.totals.grandTotal')::numeric * 100)::integer
where repair_amount_cents is null
  and payload_jsonb ? 'bms.totals.grandTotal'
  and (payload_jsonb->>'bms.totals.grandTotal') ~ '^-?[0-9]+(\.[0-9]+)?$';

-- 3. Backfill — pay type from the Advantage2.0 overflow ---------------------
-- Mirrors the TS PAY_TYPE_ALIASES map (src/lib/ops/import/amounts.ts) ONE-FOR-ONE
-- as an EXACT match on lower(btrim(...)) — NOT a substring/ILIKE match — so a
-- value populated at insert time (normalizePayType) and a value backfilled here
-- are derived by identical rules. Any alias added there must be added here too.
-- Unknown/absent → NULL (honest — a blank over a wrong bucket). Only where
-- currently NULL (idempotent).
update public.repair_orders ro
set pay_type = norm.bucket
from (
  select
    id,
    case lower(btrim(payload_jsonb->'advantage2'->>'payType'))
      -- insurance — carrier / third-party-paid
      when 'insurance' then 'insurance'
      when 'ins' then 'insurance'
      when 'claim' then 'insurance'
      when '3rd party' then 'insurance'
      when 'third party' then 'insurance'
      -- customer — self-pay / retail
      when 'customer' then 'customer'
      when 'cust' then 'customer'
      when 'customer pay' then 'customer'
      when 'cp' then 'customer'
      when 'self' then 'customer'
      when 'retail' then 'customer'
      -- internal — comeback / rework (no external payer)
      when 'internal' then 'internal'
      when 'comeback' then 'internal'
      when 'rework' then 'internal'
      -- warranty — manufacturer / factory
      when 'warranty' then 'warranty'
      when 'mfg warranty' then 'warranty'
      when 'factory' then 'warranty'
      else null
    end as bucket
  from public.repair_orders
) norm
where ro.id = norm.id
  and ro.pay_type is null
  and norm.bucket is not null;
