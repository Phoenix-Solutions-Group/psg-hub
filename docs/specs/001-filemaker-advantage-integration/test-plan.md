---
title: "FileMaker Advantage → psg-hub Integration — Test Plan"
status: draft
version: "1.0"
---

# Test Plan

This test plan turns the SDD (`solution-design.md`) into a concrete, executable test strategy for the FileMaker Advantage integration. It mirrors the SDD Acceptance Criteria and Quality Requirements, expands them into runnable test cases, and aligns to the psg-hub milestone plan (`PLANNING.md`). The DDR analysis remains the behavioral source of truth; every classification, suppression, idempotency, and migration case below derives from it.

The plan is scoped to the ops backbone the SDD delivers across v1.1 → v1.4, the optional migration add-on v1.3.5, and the PII sign-off gates at v1.1, v1.3, and v2.0.

## 1. Test Strategy

### 1.1 Levels

| Level | Tool | What it covers | Where it lives |
|-------|------|----------------|----------------|
| Unit | Vitest 4 + jsdom | Pure logic and services in `src/lib/` (eligibility windows, suppression rule, survey scoring, production idempotency). No network, no real DB. | `apps/psg-hub/src/lib/**/*.test.ts` |
| Component | Vitest 4 + jsdom + Testing Library | Ops UI components (needs-match queue, batch print confirm, report parameter forms). Rendered, no real backend. | `apps/psg-hub/src/app/(ops)/**/*.test.tsx` |
| Integration | Vitest 4 against a test Supabase project | API route handlers (`/api/ops/*`, `/api/cron/*`, `/api/webhooks/lob`) against a real Postgres schema with the SDD migrations applied and seeded fixtures. Verifies SQL, unique constraints, RLS, and upsert idempotency. | `apps/psg-hub/src/app/api/**/*.integration.test.ts` |
| E2E | Playwright | One ops happy path per milestone, browser-driven against a seeded staging stack. | `apps/psg-hub/e2e/**/*.spec.ts` |
| Migration | Vitest + Python `pytest` | Reconciliation and spot-check assertions on the v1.3.5 ETL worker output. | `psg-data-lake/tests/test_fm_migrate.py` and `apps/psg-hub/src/lib/migration/*.test.ts` |

### 1.2 Approach by subsystem

- Survey scoring and eligibility are pure functions with high behavioral risk. Cover them exhaustively at the unit level first, then prove the SQL path at the integration level.
- API routes get integration tests against a test Supabase project (a dedicated branch of `gylkkzmcmbdftxieyabw`, never production). Each cron and ops route runs against applied migrations and seed fixtures.
- The mail vendor webhook and external calls (Lob, SendGrid, Twilio, FileMaker Data API) are mocked at the unit and integration levels. Lob test mode drives the v1.3 E2E happy path.
- E2E proves the wired happy path only; it is not the place for branch-coverage of classification or eligibility.

### 1.3 Commands

```bash
pnpm test                                  # Vitest 4 (unit + component + integration)
pnpm --filter=psg-hub exec playwright test # E2E
pnpm lint && pnpm typecheck                # static gates, run before tests in CI
python -m pytest psg-data-lake/tests/      # migration worker (v1.3.5)
```

## 2. Coverage Expectations and Quality Bars

Coverage and quality thresholds come straight from the SDD Quality Requirements and PLANNING.md Quality Gates. They are gates, not targets.

| Bar | Threshold | Source | Verified by |
|-----|-----------|--------|-------------|
| Vitest line coverage (new code) | ≥ 70% lines | PLANNING Quality Gates | CI coverage report on changed files |
| `classifySurvey` branch coverage | 100% of the six alert classes | SDD classifySurvey example | Unit test matrix (§4.1) |
| Eligibility + suppression branch coverage | in-window and out-of-window, with and without open alert | SDD suppression SQL | Unit + integration (§4.2) |
| LCP on `/ops/*` and `/ops/reports/*` | < 3s | SDD Performance; PLANNING | Playwright trace + Lighthouse in E2E |
| Cron completion | eligibility-compute and survey-ingest each < 5 min over full population | SDD Performance | Integration timing assertion on full-size fixture |
| Idempotency | zero double-sends; re-running any cron or print produces no new rows or sends | SDD Reliability | Integration re-run assertions (§4.3, §4.4) |
| Unmatched-survey rate | visible and < 2% after migration reconciliation | SDD Reliability + Migration integrity | Migration reconciliation (§5) |
| Migration count reconciliation | repair_customers ≈ 281K, survey_responses ≈ 334K within tolerance | SDD Migration integrity | Reconciliation checks (§5) |
| Customer↔survey link spot check | 50 links resolve correctly | SDD Migration integrity | Spot-check fixture (§5) |
| Webhook idempotency | every webhook handler keyed; replayed events are no-ops | PLANNING Webhook idempotency | Integration replay test (§4.5) |
| Import validation | every import validates against its `import_templates` mapping | PLANNING Import validation | Integration test on import endpoint |
| PII review | manual sign-off | SDD Security; PLANNING | Sign-off checklist (§6) |

