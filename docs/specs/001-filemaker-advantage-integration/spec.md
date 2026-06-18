---
title: "FileMaker Advantage → psg-hub Integration"
status: draft
version: "1.0"
---

# Product Requirements Document

This PRD specifies what psg-hub must build to replace the legacy FileMaker Advantage Program with native ops modules. It pairs with the Solution Design Document (`solution-design.md`) as the source of truth for architecture, and with the DDR analysis pack (`agents/CIO/FileMaker-Analysis-2026-06-08/`) as the source of behavior. Where this PRD and the SDD use a term, they use it identically.

## Objective

PSG runs its core customer-experience program on a four-file FileMaker system: time-based customer letters, post-repair surveys, an alert subsystem that classifies each survey, and a feedback loop where an open survey alert removes a customer from routine mail. This system is the daily driver for PSG account managers, the production team, and management reporting. It carries 281K repair customers and 334K surveys, runs on a single server-side scheduler, and depends on fragile composite match keys and date-stamp idempotency.

We are rebuilding that system natively inside psg-hub as ops modules over the shared Supabase schema. We are re-platforming behavior, not porting code. Each FileMaker subsystem maps to an already-planned psg-hub module (Ops backbone, Surveys, Production, Reports, Imports) and table set. The DDR analysis supplies the exact rules those modules must encode: letter eligibility windows, the survey alert classifications, the suppression rule, and the printed/posted idempotency stamps.

Success looks like this. PSG account managers, the production team, and billing ops run their full daily workflow in psg-hub. The survey-to-letter feedback loop runs as Vercel cron plus idempotent Postgres workers, with no double-sends and no silently broken customer-to-survey links. All 26 named reports render from one parameter-driven engine. FileMaker is retired as the daily driver at the v1.3 cutover and stays read-only for historical access. Historical data migration is optional add-on scope (v1.3.5) and does not block functional replacement.

## Users and Personas

The daily drivers are internal PSG staff. End consumers receive mail and surveys but never log in.

| Persona | Role | What they do in psg-hub | Primary milestones |
|---------|------|-------------------------|--------------------|
| Account manager | PSG internal | Manage companies, employees, programs, repair customers, ROs, estimates; enter and review surveys; resolve the needs-match queue | v1.1, v1.4 |
| Production team | PSG internal | Build production batches, print and mail letters via Lob or in-house, manage reprints, search production history | v1.3 |
| Billing ops | PSG internal | Run invoicing and volume reports; reconcile production and pay-type data | v1.4 |
| Strategy | PSG internal | Run CSI, survey-alert, and referral reports; act on Perfect Score, Mis-Fire, Hot Spot, Unresolved Issue, and Referral Noted outcomes | v1.4 |
| Superadmin (Nick, Tina, Brian) | PSG internal | Manage roles, shop assignments, module access, and security profiles that gate ops functions | v1.5 |
| End consumer (repair customer) | External | Receives PSG-printed mail and paper or web surveys; does NOT log in; tracked as a `repair_customers` entity with no UI surface | tracked across all ops milestones |

Access for internal personas is gated by Supabase Auth plus `security_profiles.functions_jsonb` flags (`manage_companies`, `manage_surveys`, `manage_production`, `manage_reports`, `manage_data_imports`, and related flags). RLS clamps customer data to authorized shops.

## Background

The legacy system is four FileMaker files, hub-and-spoke around Advantage. The DDR export dated 5/27/2025 confirms the scale and the wiring (see `03 - Cross-File Architecture Analysis.md`).

| File | Scripts | Core table | Records (approx) | Role |
|------|--------:|------------|-----------------:|------|
| Advantage_06.1 | 1,396 | Repair Customer | 281,077 | Letter engine, data hub |
| Survey_06.1 | 921 | Survey Input | 334,269 | Survey scoring, alerts, reporting |
| Import Flush | 452 | (staging) | ~12 | Per-shop ETL conduit into Advantage |
| Web | 22 | (web aggregate) | ~107,000 | Server-side trigger and scheduler |

Advantage runs time-based customer letters: 3 month, 6 month, 1 year, 18 month, 2 year, birthday, drivers license, thank-you, and referral. Survey scores each post-repair survey and raises one of five alert classes: Perfect, Misfire, Hot Spot, Unresolved, Referral. The two files join on a composite match key, shop or master id plus creation month plus creation year, reconstructed in the DDR from the match-key calcs (`RC_MatchField_survey` on the Advantage side, `S_RC_MatchField_RepairCust` on the Survey side).

