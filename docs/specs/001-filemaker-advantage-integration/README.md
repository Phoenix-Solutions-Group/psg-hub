---
title: "FileMaker Advantage → psg-hub Integration — Spec Package"
status: draft
version: "1.0"
---

# FileMaker Advantage → psg-hub Integration

This spec package defines how PSG's legacy FileMaker Advantage Program (the Advantage, Survey, Import Flush, and Web files) is re-platformed into psg-hub as native ops modules, plus the optional historical data migration. It follows the spec-driven workflow: SPECIFY → PLAN → TASKS → IMPLEMENT.

The behavioral source of truth is the DDR analysis in `agents/CIO/FileMaker-Analysis-2026-06-08/`. This package turns that analysis into a build the team can execute.

## Read in this order

| # | Document | Purpose |
|---|----------|---------|
| 1 | `spec.md` | PRD: objective, users, scope by milestone, 31 functional requirements, success criteria, boundaries, open questions |
| 2 | `solution-design.md` | SDD: architecture, schema deltas, interfaces, runtime flows, ADR summary, acceptance criteria |
| 3 | `plan.md` | Implementation plan: components, build order, milestone mapping, parallel vs sequential, risks |
| 4 | `tasks.md` | Discrete tasks per milestone with acceptance + verify + files |
| 5 | `schema/migrations.md` | Forward-only Postgres DDL for the table deltas |
| 6 | `test-plan.md` | Test strategy, EARS acceptance criteria, concrete unit cases, migration reconciliation |
| 7 | `data-migration-runbook.md` | Optional v1.3.5 historical migration runbook |
| 8 | `adr/ADR-001..005.md` | Standalone architecture decision records (all Proposed) |

## What this replaces

| FileMaker subsystem | psg-hub target | Milestone |
|---------------------|----------------|-----------|
| Advantage letters + print/production | Production module + Lob/SendGrid + `production_batches` | v1.3 |
| Survey scoring + Perfect/Misfire/HotSpot/Unresolved/Referral alerts | Survey module + scoring service + `survey_responses` | v1.1 / v1.4 |
| Time-based eligibility + survey suppression | `letter_eligibility` + eligibility cron | v1.1 / v1.3 |
| 26 operational reports | Parameter-driven report engine | v1.4 |
| Import Flush (325 per-shop importers) | `import_templates` + psg-import | v1.1 |
| Web PSOS scheduler | Vercel cron | v1.1+ |
| Historical data (281K customers, 334K surveys) | Supabase via psg-data-lake worker | v1.3.5 (optional) |

## Status

Draft. The five ADRs are Proposed and need Nick's sign-off before implementation. Open questions are listed in `spec.md` (OQ-1..OQ-5): migration scope, source of `referral_tracking_enabled` / `credit_hold`, which alert-script generation is authoritative, the Lob vs in-house mail split, and the end-consumer PII retention policy.

## Key decisions (see adr/ for full records)

1. Re-platform behavior, do not port FileMaker code or schema 1:1.
2. Replace the composite string match key with a real foreign key.
3. Move automation to Vercel cron + idempotent Postgres workers.
4. Make the survey-alert suppression rule explicit and auditable.
5. Treat historical migration as an optional v1.3.5 add-on.

## Provenance

Derived from the DDR dated 2025-05-27 and the analysis pack at `agents/CIO/FileMaker-Analysis-2026-06-08/`. Aligned to `PLANNING.md` (71 design decisions, ops milestones v1.1–v1.4, Q15).
