---
title: "FileMaker Advantage Integration: Schema Migration Spec"
status: draft
version: "1.0"
---

# Schema Migration Spec

This spec defines the concrete, forward-only Postgres DDL that implements the
**Data Storage Changes** in the SDD (`../solution-design.md`, section
"Interface Specifications → Data Storage Changes") and the five Architecture
Decisions (ADR-1 through ADR-5, see `../adr/`).

The deltas re-platform FileMaker Advantage behavior onto the **already-planned**
psg-hub schema (`projects/psg-hub/PLANNING.md`, Data Model). Most target tables
already exist. This spec adds only the behavioral columns the DDR analysis
proved are required, the survey↔customer foreign key (ADR-2), the explicit
suppression flag (ADR-4), and one new table (`letter_eligibility`).

## Scope

- New enum `alert_class`: the survey alert classifications.
- New enum `letter_kind`: the letter eligibility cycle buckets.
- `ALTER TABLE survey_responses`: alert columns, the real FK, idempotency stamps.
- `ALTER TABLE repair_customers`: legacy reconciliation key + referral/credit gates.
- `ALTER TABLE company_programs`: per-shop referral tracking gate.
- `CREATE TABLE letter_eligibility`: eligibility + suppression + print idempotency.
- RLS notes per table.
- Migration file naming convention + forward-only policy.

### Reused as-is (no DDL here)

`production_batches`, `production_documents`, `production_reprint_log`,
`mail_vendor_jobs`, `email_jobs`, `sms_jobs`, `import_templates`, and
`security_profiles` are already defined in `PLANNING.md` (Data Model →
Production module, Ops backbone, Security profiles). They are reused as-is. This
spec does not redefine them.

## Conventions inherited from psg-hub

These are not invented here. They come from the shipped migrations
(`apps/psg-hub/supabase/migrations/`) and `PLANNING.md`:

- **`profile_id` everywhere** (never `user_id`) for actor references; foreign-keyed
  to `public.profiles(id)`.
- **Shop clamp**: customer/PII rows are clamped to authorized shops with
  `shop_id IN (select public.user_shop_ids())`.
- **Ops capability gate**: ops tables are gated by
  `private.current_user_has_fn('<function>')`, which returns true for
  `psg_superadmin`, or for `psg_internal` when
  `security_profiles.functions_jsonb` carries the function key. This is the
  `security_profiles.functions_jsonb` gate the SDD requires.
- **Default-deny**: every new table is `enable row level security` with no
  blanket `anon`/`authenticated` policy. Service-role (cron + Python worker)
  bypasses RLS; interactive access goes through the named policies below.
- **Idempotent DDL**: `create ... if not exists`, `add column if not exists`,
  `do $$ ... $$` enum guards, so a re-run is a no-op (forward-only, run-once safe).

---

## Migration files

Forward-only, timestamped, one concern per file, landing under
`apps/psg-hub/supabase/migrations/`. Naming follows the existing convention
(`YYYYMMDDHHMMSS_snake_case_description.sql`). Proposed files for this spec:

```
apps/psg-hub/supabase/migrations/
  20260609090000_filemaker_enums.sql                 # alert_class, letter_kind
  20260609090100_survey_responses_alerts.sql         # FK + alert columns + stamps + index
  20260609090200_repair_customers_referral.sql       # legacy_match_key + referral/credit gates
  20260609090300_company_programs_referral.sql        # referral_tracking_enabled
  20260609090400_letter_eligibility.sql              # new table + RLS + indexes
```

Apply with `supabase migration up`. Production apply goes through the operator
gate (advisor baseline + diff) per the project migration-safety protocol; build
applies local-first.

---

## 1. Enums

`alert_class` encodes the five DDR survey classifications plus `none`.
`letter_kind` encodes the eligibility cycle buckets the Advantage file drove off
RO completion date plus the event letters.

```sql
-- 20260609090000_filemaker_enums.sql
-- Forward-only. Enum creation guarded so a re-run is a no-op.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'alert_class') then
    create type public.alert_class as enum (
      'perfect',     -- SQ_Alert_Perfect_post
      'misfire',     -- satisfied + would-recommend + not perfect (missed referral)
      'hotspot',     -- negative result needing follow-up
      'unresolved',  -- SQ_Unresolved_Shop
      'referral',    -- SQ_Alert_Referral_post
      'none'         -- no alert
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'letter_kind') then
    create type public.letter_kind as enum (
      'three_month',     -- SS - Elgibility - 3Month
      'six_month',
      'one_year',
      'eighteen_month',
      'two_year',
      'birthday',
      'drivers_license',
      'thank_you',
      'referral'
    );
  end if;
end$$;
```