The survey-to-letter feedback loop is the load-bearing behavior. A completed survey is scored and classified; the classification reads Advantage `Master Client` flags across the file for the referral and credit-hold gates. The nightly Advantage `SS - Elgibility - *` scripts read the survey alert state live over the relationship and set routine letter eligibility to 0 when an open alert exists. So an open survey alert silently removes a customer from routine mail, with no human in the loop (see `03 - Cross-File Architecture Analysis.md` section 3). Alert and referral letters are produced as batch print runs that stamp post-date fields (`SQ_Alert_PostDate_*`, `S_RC_Referral_Letter_Post`) so the same record is not re-sent.

There is no in-file script-trigger layer to preserve. The DDR confirms 0 layout triggers, 12 object `OnObjectExit` field validations, and 1 in-file PSOS. Automation comes three ways: the Web file firing Perform Script on Server into Advantage eligibility scripts on a FileMaker Server schedule, date-stamp incremental processing, and live cross-file relationship reads (see `03 - Cross-File Architecture Analysis.md` section 4). psg-hub must rebuild this automation as Vercel cron plus Postgres, not port triggers.

The DDR also flagged debt we must not reproduce: 325 per-shop import scripts, triplicate per-letter scripts (Preview/Print/Loop), three live generations of survey alert scripts (v2, WIP, v3 LIVE), a composite string match key that breaks links silently, and stale external references (BridgeSystem, EmployeeSatisfaction, Import Flush2, dormant PSG_SurveyExport_07.1, a broken "Phoenix Solutions Group" reference).

## In-Scope and Out-of-Scope

Scope is organized by milestone. The customer track (v0.1 to v0.4) ships first and is out of scope for this PRD. The ops backbone that replaces FileMaker ships v1.1 to v1.4, with optional historical migration at v1.3.5.

### v1.1 Ops Foundation

In scope: companies, employees, company programs, products, items, repair customers, repair orders, estimates, surveys (entry and view), system-configuration master data (vehicles, insurance companies, insurance agents), RO and estimate import driven by `import_templates` (absorbs psg-import), and security profiles. Parallel run with FileMaker; FileMaker stays authoritative.

Out of scope for v1.1: production batches, mail and email sending, the 26 reports, historical data migration.

### v1.3 Production and FileMaker Cutover

In scope: production batches and documents, the dual mail adapter (Lob.com plus in-house print queue), mail-merge templates, the print queue with idempotent status and reprint audit, historical production search, the survey-ingest and eligibility-compute cron, the suppression rule made explicit, and the v1.3 cutover that points the production team at psg-hub for all new production. FileMaker becomes read-only for history.

Out of scope for v1.3: the 26 reports (v1.4), historical data migration (v1.3.5).

### v1.4 Operational Reports

In scope: the parameter-driven report engine and all 26 named reports, including Perfect Score, Mis-Fire, Hot Spot, Unresolved Issue, Referral Noted, and Referral Comparison, with date-range and filter UI and CSV/Excel/PDF export.

Out of scope for v1.4: new analytical reports beyond the 26; write-back of report results into ops tables.

### v1.3.5 Historical Migration (optional add-on)

In scope if triggered: ETL through `psg-data-lake` that extracts from the DDR CSV exports plus the FileMaker Data API, resolves legacy match keys to foreign keys, redacts PII, dedupes, loads historical entities, and reconciles counts to the DDR (repair_customers ~281K, survey_responses ~334K) before cutover relies on it.

Out of scope for v1.3.5: any change to functional replacement; v1.1 to v1.4 do not depend on this add-on.

### Out of scope for the whole program

- Two-way sync back into FileMaker. psg-hub is downstream only during parallel run; it writes its own data and never writes back to FileMaker.
- End-consumer login. Repair customers receive mail and surveys; they have no UI surface and no account.
- Porting FileMaker scripts or schema 1:1. The four-file split collapses into logical modules on one Supabase schema.
- Recreating stale FileMaker external references (BridgeSystem, EmployeeSatisfaction, Import Flush2, PSG_SurveyExport_07.1, "Phoenix Solutions Group").

## Functional Requirements

Requirements are grouped by subsystem. Each is concrete and testable. Table and column names match the SDD and PLANNING.md.

