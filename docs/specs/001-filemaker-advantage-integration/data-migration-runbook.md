---
title: "FileMaker Advantage → psg-hub Historical Data Migration Runbook"
status: draft
version: "1.0"
---

# Historical Data Migration Runbook (v1.3.5 optional add-on)

This runbook covers the optional historical data migration described in ADR-5 of the Solution Design Document (`solution-design.md`). It is step-by-step and operational. Read the SDD first, especially the Deployment View migration sequencing, ADR-5, and the migration worker directory map.

## 1. Goal and when this runs

### 1.1 Goal

1. Load historical FileMaker Advantage records into the psg-hub shared Supabase schema so PSG keeps a single source of historical continuity after FileMaker retires.
2. Resolve the FileMaker composite string match key into real `survey_responses.repair_customer_id` foreign keys, and keep `legacy_match_key` for reconciliation.
3. Reconcile loaded counts against the DDR inventory (repair_customers ≈ 281K, survey_responses ≈ 334K) before anyone relies on the data.

### 1.2 When this runs

1. This is v1.3.5, an optional add-on. It runs only if the business needs historical continuity in psg-hub.
2. Functional replacement does not depend on it. The customer track (v0.1–v0.4) and the ops backbone (v1.1 → v1.4) ship and operate without this migration.
3. FileMaker stays the authoritative daily driver until the v1.3 cutover. After v1.3 cutover, FileMaker is read-only for history.
4. Run the historical backfill only after the v1.3 functional cutover is complete and stable. See section 8 for the cutover ordering rule.
5. If the business decides historical data is not required in psg-hub, do not run this runbook. FileMaker read-only access satisfies the audit need.

## 2. Sources and extract method

The migration draws from three distinct sources. Structure comes from the DDR exports; live record data comes from the FileMaker Data API and the vendor xlsx.

### 2.1 Schema and field mapping (DDR, structure only)

1. The DDR CSV exports live at `agents/CIO/Filemaker/2025-05-28/Exports for Reference/` (Scripts, Steps, Fields, Tables, Relationships, Layouts CSVs, plus the raw `_fmp12.xml` DDRs).
2. Use these for table structure, field names, indexed fields, value lists, and the match-key calculation definitions. They are the migration source for structure, not for record data.
3. Confirm field-to-column mapping against the DDR before each entity load. The `fm_transform/` mapping tables are built from these CSVs.

### 2.2 Live records (FileMaker Data API)

1. Live repair customers, repair orders, estimates, and production history extract through the FileMaker Data API on the `psgweb.me` host.
2. Configure `FILEMAKER_DATA_API_*` env vars (host, database, account, password). The Data API session token is short-lived; the extract layer re-authenticates and pages through layouts.
3. The Data API is read-only for migration. No write-back to FileMaker at any point (see section 8.4).

### 2.3 Survey and repair responses (vendor xlsx)

1. The vendor xlsx exports for Advantage repair and survey responses live in `psg-data-lake/Export/` (for example `advatange-survey-responses*.xlsx`, the same source v0.3 used to promote `survey_responses`).
2. Use the xlsx as the survey/repair response source where the Data API does not expose a clean per-survey row, and to cross-check Data API counts.
3. Where the xlsx and the Data API disagree on a survey row, treat the Data API as the record-level source of truth and log the variance.

### 2.4 Worker location

1. The migration worker lives in `psg-data-lake/`: `fm_migrate.py` (orchestrator), `fm_extract/` (DDR CSV + Data API + xlsx readers), and `fm_transform/` (match-key resolution, PII redaction, dedupe).
2. Run via the SDD project command:

```bash
python psg-data-lake/fm_migrate.py --entity repair_customers   # one entity at a time
```

3. The worker runs in the Vercel Sandbox or the `psg-data-lake` venv. Target is Supabase project `gylkkzmcmbdftxieyabw`.

## 3. Entity load order

Load entities in dependency order. Each step precedes the next because the later entity carries a foreign key into the earlier one. Loading out of order produces orphan foreign keys and forces re-runs. Run one entity at a time and reconcile its count (section 7) before starting the next.

### 3.1 Master data first

1. `vehicles` — referenced by `repair_orders.vehicle_id`. No inbound dependency, load first.
2. `insurance_companies` — referenced by `repair_orders.insurance_company_id` and by `insurance_agents`.
3. `insurance_agents` — references `insurance_companies` (via `insurance_company_ids[]`); referenced by `repair_orders.insurance_agent_id`. Load after insurance_companies.
4. `products` — referenced by `company_programs.product_id` and `production_documents.product_id`.
5. `items` — referenced by `products.items_jsonb` content. Load alongside products.

