# Runbook — repair_orders canonical invoiced-$ + pay-type (PSG-352)

This change lands the canonical `repair_orders.repair_amount_cents` (integer cents)
and `repair_orders.pay_type` columns + a backfill, and writes them from the
importers. It is the data-model prerequisite for wiring the three dollar-aggregation
Volume reports (processing-recap / invoicing-recap / recap-trailing) — that wiring
is **PSG-46**, NOT this change.

## What merged

- Migration `supabase/migrations/20260624160000_repair_orders_amount_paytype.sql`
  - `add column if not exists repair_amount_cents integer` (NULL = not-sourced; never 0)
  - `add column if not exists pay_type text` + guarded
    `check (pay_type is null or pay_type in ('insurance','customer','internal','warranty'))`
  - **No new RLS policy** — the existing row-level `repair_orders_ops_all`
    (`manage_companies`) policy from `20260618170000_ops_foundation_v1_1.sql`
    covers the new columns automatically; service-role continues to bypass for
    ingestion + reports. Default-deny preserved. (See the comment block at the
    top of the migration.)
  - Idempotent, type-guarded backfill: `repair_amount_cents` from
    `payload_jsonb->>'bms.totals.grandTotal'` (numeric-regex guarded), `pay_type`
    from `payload_jsonb->'advantage2'->>'payType'` via an exact-match CASE that
    mirrors `normalizePayType` one-for-one. Both only set where currently NULL.
- Importer population (`src/lib/ops/import/index.ts` `toCommitRecord` +
  `src/app/api/ops/import/commit/route.ts` RO insert):
  - **CCC/BMS**: `repair_amount_cents = dollarsToCents(grandTotal)`; `pay_type` left
    NULL (CCC carries no pay type — no inference).
  - **Generic RO**: optional `repair_amount` / `pay_type` fields (with
    Advantage2.0 / RC_* header aliases) → `dollarsToCents` / `normalizePayType`;
    the raw pay-type token is also retained under
    `payload_jsonb.advantage2.payType` for the PSG-46 `audit` report path.
- Shared helpers `src/lib/ops/import/amounts.ts` (`dollarsToCents`,
  `normalizePayType`) — unit-tested; the single source of truth the SQL backfill
  mirrors.

## Prod apply (operator gate — same as PSG-305)

Agents cannot apply shared-prod DDL. After merge, an operator must:

1. **Apply the migration** to prod (Supabase project `gylkkzmcmbdftxieyabw`):
   `supabase db push` (or apply
   `20260624160000_repair_orders_amount_paytype.sql` via the migration runner).
   The migration is additive + idempotent and safe to re-run.
2. **Backfill existing rows**: the backfill UPDATEs run as part of the migration,
   so applying it backfills any existing repair_orders in place. No separate step
   unless rows were imported between DDL and backfill — re-running the migration
   (idempotent) re-backfills only still-NULL rows.
3. **Re-import / future imports**: new imports through
   `POST /api/ops/import/commit` (kind `ro`) populate the columns at insert time.
   No re-import is required for the report wiring; the backfill covers history.

## Verify (post-apply)

```sql
-- columns + check exist
\d+ public.repair_orders
-- canonical column is populated where the source had a figure (null otherwise)
select count(*) filter (where repair_amount_cents is not null) as amt_set,
       count(*) filter (where pay_type is not null)            as pay_set,
       count(*)                                                as total
from public.repair_orders;
```

Expect `amt_set` / `pay_set` ≤ `total` (NULLs where the source genuinely lacked
the figure — honest, never a fabricated $0 or bogus bucket).
