---
title: "FileMaker Advantage Integration — Task Breakdown"
status: draft
version: "1.0"
---

# Task Breakdown

Discrete, dependency-ordered tasks grouped by milestone. Paths are under `apps/psg-hub/...`. Terminology matches the SDD exactly (`letter_eligibility`, `alert_class`, `suppressed_by_alert`, `printed_at`, `period_key`, `legacy_match_key`).

Conventions used by every task:

- DB column `profile_id` (not `user_id`).
- Migrations are forward-only and additive.
- Every cron is idempotent and window-based.
- Every ops route is gated by `security_profiles.functions_jsonb`.
- Project commands: `pnpm typecheck`, `pnpm test` (Vitest 4), `pnpm --filter=psg-hub exec playwright test`, `supabase migration up`, `node scripts/seed.mjs`.

---

## Milestone v1.1 — Ops Foundation

### Schema and RBAC

- [ ] Task: Add `letter_eligibility` table migration
  - Acceptance: table has `id`, `repair_customer_id` (fk repair_customers), `letter_kind` enum (three_month, six_month, one_year, eighteen_month, two_year, birthday, drivers_license, thank_you, referral), `eligible` bool, `suppressed_by_alert` bool, `period_key`, `printed_at` timestamptz null, `computed_at`; UNIQUE (repair_customer_id, letter_kind, period_key)
  - Verify: `supabase migration up` applies clean; `\d letter_eligibility` shows the unique constraint
  - Files: `supabase/migrations/<ts>_create_letter_eligibility.sql`

- [ ] Task: Extend `survey_responses` with classification + idempotency columns
  - Acceptance: adds `repair_customer_id` (fk, nullable), `alert_class` enum (perfect, misfire, hotspot, unresolved, referral, none), `csi_resolve` numeric, `would_recommend` bool, `unresolved_shop` bool, `referral_consumer` bool, `alert_posted_at` timestamptz null, `referral_letter_posted_at` timestamptz null; INDEX idx_survey_match (repair_customer_id, submitted_at)
  - Verify: `supabase migration up` clean; insert/select round-trips each column
  - Files: `supabase/migrations/<ts>_extend_survey_responses.sql`

- [ ] Task: Extend `repair_customers` with match + referral columns
  - Acceptance: adds `legacy_match_key` text (indexed), `referral_tracking_enabled` bool, `credit_hold` bool
  - Verify: `supabase migration up` clean; index exists on `legacy_match_key`
  - Files: `supabase/migrations/<ts>_extend_repair_customers.sql`

- [ ] Task: Extend `company_programs` with `referral_tracking_enabled`
  - Acceptance: adds `referral_tracking_enabled` bool; `customizations_jsonb` already holds logo/header/footer/greeting (no change)
  - Verify: `supabase migration up` clean
  - Files: `supabase/migrations/<ts>_extend_company_programs.sql`

- [ ] Task: Add ops-backbone table migrations (companies, employees, repair_orders, estimates, import_templates)
  - Acceptance: `companies`, `employees`, `repair_orders`, `estimates`, `import_templates` created per PLANNING Data Model; `repair_orders.ro_completed_at` present for eligibility windowing; FKs wired
  - Verify: `supabase migration up` clean; `list_tables` shows all five
  - Files: `supabase/migrations/<ts>_create_ops_backbone.sql`

- [ ] Task: Add master-data table migrations (products, items, vehicles, insurance_companies, insurance_agents)
  - Acceptance: five master-data tables per PLANNING SysConfig section
  - Verify: `supabase migration up` clean
  - Files: `supabase/migrations/<ts>_create_master_data.sql`

- [ ] Task: Add `security_profiles` + assignments migration and RLS gating
  - Acceptance: `security_profiles` (id, name, is_builtin, functions_jsonb), `user_security_profile_assignments`; RLS on ops tables gated by `functions_jsonb` flags for psg_internal; psg_superadmin bypass
  - Verify: `supabase migration up` clean; RLS policy present on `companies`
  - Files: `supabase/migrations/<ts>_create_security_profiles.sql`, `supabase/migrations/<ts>_ops_rls_policies.sql`