Rationale: master data has no dependency on transactional records, but every transactional record points back to it. Master data must exist before any row that references it, or the foreign key resolves to null.

### 3.2 Companies

1. Load `companies` (the system-generated Shop ID is the primary internal ops entity).
2. Rationale: `employees`, `repair_customers`, `repair_orders`, `estimates`, and `company_programs` all carry `company_id`. Companies must exist first.

### 3.3 Employees

1. Load `employees` (references `company_id`).
2. Rationale: companies must exist. Employees are referenced by report attribution (estimator, body tech, painter performance reports) but carry no inbound FK from the core transactional load, so they slot in after companies and before transactional records.

### 3.4 Repair customers

1. Load `repair_customers` (references `company_id`).
2. Set `legacy_match_key` from the FileMaker `RC_MatchField_Master` value during this load. This is required for survey match-key resolution in section 4 and for reconciliation in section 7.
3. Seed `referral_tracking_enabled` and `credit_hold` here (see section 6.4); both are read before survey classification.
4. Rationale: `repair_orders`, `estimates`, and `survey_responses` all carry `repair_customer_id`. Repair customers must exist before any of them, and the match key must be present before surveys are linked.

### 3.5 Repair orders

1. Load `repair_orders` (references `repair_customer_id`, `company_id`, `vehicle_id`, `insurance_company_id`, `insurance_agent_id`).
2. Rationale: repair orders depend on repair customers and all of master data. They also carry the RO completion date used by eligibility, so they precede any eligibility-related history.

### 3.6 Estimates

1. Load `estimates` (references `repair_customer_id`, `company_id`).
2. Rationale: estimates depend on repair customers and companies. They have no inbound FK from surveys or production, so they load after ROs and before surveys.

### 3.7 Survey responses

1. Load `survey_responses` (references `repair_customer_id`, nullable until matched, plus `shop_id`).
2. Resolve `repair_customer_id` from the legacy match key during this load (section 4). Leave the FK null and queue the row when no match resolves; never drop it.
3. Classify `alert_class` only after `referral_tracking_enabled` and `credit_hold` are seeded (section 6.4).
4. Rationale: surveys point at repair customers. Repair customers and their `legacy_match_key` values must already exist for the FK to resolve.

### 3.8 Production history

1. Load production history (`production_batches`, `production_documents`, `production_reprint_log`, and any `mail_vendor_jobs` history) last.
2. Rationale: `production_documents` references `company_id`, `product_id`, and `repair_customer_id`. Every one of those must already be loaded. Production history is the leaf of the dependency graph, so it loads last.

## 4. Match-key resolution

The FileMaker composite string match key becomes a real foreign key (ADR-2). This is the load-bearing transform of the survey load.

### 4.1 What the legacy key is

1. The FileMaker key is a composite string built from shop/master id + record creation month + creation year.
2. On the Advantage side: `RC_MatchField_Master` is the raw shop/master key; `RC_MatchField_survey = RC_MatchField_Master & RC_CreationDate_Month & RC_CreationDate_Year`.
3. On the Survey side: `S_RC_ShopID` is the shop key; `S_RC_MatchField_RepairCust = S_RC_ShopID & S_CreationDate_Month & S_CreationDate_Year`.
4. The live join in FileMaker is `Repair Customer::RC_MatchField_survey = Survey Input::S_RC_MatchField_RepairCust`.

### 4.2 How resolution works

1. During the repair_customers load (section 3.4), store `repair_customers.legacy_match_key` as the composite survey-form key (shop/master id + creation month + creation year), matching the Advantage `RC_MatchField_survey` shape.
2. During the survey load, compute the same composite key on the survey side (`S_RC_ShopID` + creation month + creation year).
3. Resolve `survey_responses.repair_customer_id` by joining the computed survey key to `repair_customers.legacy_match_key`.
4. Keep `legacy_match_key` on `repair_customers` after migration. It exists for reconciliation only, not for runtime joins.

### 4.3 Build the needs-match queue

