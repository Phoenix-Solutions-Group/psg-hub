---
title: "FileMaker Advantage Integration — Implementation Plan"
status: draft
version: "1.0"
---

# Implementation Plan

This plan turns the SDD (`solution-design.md`) into a buildable sequence for the ops track. It re-platforms the four FileMaker files (Advantage, Survey, Import Flush, Web) into psg-hub modules on the shared Supabase schema, replaces the Web PSOS scheduler with Vercel cron, and replaces the date-stamp idempotency pattern with status columns plus unique constraints.

Scope here is the ops track only (v1.1 to v1.4 plus optional v1.3.5). The customer track (v0.1 to v0.4) ships first and is out of scope for this plan. FileMaker stays the authoritative daily driver through the v1.3 cutover and stays read-only for history after.

The behavioral source of truth is the DDR cross-file analysis. Where this plan names rules (eligibility windows, alert classes, suppression, idempotency), they come from the analysis, not from new design.

## Components and Dependencies

The build has six logical components. Each maps to a directory and a milestone.

| Component | Directory | Replaces (FileMaker) | Depends on |
|-----------|-----------|----------------------|------------|
| Schema + RBAC/security_profiles | `supabase/migrations/`, `scripts/seed.mjs` | the four-file split, no FM security layer | nothing (foundation) |
| Ops CRUD endpoints + UI | `src/app/api/ops/`, `src/app/(ops)/ops/` | Advantage data-entry layouts, Import Flush | schema, RBAC |
| Cron workers | `src/app/api/cron/` | Web PSOS scheduler, date-stamp processing | schema, scoring service, eligibility service |
| Survey scoring service | `src/lib/surveys/scoring/` | Survey `SQ_Alert_*` classification calcs | schema, `company_programs` seeds |
| Eligibility service | `src/lib/eligibility/` | Advantage `SS - Elgibility - *` finds + suppression | schema, scoring (open-alert reads) |
| Production batch + print | `src/lib/production/`, `src/app/api/ops/production/` | Advantage Print/Loop letter batches | schema, eligibility, mail adapters |
| Report engine | `src/lib/reports/`, `src/app/api/ops/reports/` | Advantage PDF Generate Report + Email Report | schema, all upstream data populated |
| Migration worker (optional) | `psg-data-lake/fm_migrate.py` | one-time history move | schema fully landed, all services stable |

### Dependency Notes

- The schema delta is the gate for everything. No service compiles without `letter_eligibility`, the `survey_responses` columns, and the `repair_customers`/`company_programs` columns.
- RBAC and `security_profiles` ship with the schema because every ops endpoint and cron is gated by `security_profiles.functions_jsonb` flags (`manage_companies`, `manage_surveys`, `manage_production`, `manage_reports`, `manage_data_imports`).
- The eligibility service reads open-alert state, so survey ingest and classification must produce `alert_class` and `alert_posted_at` before eligibility runs are meaningful.
- The production batch builds from eligible customers, so eligibility must be computing before a batch is useful (though batch CRUD itself only needs schema).
- The report engine reads every other table, so reports land last among the functional modules.
- The migration worker is the only Python component and the only optional one; it never blocks functional replacement (ADR-5).

## Implementation Order

Build in this order. Each stage is a hard prerequisite for the next unless marked parallel.

1. **Schema + RBAC/security_profiles.** Migrations for every table delta the SDD lists, plus RBAC seeds. This is the foundation; nothing else starts until migrations apply cleanly and seeds load.
2. **Ops CRUD.** Companies, employees, programs, repair_customers, repair_orders, estimates, surveys (entry/view), and master data (products, items, vehicles, insurance_companies, insurance_agents). Plus the `import_templates` importer that absorbs psg-import and retires the 325 per-shop scripts.
3. **Survey ingest + classify.** The scoring service (`classifySurvey`) and the `/api/cron/survey-ingest` worker. FK resolution to `repair_customer_id`, the needs-match queue for unmatched rows, and `alert_class` + `alert_posted_at` stamping.
4. **Eligibility.** The eligibility service (date windows on RO completion date) plus the suppression rule (open survey alert removes a customer from routine mail, recorded as `suppressed_by_alert`), behind `/api/cron/eligibility-compute`. Idempotent upserts on `(repair_customer_id, letter_kind, period_key)`.
5. **Production.** Batch build, idempotent print (only `unprinted` to `printed`), reprint with audit, and the Lob webhook plus the dual mail adapter (Lob primary, in-house fallback).
6. **Reports.** The parameter-driven report engine and the 26 named reports, starting with one survey-alert report end to end (Perfect Score) to prove the framework.
7. **Migration (optional, v1.3.5).** The `psg-data-lake` Python worker: extract from DDR CSVs plus the FileMaker Data API, resolve legacy match keys to FKs, redact PII, dedupe, load, and reconcile counts.