- [ ] Task: Seed roles, modules, and built-in Administrator security profile
  - Acceptance: seed inserts the Administrator profile granting all flags (manage_companies, manage_repair_customers, manage_surveys, manage_production, manage_reports, manage_sys_config, manage_data_imports, manage_users); ops modules registered
  - Verify: `node scripts/seed.mjs` runs idempotently; query shows Administrator with all flags true
  - Files: `scripts/seed.mjs`

### Ops CRUD

- [ ] Task: Companies + employees + programs endpoints
  - Acceptance: `/api/ops/companies` (list/create), `/api/companies/[id]` (get/update/delete), `/api/companies/[id]/employees`, `/api/companies/[id]/programs`; Zod validation; gated by `manage_companies`
  - Verify: `pnpm test` covers handler happy + denied path; manual create persists with RLS
  - Files: `src/app/api/ops/companies/route.ts`, `src/app/api/ops/companies/[id]/route.ts`, `src/app/api/ops/companies/[id]/employees/route.ts`, `src/app/api/ops/companies/[id]/programs/route.ts`

- [ ] Task: Repair customers + repair orders endpoints
  - Acceptance: `/api/ops/repair-customers` (+ `[id]`), `/api/ops/repair-orders` (+ `[id]`); list/filter/sort/search; gated by `manage_repair_customers`
  - Verify: `pnpm test`; manual add-new RO links to repair_customer
  - Files: `src/app/api/ops/repair-customers/route.ts`, `src/app/api/ops/repair-customers/[id]/route.ts`, `src/app/api/ops/repair-orders/route.ts`, `src/app/api/ops/repair-orders/[id]/route.ts`

- [ ] Task: Estimates + surveys (entry/view) endpoints
  - Acceptance: `/api/ops/estimates` (+ `[id]`), `/api/ops/surveys` (+ `[id]`) for entry and view; survey entry writes the classification source columns; gated by `manage_surveys`
  - Verify: `pnpm test`; survey entry persists `csi_resolve`, `would_recommend`, etc.
  - Files: `src/app/api/ops/estimates/route.ts`, `src/app/api/ops/estimates/[id]/route.ts`, `src/app/api/ops/surveys/route.ts`, `src/app/api/ops/surveys/[id]/route.ts`

- [ ] Task: Master-data (sys-config) CRUD endpoints
  - Acceptance: `/api/ops/sys-config/{products,items,vehicles,insurance-companies,insurance-agents}` CRUD each; gated by `manage_sys_config`
  - Verify: `pnpm test` on one resource; manual CRUD on each
  - Files: `src/app/api/ops/sys-config/products/route.ts`, `src/app/api/ops/sys-config/vehicles/route.ts`, `src/app/api/ops/sys-config/insurance-companies/route.ts`, `src/app/api/ops/sys-config/insurance-agents/route.ts`, `src/app/api/ops/sys-config/items/route.ts`

- [ ] Task: `import_templates` importer (absorbs psg-import, replaces 325 per-shop scripts)
  - Acceptance: `/api/ops/import-templates` (+ `[id]`) for per-company `field_mapping_jsonb`; `/api/ops/repair-orders/import` and `/api/ops/estimates/import` accept upload (xlsb/xlsx/csv/txt), validate against template, load rows, surface row-level errors; gated by `manage_data_imports`
  - Verify: `pnpm test` on mapping validation; manual RO import from sample xlsx loads and reports a deliberate bad row
  - Files: `src/lib/import/templateImporter.ts`, `src/app/api/ops/import-templates/route.ts`, `src/app/api/ops/repair-orders/import/route.ts`, `src/app/api/ops/estimates/import/route.ts`

- [ ] Task: Ops UI route group skeleton
  - Acceptance: `/ops/{companies,repair-customers,repair-orders,estimates,surveys,sys-config}` list/detail pages behind the ops shell; reuse the dashboard component pattern; desktop-first
  - Verify: `turbo run build --filter=psg-hub`; pages render gated by security profile
  - Files: `src/app/(ops)/ops/companies/page.tsx`, `src/app/(ops)/ops/repair-customers/page.tsx`, `src/app/(ops)/ops/repair-orders/page.tsx`, `src/app/(ops)/ops/surveys/page.tsx`, `src/app/(ops)/ops/layout.tsx`