1. When a survey key resolves to exactly one repair customer, set `repair_customer_id` and proceed.
2. When a survey key resolves to zero repair customers, leave `repair_customer_id` null and place the row in the needs-match queue (the ops "needs match" surface). Never drop the survey.
3. When a survey key resolves to more than one repair customer (ambiguous month/year/shop collision), leave `repair_customer_id` null, queue the row, and tag it ambiguous so an account manager picks the correct link.
4. The needs-match queue is the explicit, queryable replacement for the FileMaker failure mode where a shop-id or month/year mismatch silently broke the survey-to-customer link.
5. Target unmatched-survey rate below 2 percent after reconciliation (SDD reliability bar). Above 2 percent, stop and investigate the key construction before continuing.

## 5. Transform rules

All transforms live in `fm_transform/`. Apply them in this order during each entity load.

### 5.1 PII redaction

1. Repair customers and survey content are end-consumer PII (names, addresses, phones, emails, survey free text).
2. Apply the existing `psg_sensitive_pii_*` redaction patterns to every loaded field that those patterns cover. Do not invent new redaction logic.
3. Redact `survey_responses.raw_payload` before write, matching the v0.3 promotion behavior.
4. Keep secrets encrypted at rest (pgsodium) where the schema already does so. The migration writes no plaintext secret.
5. Manual PII sign-off is required at the migration milestone, consistent with the v1.1 / v1.3 / v2.0 PII review gates.

### 5.2 Dedupe

1. The FileMaker files carry accumulated redundant definitions and duplicate external data source entries. Expect duplicate rows in the extract.
2. Dedupe master data on natural keys (vehicle make+model; insurance company name; product name) before load so transactional foreign keys resolve to one canonical row.
3. Dedupe repair_customers on `legacy_match_key` plus identity fields. Collapse exact duplicates; queue near-duplicates for manual review rather than guessing.
4. Dedupe survey_responses on the source survey row id plus computed match key so a re-run does not double-insert.

### 5.3 Seed referral_tracking_enabled and credit_hold before classification

1. The `referral` vs `misfire` branch depends on per-company `referral_tracking_enabled` and the customer `credit_hold` flag. In FileMaker these were read cross-file from `Master Client::M_ReferralNoted_flag` and `M_CreditHold_flag`.
2. Seed `company_programs.referral_tracking_enabled` (and `repair_customers.referral_tracking_enabled` where the per-customer copy applies) from the FileMaker `M_ReferralNoted_flag` value during the companies / repair_customers load.
3. Seed `repair_customers.credit_hold` from the FileMaker `M_CreditHold_flag` value during the repair_customers load.
4. These seeds must complete before survey classification runs in section 3.7. If they are missing, every referral-eligible survey misclassifies as misfire.

### 5.4 Survey classification (after seeds)

1. Classify each loaded survey into `alert_class` (perfect / misfire / hotspot / unresolved / referral / none) using the SDD classification rules, which encode the DDR v3 LIVE logic.
2. Confirm the v3 LIVE alert logic is the authoritative generation before running classification. FileMaker carried three live generations (v2, WIP, v3 LIVE); only v3 LIVE is wired to the Web triggers.
3. Map the FileMaker idempotency stamps to columns: `SQ_Alert_PostDate_*` to `alert_posted_at`, and `S_RC_Referral_Letter_Post` to `referral_letter_posted_at`. Historical surveys that were already posted in FileMaker arrive with these timestamps set, so psg-hub does not re-send for already-handled history.

## 6. Reconciliation

Reconcile every entity before starting the next. Treat reconciliation as a gate, not a report.

### 6.1 Count targets

1. `repair_customers` ≈ 281,077 (DDR Repair Customer table inventory, 5/27/2025).
2. `survey_responses` ≈ 334,269 (DDR Survey Input table inventory, 5/27/2025).
3. For master data, companies, employees, repair_orders, estimates, and production history, reconcile loaded counts against the DDR table inventory and the source extract counts for that entity.

### 6.2 Variance tolerance

1. Counts are dated 5/27/2025 and the live FileMaker has changed since. Expect small drift. Treat a per-entity variance within plus or minus 2 percent of the DDR target as within tolerance.
2. Unmatched-survey rate must be below 2 percent (section 4.3).
3. Record the actual loaded count, the DDR target, and the variance percentage for each entity in the run log.

### 6.3 50-link customer-to-survey spot check

1. Sample 50 `survey_responses` rows that resolved a `repair_customer_id`.
2. For each, confirm the resolved repair customer matches the source FileMaker survey-to-repair link (shop id, creation month, creation year all agree).
3. All 50 must resolve correctly. Any incorrect link means the match-key construction is wrong; stop and fix the key before trusting the survey load.