### Ops backbone

FR-1. The system shall provide CRUD for `companies`, `employees`, and `company_programs`, where a company is the primary internal ops entity with a system-generated unique Shop ID, and a company program enrolls a company in a product with `customizations_jsonb` overrides (logo, header, footer, greeting).

FR-2. The system shall provide CRUD for `repair_customers`, where each record holds end-consumer name, address, phone, and email, and exposes no end-consumer login surface.

FR-3. The system shall provide CRUD plus list, filter, sort, and search for `repair_orders`, including add-new, preview, cancel, and add-additional-document actions, with each RO linked to a repair customer, company, vehicle, insurance company, and insurance agent.

FR-4. The system shall provide CRUD plus list and detail for `estimates`, each linked to a repair customer and company.

FR-5. The system shall provide CRUD for system-configuration master data: `products`, `items`, `vehicles`, `insurance_companies`, and `insurance_agents`.

FR-6. The system shall keep `repair_orders` completion date and `survey_responses` submitted date as distinct date axes, because eligibility windows use RO completion date and never survey date.

### Surveys and alert classification

FR-7. The system shall store surveys in `survey_responses` extended with `repair_customer_id` (a real foreign key replacing the composite string match key), `alert_class`, `csi_resolve`, `would_recommend`, `unresolved_shop`, `referral_consumer`, `alert_posted_at`, and `referral_letter_posted_at`.

FR-8. The system shall resolve each ingested survey to a `repair_customer_id` by foreign key, falling back to `legacy_match_key` during migration, and shall set `alert_class` using the DDR classification rules.

FR-9. The system shall classify each survey into exactly one of `perfect`, `misfire`, `hotspot`, `unresolved`, `referral`, or `none`, applying the DDR thresholds: a satisfied, would-recommend customer with `csi_resolve = 1` is Perfect; satisfied and would-recommend but `csi_resolve < 1` is Misfire (a missed referral); `unresolved_shop` true is Unresolved; a negative result (`csi_resolve < 1`) is Hot Spot; and a happy, would-refer customer is Referral only where the company has `referral_tracking_enabled` and the customer is not on `credit_hold`.

FR-10. The system shall stamp `alert_posted_at` when a survey alert is posted, so the same alert is not re-raised, replacing the FileMaker `SQ_Alert_PostDate_*` date stamps.

FR-11. The system shall retain any survey that cannot be matched to a repair customer, leave its `repair_customer_id` null, and surface it in a needs-match ops queue; the system shall never silently drop an unmatched survey.

FR-12. The system shall seed `referral_tracking_enabled` and `credit_hold` onto `company_programs` and `repair_customers` before classification runs, because the Referral versus Misfire branch reads both and misclassifies every survey if either is missing.

### Letter eligibility and suppression

FR-13. The system shall compute `letter_eligibility` rows for each `letter_kind` (`three_month`, `six_month`, `one_year`, `eighteen_month`, `two_year`, `birthday`, `drivers_license`, `thank_you`, `referral`) by finding repair customers whose RO completion date falls in the kind's date window.

FR-14. The system shall suppress a customer from a routine letter when an open survey alert exists in the window, set `eligible = false` and `suppressed_by_alert = true`, and record the suppression explicitly rather than as an emergent join side effect.

FR-15. The system shall enforce a unique constraint on (`repair_customer_id`, `letter_kind`, `period_key`) and upsert eligibility idempotently, so re-running the compute never creates a duplicate letter for the same customer, letter kind, and period.

FR-16. The system shall stamp `printed_at` on a `letter_eligibility` row only when its letter is produced, replacing the FileMaker `Letter_*_Printed` date stamps, and shall skip rows already stamped.

### Production and mail/email

FR-17. The system shall build a `production_batch` from a set of products and an optional set of companies (blank means all companies), create one `production_document` per generated letter with a unique `print_id`, and return the batch id and document count.

FR-18. The system shall transition only `unprinted` documents to `printed`, stamp `printed_at` and `printed_by_profile_id`, and report counts of printed and skipped-already-printed, so a re-triggered print is idempotent.

FR-19. The system shall send physical mail through a dual `MailAdapter` (Lob.com or in-house print queue), select the vendor per template or per shop, and record each send in `mail_vendor_jobs` with vendor, external job id, and status.