To add an alert class or letter kind later, ship a forward-only
`alter type ... add value if not exists` migration. Do not edit the enum in place.

---

## 2. `survey_responses` (EXTEND)

Adds the real foreign key (ADR-2) that replaces the composite shop-id+month+year
string match key, the alert columns from the DDR classification calcs, and the
idempotency stamps that replace the FileMaker `SQ_Alert_PostDate_*` and
`S_RC_Referral_Letter_Post` date stamps. The FK is nullable until matched; an
unmatched survey is retained and surfaced in the needs-match queue (never dropped).

```sql
-- 20260609090100_survey_responses_alerts.sql
-- Forward-only. survey_responses already exists (PLANNING Data Model, v0.3).

alter table public.survey_responses
  add column if not exists repair_customer_id uuid
    references public.repair_customers(id) on delete set null,  -- ADR-2: real FK, nullable until matched
  add column if not exists alert_class public.alert_class not null default 'none',
  add column if not exists csi_resolve numeric,            -- SQ_Scale_CSI_Resolve
  add column if not exists would_recommend boolean,        -- SQ_Would_Recom_Facility
  add column if not exists unresolved_shop boolean,        -- SQ_Unresolved_Shop
  add column if not exists referral_consumer boolean,      -- SQ_Referral_Consumer
  add column if not exists alert_posted_at timestamptz,            -- replaces SQ_Alert_PostDate_* stamps
  add column if not exists referral_letter_posted_at timestamptz; -- replaces S_RC_Referral_Letter_Post

-- Survey→customer match lookup + suppression-window scan (alert_posted_at).
create index if not exists idx_survey_match
  on public.survey_responses (repair_customer_id, submitted_at);
```

**RLS**: `survey_responses` holds end-consumer PII and is shop-scoped.
Clamp to authorized shops; ops mutation gated by `manage_surveys`. Service-role
(survey-ingest cron) bypasses RLS.

```sql
alter table public.survey_responses enable row level security;

drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    or private.current_user_has_fn('manage_surveys')
  );

drop policy if exists survey_responses_write on public.survey_responses;
create policy survey_responses_write on public.survey_responses
  for all to authenticated
  using (private.current_user_has_fn('manage_surveys'))
  with check (private.current_user_has_fn('manage_surveys'));
```

---

## 3. `repair_customers` (EXTEND)

`legacy_match_key` keeps the old `RC_MatchField_Master` string for migration
reconciliation only (ADR-2 fallback during the v1.3.5 load). The referral/credit
gates drive the Referral vs Misfire branch in `classifySurvey` (SDD
Implementation Examples).

```sql
-- 20260609090200_repair_customers_referral.sql
-- Forward-only. repair_customers already exists (PLANNING Data Model, v1.1).

alter table public.repair_customers
  add column if not exists legacy_match_key text,                            -- RC_MatchField_Master (reconciliation only)
  add column if not exists referral_tracking_enabled boolean not null default false, -- Master Client::M_ReferralNoted_flag
  add column if not exists credit_hold boolean not null default false;       -- M_CreditHold_flag (suppresses referral path)

-- Migration fallback match: resolve legacy keys to FKs during v1.3.5 ETL.
create index if not exists idx_repair_customers_legacy_match_key
  on public.repair_customers (legacy_match_key);
```

**RLS**: `repair_customers` is high-sensitivity end-consumer PII. Clamp to
authorized shops; ops mutation gated by `manage_companies`. Follows the existing
`psg_sensitive_pii_*` redaction patterns at the column/view layer.

```sql
alter table public.repair_customers enable row level security;

drop policy if exists repair_customers_select on public.repair_customers;
create policy repair_customers_select on public.repair_customers
  for select to authenticated
  using (
    shop_id in (select public.user_shop_ids())
    or private.current_user_has_fn('manage_companies')
  );

drop policy if exists repair_customers_write on public.repair_customers;
create policy repair_customers_write on public.repair_customers
  for all to authenticated
  using (private.current_user_has_fn('manage_companies'))
  with check (private.current_user_has_fn('manage_companies'));
```

> Note: if `repair_customers` carries `company_id` rather than `shop_id`, swap
> the clamp to the company→shop join your shop-membership helper exposes. The
> gate (`manage_companies`) is unchanged.

---

## 4. `company_programs` (EXTEND)

Per-shop referral tracking gate. Read cross-file in FileMaker; seed it here
before classification runs, or every survey misclassifies (SDD Implementation
Gotchas). `customizations_jsonb` already holds logo/header/footer/greeting and is
not changed here.