Tolerance for migration counts: ± 0.5% per entity, with every excluded row logged and attributed to a known DDR data issue (stale external references per SDD Risks). Counts outside tolerance block cutover.

## 3. Acceptance Criteria (EARS), by subsystem

Each criterion below is an EARS statement traceable to the SDD Acceptance Criteria, expanded into the concrete test cases that prove it. AC IDs are stable references for the test suite.

### 3.1 Surveys + alerts (v1.1 / v1.4)

| AC | EARS statement | Test cases |
|----|----------------|------------|
| AC-S1 | WHEN a survey is ingested, THE SYSTEM SHALL resolve its `repair_customer_id` and set `alert_class` using the DDR classification rules. | UT-CLS-1..6 (§4.1); IT-INGEST-1 (resolves FK then classifies); IT-INGEST-2 (falls back to `legacy_match_key` during migration) |
| AC-S2 | IF a survey cannot be matched to a repair customer, THEN THE SYSTEM SHALL retain it and surface it in a needs-match queue. | UT-MATCH-1 (§4.5); IT-INGEST-3 (row kept, FK null, appears in needs-match queue, not dropped) |
| AC-S3 | WHILE a company has `referral_tracking_enabled` false, THE SYSTEM SHALL classify an otherwise-referral survey as `misfire`, not `referral`. | UT-CLS-2 and UT-CLS-5 (§4.1) |
| AC-S4 | IF a repair customer is on `credit_hold`, THEN THE SYSTEM SHALL NOT classify the survey as `referral`. | UT-CLS-5b (§4.1) |

### 3.2 Eligibility + suppression (v1.3)

| AC | EARS statement | Test cases |
|----|----------------|------------|
| AC-E1 | WHEN eligibility is computed, THE SYSTEM SHALL exclude any customer with an open survey alert in the window and record `suppressed_by_alert`. | UT-SUP-1, UT-SUP-2 (§4.2); IT-ELIG-1 (suppressed row has `eligible=false`, `suppressed_by_alert=true`) |
| AC-E2 | THE SYSTEM SHALL never create a duplicate letter for the same customer, `letter_kind`, and period. | UT-ELIG-IDEM-1 (§4.2); IT-ELIG-2 (re-run yields no new `letter_eligibility` row; `ON CONFLICT DO NOTHING` holds) |
| AC-E3 | WHEN eligibility is computed, THE SYSTEM SHALL use RO completion date, not survey date, for the window. | IT-ELIG-3 (customer with old survey but in-window `ro_completed_at` is eligible; SDD gotcha) |

### 3.3 Production (v1.3)

| AC | EARS statement | Test cases |
|----|----------------|------------|
| AC-P1 | WHEN a batch is printed, THE SYSTEM SHALL transition only `unprinted` documents to `printed` and stamp `printed_at`. | UT-PRINT-1 (§4.3); IT-PRINT-1 |
| AC-P2 | WHEN a batch print is re-run, THE SYSTEM SHALL skip documents already `printed` and return `skipped_already_printed`. | UT-PRINT-2 (§4.3); IT-PRINT-2 (second run prints 0, skips all) |
| AC-P3 | WHEN Lob returns a status, THE SYSTEM SHALL update the matching `mail_vendor_jobs` row. | IT-LOB-1 (HMAC-verified event updates status); IT-LOB-2 (bad signature rejected, no update) |
| AC-P4 | WHEN a Lob webhook event is replayed, THE SYSTEM SHALL treat it as a no-op. | IT-LOB-3 (§4.5) |

### 3.4 Reports (v1.4)

| AC | EARS statement | Test cases |
|----|----------------|------------|
| AC-R1 | THE SYSTEM SHALL serve all 26 reports from a parameter-driven engine, including Perfect Score, Mis-Fire, Hot Spot, Unresolved Issue, and Referral Noted. | IT-RPT-1 (each of 26 slugs returns rows + meta for a seeded range); IT-RPT-2 (the five survey-response reports filter to their `alert_class`) |
| AC-R2 | WHEN a report runs over a 12-month range, THE SYSTEM SHALL return within the LCP and report-cache budget. | IT-RPT-3 (Redis cache hit on second run); E2E-RPT timing |