FR-20. The system shall send letter and report email through SendGrid and record each send in `email_jobs`; the system shall send SMS reminders and production-status messages through Twilio and record each in `sms_jobs`.

FR-21. The system shall accept Lob delivery-status webhooks at `/api/webhooks/lob`, verify the HMAC signature, and update the matching `mail_vendor_jobs` row; on a failed vendor send the system shall mark the job failed with the error, leave the document `unprinted`, and retry with backoff.

FR-22. The system shall log every reprint in `production_reprint_log` with the reprinting profile and timestamp.

### Reports engine and the 26 reports

FR-23. The system shall serve reports from one parameter-driven engine at `/api/reports/[reportSlug]` (and `/ops/reports/[reportSlug]`), parameterized by date range and filters, replacing the FileMaker `PDF Generate Report(ReportName)` and `Email Report` scripts.

FR-24. The system shall serve all 26 named reports: `processing-recap`, `invoicing-recap`, `reprint-recap`, `pay-type-analysis`, `vehicle-analysis-make`, `vehicle-analysis-model`, `referral-directory`, `recap-trailing`, `agent-capture`, `agent-sales`, `claims-review`, `audit`, `name-recap-by-shop`, `referral-comparison`, `monthly-csi-display`, `performance-dashboard`, `market-dashboard`, `estimator-csi`, `body-tech-performance`, `painter-performance`, `survey-alert-recap`, `rental-car-analysis`, `perfect-score`, `mis-fire`, `hot-spot`, `unresolved-issue`, and `referral-noted`.

FR-25. The system shall derive the five survey-alert reports (Perfect Score, Mis-Fire, Hot Spot, Unresolved Issue, Referral Noted) and Referral Comparison from `survey_responses.alert_class`, so report output matches the classification used by the feedback loop.

FR-26. The system shall export every report to CSV, Excel, and PDF.

### Imports

FR-27. The system shall drive RO and estimate import from `import_templates`, one per company and kind (`ro` or `estimate`), each holding a `field_mapping_jsonb`, replacing the 325 per-shop FileMaker import scripts.

FR-28. The system shall accept import file uploads (xlsb, xlsx, csv, txt), validate each row against the company's template before load, and absorb the address-validation and smart-resolution logic from psg-import.

FR-29. The system shall source migration imports from the DDR exports and the FileMaker Data API only, never from a developer workstation or a machine-specific local path.

### Automation (cron)

FR-30. The system shall run survey ingest, eligibility compute, production-batch status, and mail-vendor poll as Vercel cron jobs, each idempotent and window-based, replacing the Web file PSOS scheduler.

FR-31. The system shall make each cron self-healing: a missed run recovers on the next run because writes are idempotent upserts on unique constraints, and the system shall raise a freshness alert when `computed_at` is stale beyond 36 hours.

## Non-Functional Requirements

### Performance

NFR-1. LCP shall be under 3 seconds on `/ops/*` and `/ops/reports/*`.

NFR-2. The survey-ingest cron and the eligibility-compute cron shall each complete in under 5 minutes over the full population.

NFR-3. Report queries shall use the `pg` pool plus a Redis cache, not PostgREST, for heavy reads.

### Reliability

NFR-4. Every cron and every webhook handler shall be idempotent, and the system shall guarantee zero double-sends, verified by unique constraints on `letter_eligibility` and by `printed_at` guards on `production_documents`.

NFR-5. The unmatched-survey rate shall be visible in the needs-match queue and shall be under 2 percent after migration reconciliation.

NFR-6. Every external call (Lob, SendGrid, Twilio, FileMaker Data API) shall use retry plus a circuit breaker, with no bare catch that swallows errors.

### Security and PII

NFR-7. Ops tables shall be RLS-gated by `roles` plus `security_profiles.functions_jsonb` for psg_internal users, with psg_superadmin bypass; customer data shall be RLS-clamped to authorized shops.

NFR-8. End-consumer PII in `repair_customers` and survey `raw_payload` shall follow the existing `psg_sensitive_pii_*` redaction patterns; OAuth and vendor secrets shall be encrypted at rest with pgsodium.

NFR-9. PII shall pass a manual sign-off at v1.1, v1.3, and v2.0.

### Auditability

NFR-10. The system shall maintain an append-only `access_audit` trail and shall log production prints, reprints, and cancels separately.