### 6.4 What to do on mismatch

1. Within tolerance: record the variance, mark the entity reconciled, proceed to the next entity.
2. Outside tolerance (count drift beyond plus or minus 2 percent): stop. Diff the loaded set against the source extract to find dropped or duplicated rows. Re-run the entity load (it is idempotent, section 9) after fixing the cause. Do not start the next entity.
3. Unmatched-survey rate at or above 2 percent: stop. Inspect the needs-match queue, verify `legacy_match_key` was populated on repair_customers, verify the survey-side key construction, fix, and re-resolve.
4. Spot-check failure: stop. The FK resolution is unsafe. Fix match-key logic and re-run the survey load.

## 7. Validation SQL examples

Run these against Supabase project `gylkkzmcmbdftxieyabw` after each entity load. They confirm counts, catch orphan foreign keys, and catch duplicates.

### 7.1 Count per table

```sql
SELECT 'repair_customers' AS entity, count(*) AS rows FROM repair_customers
UNION ALL SELECT 'repair_orders', count(*) FROM repair_orders
UNION ALL SELECT 'estimates', count(*) FROM estimates
UNION ALL SELECT 'survey_responses', count(*) FROM survey_responses
UNION ALL SELECT 'companies', count(*) FROM companies
UNION ALL SELECT 'employees', count(*) FROM employees
UNION ALL SELECT 'production_documents', count(*) FROM production_documents
ORDER BY entity;
```

### 7.2 Orphan foreign key checks

```sql
-- Survey rows that have a repair_customer_id pointing at a missing customer.
SELECT count(*) AS orphan_survey_fk
FROM survey_responses sr
LEFT JOIN repair_customers rc ON rc.id = sr.repair_customer_id
WHERE sr.repair_customer_id IS NOT NULL
  AND rc.id IS NULL;

-- Repair orders pointing at missing parents (customer, company, or master data).
SELECT count(*) AS orphan_ro_customer
FROM repair_orders ro
LEFT JOIN repair_customers rc ON rc.id = ro.repair_customer_id
WHERE rc.id IS NULL;

SELECT count(*) AS orphan_ro_company
FROM repair_orders ro
LEFT JOIN companies c ON c.id = ro.company_id
WHERE c.id IS NULL;

SELECT count(*) AS orphan_ro_vehicle
FROM repair_orders ro
LEFT JOIN vehicles v ON v.id = ro.vehicle_id
WHERE ro.vehicle_id IS NOT NULL AND v.id IS NULL;

-- Production documents pointing at missing parents.
SELECT count(*) AS orphan_doc_customer
FROM production_documents pd
LEFT JOIN repair_customers rc ON rc.id = pd.repair_customer_id
WHERE pd.repair_customer_id IS NOT NULL AND rc.id IS NULL;
```

Every orphan count must be zero. A non-zero orphan count means an entity loaded out of order (section 3); re-run after loading the missing parent.

### 7.3 Needs-match queue size and unmatched rate

```sql
-- Unmatched survey count and rate.
SELECT
  count(*) FILTER (WHERE repair_customer_id IS NULL) AS unmatched,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE repair_customer_id IS NULL) / nullif(count(*), 0), 2) AS unmatched_pct
FROM survey_responses;
```

`unmatched_pct` must be below 2.0.

### 7.4 Duplicate checks

```sql
-- Duplicate repair customers on the legacy match key (should be 0 rows after dedupe).
SELECT legacy_match_key, count(*) AS dupes
FROM repair_customers
WHERE legacy_match_key IS NOT NULL
GROUP BY legacy_match_key
HAVING count(*) > 1
ORDER BY dupes DESC
LIMIT 50;

-- Duplicate production documents on print_id (print_id is unique by design).
SELECT print_id, count(*) AS dupes
FROM production_documents
GROUP BY print_id
HAVING count(*) > 1;

-- Duplicate master data (example: vehicles on make+model).
SELECT make, model, count(*) AS dupes
FROM vehicles
GROUP BY make, model
HAVING count(*) > 1
ORDER BY dupes DESC;
```

### 7.5 Seed verification before classification

```sql
-- Confirm referral/credit-hold seeds landed before survey classification runs.
SELECT
  count(*) FILTER (WHERE referral_tracking_enabled IS NULL) AS programs_missing_referral_flag
FROM company_programs;

SELECT
  count(*) FILTER (WHERE credit_hold IS NULL) AS customers_missing_credit_hold
FROM repair_customers;
```

