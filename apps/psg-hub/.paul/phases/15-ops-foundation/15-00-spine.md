# Phase 15 / 15-00 — v1.1 Ops Foundation (spine)

**Milestone:** v1.1 Ops Foundation · **Issue:** [PSG-25](/PSG/issues/PSG-25) · **Parent plan:** [PSG-22](/PSG/issues/PSG-22#document-plan) · **Target:** 2026-06-30

The internal-ops backbone every other ops milestone (v1.2–v1.5) depends on. Greenfield from
the Advantage tech-design spec (`projects/psg-hub/PLANNING.md` §Ops backbone v1.1). Builds on the
v0.2 RBAC/RLS spine; **no new vendor gate**; runs parallel with FileMaker (dual-entry until v1.3).

## 15-00 delivered (this slice — the spine)

- **DB schema** `20260618170000_ops_foundation_v1_1.sql` — full v1.1 ops + master-data model:
  `companies, employees, repair_customers, repair_orders, estimates, company_programs,
  import_templates, products, items, vehicles, insurance_companies, insurance_agents`.
  Named security-profile model: `security_profile_defs` (catalog, built-in **Administrator** seeded)
  + `user_security_profile_assignments`. Default-deny RLS on every table, gated by
  `private.current_user_has_fn('manage_companies' | 'manage_sysconfig')`. `current_user_has_fn`
  extended (additive, non-breaking) to honor both the legacy per-user `security_profiles`
  fast-path AND assigned named profiles. Shared `set_updated_at()` trigger + access-path indexes.
- **RBAC ops guard** `src/lib/auth/ops-access.ts` — `getOpsAccess`, pure `hasOpsFn`/`isOpsStaff`,
  and `requireOpsFn(fn)` route guard (fail-closed 401/403 before RLS). Unit-tested (7 tests).
- **`/ops/*` shell** — `src/app/ops/{layout,page}.tsx` (staff-only, `notFound()` for non-staff;
  capability-aware module grid).
- **Companies vertical (proof-of-pattern)** — `src/app/api/companies/route.ts`
  (GET list / POST create, `manage_companies`-gated, zod-validated) +
  `src/app/ops/companies/page.tsx` + `src/components/ops/new-company-form.tsx`.

**Verification:** `vitest` ops-access suite green (7/7); `tsc --noEmit` clean for all new files
(pre-existing `lib/production/__tests__/lob.test.ts` errors are unrelated concurrent v1.3 work).

## Remaining v1.1 (tracked as PSG-25 child issues)

1. Companies detail + employees + programs (CRUD/customizations)
2. Repair Customers + ROs (list/detail/add-new/preview/cancel/add-additional-document)
3. Estimates (list/detail)
4. Surveys (entry + view; extends v0.3 `survey_responses`)
5. SysConfig master-data CRUD (products, items, vehicles, insurance companies/agents)
6. RO/Estimate Import (absorb `psg-import`: template field-mapping + validation; retire the app)
7. Security Profiles admin surface (assign named profiles) — coordinates with v1.5 matrix
8. Playwright ops happy path (create company → add employees → import RO)