### Survey scoring + ingest

- [ ] Task: Survey scoring service (`classifySurvey`)
  - Acceptance: pure function returning `alert_class` from `csi_resolve`, `would_recommend`, `unresolved_shop`, `referral_consumer`, plus per-company `referral_tracking_enabled` and `credit_hold`; encodes the v3 LIVE DDR rules exactly (perfect, misfire, hotspot, unresolved, referral, none)
  - Verify: `pnpm test` with a case table covering all six classes incl. referral gate (referral_tracking_enabled true and credit_hold false) and misfire (satisfied, would-recommend, csi_resolve < 1)
  - Files: `src/lib/surveys/scoring/classifySurvey.ts`, `src/lib/surveys/scoring/classifySurvey.test.ts`

- [ ] Task: Survey ingest cron worker
  - Acceptance: `/api/cron/survey-ingest` pulls new `survey_responses` since watermark, resolves `repair_customer_id` (FK; fall back to `legacy_match_key` during migration), runs `classifySurvey`, stamps `alert_posted_at`; unmatched rows kept with null FK and queued; returns counts `{ingested, classified:{...} }`; cron-secret header auth
  - Verify: `pnpm test` on the worker; seeded run classifies and stamps; re-run does not double-stamp; unmatched row appears in needs-match query
  - Files: `src/app/api/cron/survey-ingest/route.ts`, `src/lib/surveys/ingest.ts`

- [ ] Task: Needs-match queue surface
  - Acceptance: `/api/ops/surveys/needs-match` lists surveys with null `repair_customer_id`; `/ops/surveys/needs-match` page lets an account manager assign the FK; assignment re-runs classification for that row
  - Verify: `pnpm test`; manual assign resolves a queued survey and clears it from the queue
  - Files: `src/app/api/ops/surveys/needs-match/route.ts`, `src/app/(ops)/ops/surveys/needs-match/page.tsx`

### Eligibility + suppression

- [ ] Task: Eligibility service with suppression rule
  - Acceptance: computes per `letter_kind` over the RO completion-date window (3/6/12/18/24 month, birthday, drivers_license); excludes any customer with an open survey alert in the window and sets `suppressed_by_alert=true`; uses `ro_completed_at` not survey date; upserts idempotently on `(repair_customer_id, letter_kind, period_key)`
  - Verify: `pnpm test` covering eligible, suppressed-by-open-alert, and no-duplicate-on-rerun
  - Files: `src/lib/eligibility/compute.ts`, `src/lib/eligibility/windows.ts`, `src/lib/eligibility/compute.test.ts`

- [ ] Task: Eligibility-compute cron worker
  - Acceptance: `/api/cron/eligibility-compute` accepts optional `{ letter_kind }` (all kinds if omitted), calls the eligibility service, returns `{ computed, eligible, suppressed }`; idempotent; cron-secret header auth; freshness alert if prior `computed_at` stale beyond 36h
  - Verify: `pnpm test`; two consecutive runs produce no duplicate `letter_eligibility` rows
  - Files: `src/app/api/cron/eligibility-compute/route.ts`

- [ ] Task: v1.1 verification — Playwright happy path
  - Acceptance: E2E creates a company, adds employees, imports an RO from a sample file, enters a survey, confirms classification, runs eligibility, and asserts a `suppressed_by_alert` row when an open alert exists
  - Verify: `pnpm --filter=psg-hub exec playwright test ops-foundation`
  - Files: `tests/e2e/ops-foundation.spec.ts`

---

## Milestone v1.3 — Production + Cutover