Both must be zero before running survey classification (section 5.3).

## 8. Parallel run and cutover

### 8.1 Parallel run authority

1. During parallel run (v1.1 → v1.3), FileMaker is authoritative. psg-hub is downstream only.
2. psg-hub writes its own data during this period. It does not write back to FileMaker.

### 8.2 After cutover

1. At v1.3 cutover, point the PSG production team to psg-hub for all new production.
2. FileMaker becomes read-only for historical access. It is no longer a daily driver.

### 8.3 Order of functional cutover vs historical backfill

1. Do the functional cutover (a) first. Complete and stabilize the v1.3 Production cutover so psg-hub is the daily driver for new work.
2. Do the historical backfill (b) second. Run this v1.3.5 migration after the functional cutover is stable.
3. Rationale: functional replacement does not depend on historical data (ADR-5). Cutting over first means the daily driver is live and verified before the large historical load runs, and the backfill cannot block or destabilize the cutover.
4. During the gap between (a) and (b), current data is in psg-hub and deep history is in read-only FileMaker. This is expected and acceptable.

### 8.4 No write-back

1. There is no two-way sync. psg-hub never writes into FileMaker.
2. The FileMaker Data API is used read-only, for extract only, during both parallel run and this migration.

## 9. Rollback and idempotency

### 9.1 Idempotency

1. Every entity load is re-runnable. Loads are keyed on legacy ids (`legacy_match_key` for repair_customers; source row ids for surveys, ROs, estimates; `print_id` for production documents; natural keys for master data).
2. Loads upsert on the legacy key. Re-running an entity updates existing rows in place and does not create duplicates.
3. Survey classification and FK resolution re-run safely: re-resolution overwrites the same `repair_customer_id` and `alert_class`, and the post-date stamps prevent re-sending already-handled history.

### 9.2 How to abort safely

1. Abort between entities, not mid-entity, whenever possible. The load order (section 3) gives clean stopping points.
2. To abort a single entity load mid-run, stop the worker. Because the load is an idempotent upsert keyed on legacy ids, partial progress is consistent. Re-run the same entity from the start to finish it.
3. Do not run the next entity after an aborted entity until the aborted entity reconciles (section 6).
4. Full unwind of a v1.3.5 migration: because the schema additions are additive and FileMaker remains read-only and authoritative for history, a UI-level rollback leaves loaded data intact. If the loaded data itself must be removed, delete by the entity's legacy-id set in reverse load order (production history → surveys → estimates → ROs → repair_customers → employees → companies → master data) so no foreign key is orphaned during teardown.
5. Migrations are forward-only at the schema level (per the SDD breaking-change policy). Rollback means reverting application behavior and, if required, deleting loaded rows, not reversing schema migrations.

## 10. Operational notes

### 10.1 Stale FileMaker external references to ignore

These references exist in the FileMaker files but are stale, dormant, or broken. Do not recreate them and do not let their absence fail the extract.

1. `BridgeSystem` — hardcoded to a developer desktop path (`.../Users/stevesch/Desktop/BridgeSystem`). Ignore.
2. `EmployeeSatisfaction` — external file not in the export set. Ignore.
3. `Import Flush2` — stale ETL reference. Ignore. The 325 per-shop importers are replaced by `import_templates`, not migrated.
4. `PSG_SurveyExport_07.1` — declared in both Advantage and Survey but no script, import, or export uses it. Dormant. Ignore.
5. `Phoenix Solutions Group` — flagged Unknown, empty path, a dead reference. Ignore.

The migration extract must tolerate the absence of all of these. A "file not found" prompt from any of them is expected, not a failure.

### 10.2 No machine-specific import paths

1. Do not source any data from machine-specific local paths (for example `/Users/ryan/Downloads/1.fmp12`). Those are fragile workstation artifacts.
2. Source structure from the DDR exports at `agents/CIO/Filemaker/2025-05-28/Exports for Reference/`, live records from the FileMaker Data API, and survey/repair responses from `psg-data-lake/Export/`. Nothing else.

### 10.3 Run discipline

1. Run one entity at a time (`--entity <name>`), in the order of section 3.
2. Reconcile (section 6) and run validation SQL (section 7) after each entity, before the next.
3. Record loaded count, DDR target, variance, and unmatched rate per entity in the run log.
4. Stop on any out-of-tolerance variance, non-zero orphan count, or spot-check failure. Fix the cause, re-run the idempotent load, then continue.