### 3.5 Migration (v1.3.5, optional)

| AC | EARS statement | Test cases |
|----|----------------|------------|
| AC-M1 | WHERE the migration add-on is enabled, THE SYSTEM SHALL load historical entities and reconcile counts to the DDR before cutover. | MT-COUNT-1..6 (§5) |
| AC-M2 | WHERE legacy keys are present, THE SYSTEM SHALL resolve `legacy_match_key` to a real `repair_customer_id` and retain the legacy key for reconciliation. | MT-LINK-1 (50-link spot check, §5) |
| AC-M3 | IF a survey row cannot resolve to a repair customer during migration, THEN THE SYSTEM SHALL load it with a null FK into the needs-match queue and count it toward the unmatched rate. | MT-UNMATCH-1 (unmatched rate < 2%, §5) |

## 4. Unit Test Cases

All inputs below name the exact SDD fields. The `classifySurvey` cases use the precise gate logic from the SDD example: `wouldRecommend`, `unresolvedShop`, `csiResolve`, `referralConsumer`, `referralTrackingEnabled` (on the company), and `creditHold`.

### 4.1 Survey alert classification (`src/lib/surveys/scoring`)

Gate order from the SDD `classifySurvey`:

1. `happy = wouldRecommend && !unresolvedShop`
2. `happy && referralConsumer && company.referralTrackingEnabled && !creditHold` → `referral`
3. `happy && csiResolve === 1` → `perfect`
4. `happy && csiResolve < 1` → `misfire`
5. `unresolvedShop` → `unresolved`
6. `csiResolve < 1` → `hotspot`
7. else → `none`

One case per alert class, each chosen so exactly one gate fires. Columns name the SDD fields directly; `referralTrackingEnabled` and `creditHold` live on the company/customer the survey resolves to.

| ID | Class | wouldRecommend | unresolvedShop | csiResolve | referralConsumer | referralTrackingEnabled | creditHold | Expected `alert_class` | Gate fired |
|----|-------|----------------|----------------|------------|------------------|-------------------------|------------|------------------------|-----------|
| UT-CLS-1 | perfect | true | false | 1 | false | true | false | `perfect` | gate 3 (happy, not referral, csi == 1) |
| UT-CLS-2 | misfire | true | false | 0.8 | false | true | false | `misfire` | gate 4 (happy, csi < 1: satisfied, would-recommend, not perfect = missed referral) |
| UT-CLS-3 | hotspot | false | false | 0.6 | false | true | false | `hotspot` | gate 6 (not happy, not unresolved, csi < 1) |
| UT-CLS-4 | unresolved | true | true | 0.5 | false | true | false | `unresolved` | gate 5 (unresolvedShop true; fires before gate 6) |
| UT-CLS-5 | referral | true | false | 1 | true | true | false | `referral` | gate 2 (happy, referralConsumer, tracking on, not on hold) |
| UT-CLS-6 | none | false | false | 1 | false | true | false | `none` | gate 7 (not happy, not unresolved, csi not < 1) |

Two branch cases prove the company/customer gates on the otherwise-referral input from UT-CLS-5:

| ID | Branch | wouldRecommend | unresolvedShop | csiResolve | referralConsumer | referralTrackingEnabled | creditHold | Expected `alert_class` | Why | AC |
|----|--------|----------------|----------------|------------|------------------|-------------------------|------------|------------------------|-----|----|
| UT-CLS-5b | tracking off blocks referral | true | false | 1 | true | false | false | `perfect` | gate 2 blocked by `referralTrackingEnabled = false`; csi == 1 falls to gate 3 | AC-S3 |
| UT-CLS-5c | credit hold blocks referral | true | false | 1 | true | true | true | `perfect` | gate 2 blocked by `creditHold = true`; csi == 1 falls to gate 3 | AC-S4 |

Run the matrix as a single parameterized Vitest suite so any future change to gate order fails loudly.

### 4.2 Eligibility suppression and idempotency (`src/lib/eligibility`)