### Why This Order

The order follows data flow. A survey must be scored before its alert can suppress a letter; a letter must be eligible before it can be batched; a batch must exist before a report can recap it. Building against the grain (reports before data, eligibility before scoring) would force stubbing the exact rules the DDR says must be exact.

## Mapping to psg-hub Milestones

The PLANNING.md milestone numbers govern. Note the customer track (v0.1 to v0.4) ships first; this is the ops track.

| Milestone | Scope from this plan | PLANNING reference |
|-----------|---------------------|--------------------|
| **v1.1 Ops Foundation** | Schema + RBAC/security_profiles; ops CRUD; master data; `import_templates` importer; survey entry/view; survey ingest + classify; eligibility service + suppression | PLANNING v1.1 phases 1 to 8 |
| **v1.3 Production + cutover** | Mail dual adapter; production batches; idempotent print; reprint; Lob webhook; historical search; FileMaker daily-driver cutover | PLANNING v1.3 phases 1 to 6 |
| **v1.4 Reports** | Report engine framework; the 26 named reports in 5 batches | PLANNING v1.4 phases 1 to 5 |
| **v1.3.5 Migration (optional)** | `psg-data-lake` Python worker; historical extract, transform, load, reconcile | PLANNING Decision 32, Q15; SDD ADR-5 |

Notes on milestone placement:

- The SDD draws eligibility/suppression acceptance criteria under v1.3, but the eligibility service and the survey scoring it depends on are built in v1.1 (PLANNING v1.1 phase 4 covers surveys). This plan builds eligibility + scoring in v1.1 so the suppression rule is provable before the v1.3 production cutover relies on it. v1.3 then consumes eligible customers; it does not rebuild eligibility.
- v1.2 (Ads Mutation Studio) sits between v1.1 and v1.3 in PLANNING but is out of scope for this FileMaker integration. The ops backbone built in v1.1 carries forward unchanged.
- v1.3.5 is sequenced after v1.3 cutover and is gated behind the optional add-on decision. Functional replacement (v1.1 to v1.4) never depends on it.

## Parallel vs Sequential Work

Within the single delivery team, most of this is sequential because of the data-flow dependency chain. The parallelizable seams:

**Can run in parallel:**

- Ops CRUD modules are mutually independent once the schema lands. Companies/employees/programs, repair_customers/ROs, estimates, surveys-entry, and master data CRUD can be split across people if capacity allows.
- The `import_templates` importer is independent of the survey/eligibility chain; it shares only the schema.
- Mail adapter scaffolding (Lob client, in-house adapter, the `MailAdapter` interface) can be built while production batch CRUD is in progress, since the interface is the contract.
- Report SQL for reports that read only already-populated tables (volume/invoicing reports) can be drafted while the survey-dependent reports wait on classification data.
- The migration worker's extract/transform code can be written against DDR CSV samples at any point after the schema is fixed, independent of the live app.

**Must be sequential:**

- Schema before any service. Hard gate.
- Survey scoring before eligibility (eligibility reads open-alert state).
- Eligibility before a useful production batch (batch builds from eligible customers).
- Data populated before reports that recap it.
- v1.3 production cutover before v1.3.5 migration (migration loads history behind the daily driver).

## Verification Checkpoints

Each phase is done when its checkpoint passes. These prove the phase, not just that code exists.

### After Schema + RBAC

- `supabase migration up` applies all deltas with no error; `list_tables` shows `letter_eligibility` plus the new columns on `survey_responses`, `repair_customers`, `company_programs`.
- `node scripts/seed.mjs` seeds roles, modules, and the built-in Administrator `security_profile` granting all function flags.
- A `psg_internal` user without `manage_companies` is denied on a guarded ops route; with it, allowed. RLS clamps customer data to authorized shops.

### After Ops CRUD

- An account manager creates a company, adds employees, enrolls a program with logo/header/footer overrides, and the records persist with RLS enforced.
- An RO import through an `import_templates` mapping validates against the template, loads rows, and surfaces row-level validation errors. The 325-per-shop pattern is not reproduced; one mapping-driven importer handles all shops.

### After Survey Ingest + Classify

- A seeded survey with known scores classifies to the expected `alert_class` per the DDR rules (verify all six: perfect, misfire, hotspot, unresolved, referral, none).
- A survey with no resolvable `repair_customer_id` is retained with a null FK and appears in the needs-match queue; it is never dropped.
- `alert_posted_at` stamps on classification; re-running ingest does not reclassify or double-stamp already-processed rows (watermark + idempotent).

### After Eligibility