- [ ] Task: Mail adapter interface + Lob and in-house adapters
  - Acceptance: shared `MailAdapter` interface; `LobAdapter` (Lob API + address verification) and `InHouseAdapter` (PDF generate to print handoff); per-template/per-shop vendor selection; writes `mail_vendor_jobs` with vendor enum (lob, inhouse)
  - Verify: `pnpm test` mocks both adapters; selection logic picks vendor per template
  - Files: `src/lib/production/mail/MailAdapter.ts`, `src/lib/production/mail/LobAdapter.ts`, `src/lib/production/mail/InHouseAdapter.ts`, `src/lib/production/mail/selectVendor.ts`

- [ ] Task: Production batch build service + endpoint
  - Acceptance: `/api/ops/production/batches` (list/create) builds from eligible customers given `{ name (unique), product_ids[], company_ids[]|null }`; each `production_document` gets a unique `print_id`; returns `{ batch_id, document_count }`; gated by `manage_production`
  - Verify: `pnpm test`; build over seeded eligibility yields documents with distinct `print_id`
  - Files: `src/lib/production/buildBatch.ts`, `src/app/api/ops/production/batches/route.ts`

- [ ] Task: Idempotent print transition endpoint
  - Acceptance: `/api/ops/production/batches/[id]/print` sets `production_documents.status=printed`, `printed_at=now()`, `printed_by_profile_id` only where `status=unprinted`; returns `{ printed, skipped_already_printed }`
  - Verify: `pnpm test` asserts second print run reports `skipped_already_printed` equal to first run's `printed` and changes nothing
  - Files: `src/lib/production/printBatch.ts`, `src/app/api/ops/production/batches/[id]/print/route.ts`

- [ ] Task: Reprint with audit + historical search
  - Acceptance: `/api/ops/production/documents/[id]/reprint` writes `production_reprint_log` (document_id, reprinted_by_profile_id, reprinted_at); `/api/ops/production/historical` searches by batch name, print_id, company, product, repair customer
  - Verify: `pnpm test`; reprint creates a log row; historical search returns by print_id
  - Files: `src/app/api/ops/production/documents/[id]/reprint/route.ts`, `src/app/api/ops/production/historical/route.ts`

- [ ] Task: Lob status webhook
  - Acceptance: `/api/webhooks/lob` verifies HMAC signature, is idempotent on event id, updates the matching `mail_vendor_jobs.status`; returns 200
  - Verify: `pnpm test` with a signed fixture event updates status; replayed event is a no-op
  - Files: `src/app/api/webhooks/lob/route.ts`, `src/lib/production/mail/lobWebhook.ts`

- [ ] Task: Production UI (Outlook-inspired layout) + cutover
  - Acceptance: `/ops/production` (batch list left, document list right), `/ops/production/new` (batch wizard), `/ops/production/historical`; explicit confirm + dry-run before print (irreversible mail spend); cutover points production team at psg-hub, FileMaker read-only
  - Verify: `turbo run build --filter=psg-hub`; manual batch-to-print flow with confirm gate
  - Files: `src/app/(ops)/ops/production/page.tsx`, `src/app/(ops)/ops/production/new/page.tsx`, `src/app/(ops)/ops/production/historical/page.tsx`

- [ ] Task: v1.3 verification — Playwright happy path
  - Acceptance: E2E builds a batch from an eligible customer, prints it (only unprinted transition), moves to historical, reprints with audit, and asserts a Lob webhook updates `mail_vendor_jobs`
  - Verify: `pnpm --filter=psg-hub exec playwright test production`
  - Files: `tests/e2e/production.spec.ts`

---

## Milestone v1.4 — Operational Reports

- [ ] Task: Report engine framework
  - Acceptance: `/api/ops/reports/[reportSlug]` parameter-driven runner (date range + filters); uses `pg` pool plus Redis cache, not PostREST; supports CSV/Excel/PDF export; gated by `manage_reports`
  - Verify: `pnpm test` on the runner with a stub query; cache hit on repeat call
  - Files: `src/lib/reports/engine.ts`, `src/lib/reports/cache.ts`, `src/app/api/ops/reports/[reportSlug]/route.ts`, `src/app/(ops)/ops/reports/page.tsx`