| ID | Scenario | Setup | Expected |
|----|----------|-------|----------|
| UT-SUP-1 | In-window, open alert → suppressed | `ro_completed_at` in the three_month window; one `survey_responses` row with `alert_class <> 'none'` and `alert_posted_at` within 120 days | `eligible = false`, `suppressed_by_alert = true` |
| UT-SUP-2 | In-window, no alert → eligible | same window; no open alert row | `eligible = true`, `suppressed_by_alert = false` |
| UT-SUP-3 | In-window, only `none` alert → eligible | window; survey row with `alert_class = 'none'` | `eligible = true` (the SDD join excludes `alert_class = 'none'`) |
| UT-ELIG-IDEM-1 | Re-compute, no duplicate | run `compute` twice for the same customer, `letter_kind = three_month`, same `period_key` | second run creates no new `letter_eligibility` row (UNIQUE on `repair_customer_id, letter_kind, period_key`) |

### 4.3 Idempotent print (`src/lib/production`)

| ID | Scenario | Setup | Expected |
|----|----------|-------|----------|
| UT-PRINT-1 | First print | batch with 3 `unprinted` documents | all 3 → `printed`, each `printed_at` stamped; returns `{ printed: 3, skipped_already_printed: 0 }` |
| UT-PRINT-2 | Re-run skips printed | re-run print on the same batch | 0 transitioned; returns `{ printed: 0, skipped_already_printed: 3 }`; `printed_at` values unchanged |
| UT-PRINT-3 | Mixed state | batch with 2 `printed`, 1 `unprinted` | returns `{ printed: 1, skipped_already_printed: 2 }` |

### 4.4 Eligibility idempotency at the service boundary

| ID | Scenario | Setup | Expected |
|----|----------|-------|----------|
| UT-ELIG-IDEM-2 | Same customer, two cron runs | two `eligibility-compute` invocations, same customer + `letter_kind` + `period_key` | exactly one `letter_eligibility` row exists after both runs |
| UT-ELIG-IDEM-3 | New period creates new row | second run with a different `period_key` (new cycle bucket) | a second row is created; the first is untouched |

### 4.5 Unmatched survey and webhook replay

| ID | Scenario | Setup | Expected |
|----|----------|-------|----------|
| UT-MATCH-1 | Unmatched survey lands in queue | ingest a survey whose `repair_customer_id` cannot be resolved by FK or `legacy_match_key` | row retained, FK null, flagged for needs-match; never dropped |
| UT-MATCH-2 | Later match clears the queue | a previously unmatched survey gets a resolvable customer on re-ingest | FK populated, `alert_class` computed, removed from needs-match |
| UT-LOB-REPLAY | Webhook replay is a no-op | apply the same Lob event twice (same event id) | first updates `mail_vendor_jobs.status`; second changes nothing |

## 5. Migration Test and Reconciliation Plan (v1.3.5)

The migration worker (`psg-data-lake/fm_migrate.py`) is tested in two layers: `pytest` on the transform/load logic, and Vitest integration assertions on the loaded Supabase state. Reconciliation runs per entity in the SDD sequencing order: master data → companies/employees → repair_customers → ROs/estimates → survey_responses → production history. Each step must pass before the next runs.

### 5.1 Count reconciliation

| ID | Entity | Check | Pass condition |
|----|--------|-------|----------------|
| MT-COUNT-1 | repair_customers | loaded row count vs DDR | ≈ 281K within ± 0.5%; every excluded row logged with reason |
| MT-COUNT-2 | survey_responses | loaded row count vs DDR | ≈ 334K within ± 0.5% |
| MT-COUNT-3 | companies / employees | loaded vs DDR master data | exact match (small reference sets) |
| MT-COUNT-4 | repair_orders / estimates | loaded vs DDR | within ± 0.5% |
| MT-COUNT-5 | production history | loaded vs DDR | within ± 0.5% |
| MT-COUNT-6 | excluded-row ledger | every skipped row attributed | 100% of exclusions map to a known DDR data issue (stale external references per SDD Risks) |

### 5.2 Link spot check

| ID | Check | Method | Pass condition |
|----|-------|--------|----------------|
| MT-LINK-1 | 50 customer↔survey links resolve correctly | sample 50 surveys with non-null `legacy_match_key`; assert each resolved `repair_customer_id` points to the customer the legacy key encoded (shop-id + month + year) | all 50 resolve to the correct customer |
| MT-UNMATCH-1 | Unmatched rate after load | count surveys with null `repair_customer_id` / total loaded surveys | < 2% (SDD Reliability bar); remainder sit in the needs-match queue, none dropped |
| MT-LEGACY-1 | Legacy key retained | assert `legacy_match_key` preserved on migrated repair_customers | retained for reconciliation only, never used as a live join key post-cutover |