- For a customer in the 3-month window on RO completion date with no open alert, an eligible `letter_eligibility` row exists.
- For the same customer with an open survey alert in the window, the row records `eligible=false` and `suppressed_by_alert=true`. The suppression is queryable, not emergent.
- Re-running `eligibility-compute` produces no duplicate row for the same `(repair_customer_id, letter_kind, period_key)`.

### After Production

- A batch built from eligible customers produces documents each with a unique `print_id`.
- Printing transitions only `unprinted` documents to `printed` and stamps `printed_at`; re-running the print skips already-printed documents (reported as `skipped_already_printed`).
- A reprint writes a `production_reprint_log` row. A Lob webhook (HMAC verified) updates the matching `mail_vendor_jobs` row.

### After Reports

- `/api/ops/reports/perfect-score` returns rows matching a hand-checked query over seeded survey data.
- The report framework serves a 12-month date range within the LCP < 3s bar using the `pg` pool plus Redis cache, not PostREST.
- All 26 report slugs resolve (even if some return empty on seed data).

### After Migration (optional)

- Post-load counts reconcile to the DDR within tolerance (repair_customers approx 281K, survey_responses approx 334K).
- A spot-check of 50 customer-to-survey links resolves correctly through the new FK (not the legacy match key).
- Unmatched-survey rate is visible and under 2 percent after reconciliation.

### Per-Milestone Gate (Playwright)

Each milestone closes with a Playwright happy-path E2E (PLANNING quality gates):

- v1.1: create company to add employees to import RO.
- v1.3: build batch to print to reprint.
- v1.4: open report index to run one report to export.

## Risks and Mitigations

Pulled from the SDD Risks section and the DDR analysis.

| Risk | Source | Mitigation |
|------|--------|------------|
| **Stale FileMaker external references** (BridgeSystem hardcoded path, EmployeeSatisfaction, Import Flush2, dormant PSG_SurveyExport_07.1, broken "Phoenix Solutions Group") | DDR sec 6; SDD Known Technical Issues | Do not recreate these dependencies. The migration extract must tolerate their absence and not fail on a missing referenced file. Source only from DDR exports plus the Data API. |
| **Three live generations of alert scripts** (v2, WIP, v3 LIVE) | DDR sec 6; SDD Known Technical Issues | Confirm v3 LIVE is the authoritative logic before encoding `classifySurvey`. Encode exactly one classification path; do not port all three. Verify thresholds against the v3 calcs. |
| **Machine-specific import paths** (e.g. `/Users/ryan/Downloads/1.fmp12`, per-shop Flush files) | DDR sec 6; SDD Known Technical Issues | The importer sources from uploaded files mapped via `import_templates`, never from a workstation path. The migration worker sources from DDR exports plus the Data API, not a developer machine. |
| **Single point of automation** (the Web PSOS scheduler was the only cron) | DDR sec 4; SDD Error Handling | Every cron is idempotent and window-based, so a missed run self-heals on the next run. Add a freshness alert when `computed_at` is stale beyond 36h. No single script is load-bearing. |
| **Referral flag seeding** (the referral vs misfire branch reads per-company `referral_tracking_enabled` and `credit_hold`, which were cross-file reads in FileMaker) | DDR sec 3; SDD Implementation Gotchas | Seed `company_programs.referral_tracking_enabled` and `repair_customers.credit_hold` before any classification run. Without them every survey misclassifies. Add a seed-completeness check to the survey-ingest preflight. |
| **Composite match key broke links silently** (shop-id + month + year string) | DDR sec 3 and 6 | Replace with a real FK (`survey_responses.repair_customer_id`, ADR-2). Keep `legacy_match_key` for reconciliation only. Unmatched rows go to the needs-match queue, never dropped. |
| **Cleared/back-dated stamps re-fire or skip letters** | DDR sec 6 | Replace date-stamp guards with status columns plus unique constraints. `printed_at` guards and `ON CONFLICT DO NOTHING` make re-runs safe. |
| **Two date axes confused** (eligibility uses RO completion date, not survey date) | SDD Implementation Gotchas | Keep the two dates distinct in schema and queries. Eligibility windows key on `ro_completed_at`; alert posting keys on survey `submitted_at`. |
| **Parallel-run write-back** (psg-hub must not write into FileMaker) | SDD Implementation Gotchas; CON-2 | psg-hub is downstream only until v1.3 cutover. No two-way sync. FileMaker stays authoritative; reads are read-only extracts. |

## Deployment Order

Per the SDD Deployment View: schema migration, then ops endpoints, then cron, then UI. Production (v1.3) requires Lob/SendGrid live (set up in v0.1). Migrations are forward-only and additive, so a UI rollback leaves data intact; until v1.3 cutover, rollback means pointing users back to FileMaker.