- [ ] Task: First report end to end — Perfect Score
  - Acceptance: `perfect-score` report queries surveys with `alert_class='perfect'` over the date range; rows match a hand-checked query; renders in the report index and exports
  - Verify: `pnpm test` asserts row set equals expected over seeded data; LCP < 3s on 12-month range
  - Files: `src/lib/reports/reports/perfectScore.ts`, `src/app/(ops)/ops/reports/[reportSlug]/page.tsx`

- [ ] Task: Survey-alert reports batch (mis-fire, hot-spot, unresolved-issue, referral-noted, referral-comparison)
  - Acceptance: each slug queries by its `alert_class`; `referral-comparison` compares referral volume across periods; all served by the engine
  - Verify: `pnpm test` per slug over seeded data
  - Files: `src/lib/reports/reports/misFire.ts`, `src/lib/reports/reports/hotSpot.ts`, `src/lib/reports/reports/unresolvedIssue.ts`, `src/lib/reports/reports/referralNoted.ts`, `src/lib/reports/reports/referralComparison.ts`

- [ ] Task: Volume + invoicing + CSI report batches (remaining 20 slugs)
  - Acceptance: the remaining PLANNING report slugs (processing-recap, invoicing-recap, reprint-recap, pay-type-analysis, vehicle-analysis-make/model, referral-directory, recap-trailing, agent-capture, agent-sales, claims-review, audit, name-recap-by-shop, monthly-csi-display, performance-dashboard, market-dashboard, estimator-csi, body-tech-performance, painter-performance, survey-alert-recap, rental-car-analysis) each resolve through the engine
  - Verify: `pnpm test` smoke per slug; all 26 slugs resolve from the index
  - Files: `src/lib/reports/reports/volumeInvoicing.ts`, `src/lib/reports/reports/csi.ts`, `src/lib/reports/reports/customerInsurance.ts`, `src/lib/reports/registry.ts`

- [ ] Task: v1.4 verification — Playwright happy path
  - Acceptance: E2E opens the report index, runs the Perfect Score report with a date range, and exports it
  - Verify: `pnpm --filter=psg-hub exec playwright test reports`
  - Files: `tests/e2e/reports.spec.ts`

---

## Milestone v1.3.5 — Migration (optional)

> Built only if the optional add-on is triggered (PLANNING Q15, SDD ADR-5). Functional replacement (v1.1 to v1.4) does not depend on it. Files are under `psg-data-lake/`, not `apps/psg-hub/`.

- [ ] Task: Migration extract readers (DDR CSV + FileMaker Data API)
  - Acceptance: `fm_extract` reads DDR CSV exports and the FileMaker Data API; tolerates absent stale references (BridgeSystem, EmployeeSatisfaction, Import Flush2, PSG_SurveyExport_07.1); never sources from a workstation path
  - Verify: `python -m pytest psg-data-lake/tests/test_fm_migrate.py -k extract`
  - Files: `psg-data-lake/fm_extract/csv_reader.py`, `psg-data-lake/fm_extract/data_api.py`

- [ ] Task: Match-key resolution + PII redaction + dedupe transform
  - Acceptance: `fm_transform` resolves `legacy_match_key` to `repair_customer_id` FKs, redacts PII per `psg_sensitive_pii_*` patterns, dedupes
  - Verify: `python -m pytest psg-data-lake/tests/test_fm_migrate.py -k transform`
  - Files: `psg-data-lake/fm_transform/resolve_keys.py`, `psg-data-lake/fm_transform/redact.py`

- [ ] Task: Migration orchestrator + reconciliation
  - Acceptance: `fm_migrate.py` runs extract to transform to load in the sequenced order (master data, companies/employees, repair_customers, ROs/estimates, survey_responses, production history); reconciles counts to the DDR before each next step
  - Verify: `python psg-data-lake/fm_migrate.py --entity repair_customers --dry-run`; counts reconcile (repair_customers approx 281K, survey_responses approx 334K); 50-link spot-check resolves; unmatched rate under 2 percent
  - Files: `psg-data-lake/fm_migrate.py`, `psg-data-lake/tests/test_fm_migrate.py`