NFR-11. The system shall record outbound communication in `email_jobs`, `sms_jobs`, and `mail_vendor_jobs`, and shall record Python worker runs in `python_worker_jobs`, giving the audit trail FileMaker lacked.

## Success Criteria

Phrased as testable conditions; EARS phrasing where it fits.

SC-1. WHEN a survey is ingested, THE SYSTEM SHALL resolve its `repair_customer_id` and set `alert_class` using the DDR classification rules.

SC-2. IF a survey cannot be matched to a repair customer, THEN THE SYSTEM SHALL retain it and surface it in the needs-match queue, and the unmatched rate SHALL stay under 2 percent after reconciliation.

SC-3. WHEN eligibility is computed, THE SYSTEM SHALL exclude any customer with an open survey alert in the window and record `suppressed_by_alert = true`.

SC-4. THE SYSTEM SHALL never create a duplicate letter for the same `repair_customer_id`, `letter_kind`, and `period_key`.

SC-5. WHEN a batch is printed, THE SYSTEM SHALL transition only `unprinted` documents to `printed` and stamp `printed_at`.

SC-6. WHEN Lob returns a status, THE SYSTEM SHALL update the matching `mail_vendor_jobs` row within one webhook cycle.

SC-7. THE SYSTEM SHALL serve all 26 reports from the parameter-driven engine, and each report SHALL export cleanly to CSV, Excel, and PDF over a 12-month range.

SC-8. THE SYSTEM SHALL keep LCP under 3 seconds on `/ops/*` and `/ops/reports/*`.

SC-9. WHILE the parallel run is active, THE SYSTEM SHALL perform no write back to FileMaker.

SC-10. WHERE the v1.3.5 migration add-on is enabled, THE SYSTEM SHALL load historical entities and reconcile counts to the DDR (repair_customers ~281K, survey_responses ~334K) before cutover relies on the migrated data, and a spot check of 50 customer-to-survey links SHALL resolve correctly.

## Boundaries

### Always

- Always write idempotently. Every cron and webhook uses upserts on unique constraints or status-column guards.
- Always retain unmatched records and queue them; never silently drop a survey or an RO.
- Always keep RO completion date and survey date as distinct axes when computing eligibility.
- Always gate ops functions through `security_profiles.functions_jsonb` and clamp customer data with RLS.
- Always source migration data from the DDR exports and the FileMaker Data API.

### Ask first

- Ask first before any schema change beyond the columns this PRD and the SDD already specify.
- Ask first before changing a survey alert threshold or an eligibility window, since these drive revenue and customer contact.
- Ask first before triggering the v1.3.5 historical migration add-on.
- Ask first before selecting or switching the mail vendor split (Lob versus in-house) for a template or shop.

### Never

- Never write back to FileMaker during the parallel run; psg-hub is downstream only until the v1.3 cutover.
- Never expose an end-consumer login or UI surface for repair customers.
- Never recreate the retired FileMaker debt: the composite string match key, the 325 per-shop import scripts, the triplicate per-letter scripts, or the stale external references.
- Never reproduce the FileMaker date-stamp re-fire risk; a cleared or back-dated stamp must not re-send or skip a letter.

## Open Questions

These remain unresolved and should be answered before the affected milestone locks.

OQ-1 (Q15, migration scope). Is the v1.3.5 historical migration full history or a cutoff date, and what are the audit-retention requirements? Decide only if the optional add-on is triggered.

OQ-2 (source of `referral_tracking_enabled` and `credit_hold`). In FileMaker these were read cross-file from `Master Client` (`M_ReferralNoted_flag`, `M_CreditHold_flag`). Confirm the authoritative source per company and per customer, and confirm where each lands in psg-hub (`company_programs.referral_tracking_enabled` and `repair_customers.credit_hold` per the SDD) before classification runs.

OQ-3 (authoritative alert-script generation). The DDR found three live generations of survey alert scripts (v2, WIP, v3 LIVE). Confirm the v3 LIVE logic is the authoritative source before encoding `classifySurvey`, so the rebuilt classification matches what FileMaker actually ran.

OQ-4 (mail vendor split). Confirm the rule that selects Lob versus the in-house print queue per template or per shop, including any address-verification or cost thresholds that should drive the choice.

OQ-5 (end-consumer PII retention). Confirm the `repair_customers` PII retention policy: hard delete versus anonymize after N days. Tracked as a PLANNING operational open question and needed for the v1.3 PII sign-off.