```sql
-- 20260609090300_company_programs_referral.sql
-- Forward-only. company_programs already exists (PLANNING Data Model, v1.1).

alter table public.company_programs
  add column if not exists referral_tracking_enabled boolean not null default false; -- drives Referral vs Misfire per shop
```

**RLS**: ops master-data table, gated by `manage_companies`.

```sql
alter table public.company_programs enable row level security;

drop policy if exists company_programs_rw on public.company_programs;
create policy company_programs_rw on public.company_programs
  for all to authenticated
  using (private.current_user_has_fn('manage_companies'))
  with check (private.current_user_has_fn('manage_companies'));
```

---

## 5. `letter_eligibility` (NEW)

The eligibility + suppression + print-idempotency table. Replaces the
`SS - Elgibility - *` date-window finds, makes the suppression rule explicit
(`suppressed_by_alert`, ADR-4), and replaces the `Letter_*_Printed` date stamps
with `printed_at`. The `UNIQUE (repair_customer_id, letter_kind, period_key)`
constraint is the no-double-send guard (ADR-3 idempotency).

`period_key` is the cycle bucket (for example `date_trunc('month', ro_completed_at)`
rendered as text) so re-running eligibility for the same customer + letter + cycle
is a no-op via `on conflict do nothing`/`do update`.

```sql
-- 20260609090400_letter_eligibility.sql
-- Forward-only. New table. Idempotent create.

create table if not exists public.letter_eligibility (
  id uuid primary key default gen_random_uuid(),
  repair_customer_id uuid not null
    references public.repair_customers(id) on delete cascade,
  letter_kind public.letter_kind not null,
  eligible boolean not null default false,
  suppressed_by_alert boolean not null default false,   -- ADR-4: the survey-alert suppression rule, explicit
  period_key text not null,                             -- cycle bucket (e.g. month of ro_completed_at)
  computed_at timestamptz not null default now(),
  printed_at timestamptz,                               -- replaces Letter_*_Printed stamps (idempotency)
  constraint letter_eligibility_unique_cycle
    unique (repair_customer_id, letter_kind, period_key) -- no double-send
);

-- Cron upsert target + "what is eligible right now" reads.
create index if not exists idx_letter_eligibility_customer_kind
  on public.letter_eligibility (repair_customer_id, letter_kind);

-- Batch builder: pull eligible, not-yet-printed rows for a cycle.
create index if not exists idx_letter_eligibility_ready
  on public.letter_eligibility (letter_kind, period_key)
  where eligible and printed_at is null;
```

**RLS**: ops table tied to end-consumer records. Gated by the production
capability (`manage_production`, since this feeds the print queue). Service-role
(eligibility-compute cron) bypasses RLS for the idempotent upsert.

```sql
alter table public.letter_eligibility enable row level security;

drop policy if exists letter_eligibility_select on public.letter_eligibility;
create policy letter_eligibility_select on public.letter_eligibility
  for select to authenticated
  using (private.current_user_has_fn('manage_production'));

drop policy if exists letter_eligibility_write on public.letter_eligibility;
create policy letter_eligibility_write on public.letter_eligibility
  for all to authenticated
  using (private.current_user_has_fn('manage_production'))
  with check (private.current_user_has_fn('manage_production'));
```

---

## RLS summary

| Table | Clamp | Ops gate (`current_user_has_fn`) | Notes |
|-------|-------|----------------------------------|-------|
| `survey_responses` | `shop_id IN user_shop_ids()` | `manage_surveys` | PII; survey-ingest cron is service-role |
| `repair_customers` | `shop_id IN user_shop_ids()` | `manage_companies` | high-sensitivity PII; `psg_sensitive_pii_*` redaction at view layer |
| `company_programs` | n/a (master data) | `manage_companies` | seed referral flag before classification |
| `letter_eligibility` | via `manage_production` | `manage_production` | eligibility-compute cron is service-role |

`psg_superadmin` bypasses the function gate (handled inside
`private.current_user_has_fn`). All four tables are default-deny: no blanket
`anon`/`authenticated` policy exists beyond the named policies above.

---

## Forward-only policy

- Migrations are **forward-only**. No down/rollback scripts. New columns and
  tables are additive, so a UI rollback leaves data intact, and FileMaker stays
  authoritative until the v1.3 cutover (rollback = point users back to FileMaker).
- All DDL is idempotent (`if not exists`, enum guards, `drop policy if exists`
  before `create policy`) so a re-apply is a no-op.
- Enum changes go through `alter type ... add value if not exists`; never edit an
  enum in place.
- Schema migrations must not collide with the BSM, advantage-portal,
  ads-dashboard, and local_reach schemas in the shared Supabase project
  `gylkkzmcmbdftxieyabw`. Resolve against the latest applied migration before
  timestamping a new file.