### 5.3 Migration test sources

Tests source from the DDR CSV exports plus the FileMaker Data API read path, never a developer workstation path (SDD gotcha). The worker must tolerate the absence of the known stale external references (BridgeSystem path, EmployeeSatisfaction, Import Flush2, dormant `PSG_SurveyExport_07.1`) without failing the load.

## 6. PII Review Gates

PII review is a manual sign-off, not an automated test. Each gate blocks its milestone until signed.

| Gate | Milestone | Scope of review | Sign-off |
|------|-----------|-----------------|----------|
| PII-1 | v1.1 | New ops tables (`repair_customers`, `survey_responses` extensions, `letter_eligibility`) follow `psg_sensitive_pii_*` redaction; RLS clamps customer data to authorized shops; `security_profiles.functions_jsonb` gates ops functions; survey `raw_payload` redacted. | Manual sign-off recorded before v1.1 ships |
| PII-2 | v1.3 | Production data path (batch documents, mail-merge content, `mail_vendor_jobs`) carries end-consumer PII to Lob/SendGrid safely; vendor secrets encrypted at rest (pgsodium); no PII in logs. | Manual sign-off recorded before v1.3 cutover |
| PII-3 | v2.0 | Final convergence PII audit across customer + ops + internal paths; redaction parity with existing patterns confirmed; access_audit append-only trail verified. | Manual sign-off recorded before public launch posture |

Each sign-off uses a written checklist attached to the milestone, names the reviewer, and is the gate of record for the SDD Security requirement and the PLANNING PII review gate.

## 7. E2E Happy Paths (Playwright)

One ops happy path per milestone, browser-driven against a seeded staging stack, with an LCP assertion on `/ops/*` and `/ops/reports/*` (< 3s).

| ID | Milestone | Happy path | Key assertions |
|----|-----------|------------|----------------|
| E2E-OPS | v1.1 | Create company → add employees → import RO | company persists; import validates against `import_templates`; RO appears; LCP < 3s |
| E2E-PROD | v1.3 | Company has program → repair customer assigned → batch generated → printed → moved to historical → reprintable | batch builds; print is idempotent on re-run; Lob test-mode webhook updates status; reprint writes audit |
| E2E-RPT | v1.4 | Open `/ops/reports` → run a survey-response report (e.g. Mis-Fire) over a 12-month range → export | report renders with correct `alert_class` filter; export downloads; LCP < 3s; second run hits Redis cache |
| E2E-CONV | v2.0 | Convergence suite across customer + ops + internal happy paths | all milestone happy paths pass together; AEGIS + PII final review green |

## 8. Test Data and Environments

- Test Supabase project: a dedicated branch of `gylkkzmcmbdftxieyabw` with the SDD migrations applied. Never run integration tests against production.
- Seed fixtures: roles, modules, `security_profiles`, master data via `node apps/psg-hub/scripts/seed.mjs`, plus a fixture set of companies (varying `referral_tracking_enabled`), repair customers (some on `credit_hold`), surveys spanning all six alert classes, and a batch with mixed print state.
- External services: Lob test mode for the v1.3 E2E path; SendGrid, Twilio, and the FileMaker Data API mocked at unit and integration levels.
- Full-population timing fixtures: a synthetic dataset sized to the DDR counts (≈ 281K customers, ≈ 334K surveys) to assert cron completion < 5 min.

## 9. Traceability Summary

| SDD Acceptance Criterion | EARS AC | Primary test cases |
|--------------------------|---------|--------------------|
| Resolve FK + set alert_class | AC-S1 | UT-CLS-1..6b, IT-INGEST-1/2 |
| Unmatched survey retained + queued | AC-S2 | UT-MATCH-1/2, IT-INGEST-3 |
| Exclude open-alert customer + record suppression | AC-E1 | UT-SUP-1/2/3, IT-ELIG-1 |
| Never duplicate a letter | AC-E2 | UT-ELIG-IDEM-1/2/3, IT-ELIG-2 |
| Print only unprinted + stamp | AC-P1/P2 | UT-PRINT-1/2/3, IT-PRINT-1/2 |
| Lob status updates job | AC-P3/P4 | IT-LOB-1/2/3, UT-LOB-REPLAY |
| 26 parameter-driven reports | AC-R1/R2 | IT-RPT-1/2/3, E2E-RPT |
| Migration loads + reconciles | AC-M1/M2/M3 | MT-COUNT-1..6, MT-LINK-1, MT-UNMATCH-1 |
