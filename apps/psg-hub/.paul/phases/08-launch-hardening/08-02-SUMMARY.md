---
phase: 08-launch-hardening
plan: 02
subsystem: database
tags: [rls, supabase, postgres, multi-tenant, pii, security, migrations-as-code]

requires:
  - phase: 06-rbac-rls-spine
    provides: PROTOCOL-migration-safety (S1 gate), CHECKLIST-rls-review (S4), private.current_user_role(), app_user_roles + shop_users spine, user_shop_ids() resolver
  - phase: 07-tier-gating-shop-switcher
    provides: active-shop context + membership-validated reads that depend on scoped shops policies
provides:
  - Cross-tenant authenticated breach closed on 12 shared multi-tenant public tables
  - shops scoped survivors retightened {public} -> {authenticated}
  - profiles self-row SELECT/UPDATE + psg_superadmin read (option A)
  - clients + 9 sibling/agentic tables default-deny (service-role-only)
  - M2 PII gate satisfied for v0.2 pilot onboarding onto live data
affects: [08-03-aegis, 08-04-quality-gates, v0.3-mso, onboarding, pilot-go-live]

tech-stack:
  added: []
  patterns: [blanket-allow remediation under permissive-OR, inline-rollback migration comment, advisor-diff gate, RLS impersonation proof via request.jwt.claims]

key-files:
  created:
    - supabase/migrations/20260603194623_close_blanket_allow_rls.sql
  modified:
    - .paul/STATE.md

key-decisions:
  - "T1: deny-all-9 (drop both blanket policies on all 9 sibling/agentic tables -> default-deny)"
  - "T1: profiles option A (self-row SELECT/UPDATE + psg_superadmin read)"
  - "No redeploy: RLS is DB-side; migration alone closes the breach on the running prod app"

patterns-established:
  - "Blanket-allow remediation: never drop a blanket policy on a no-survivor table without a same-migration scoped replacement OR a confirmed default-deny verdict"
  - "Advisor re-capture + diff at apply time (not against the dated PROTOCOL snapshot)"

duration: ~2 sessions (plan+grounding 2026-06-03; APPLY T1-T3 2026-06-03; T4 human-verify 2026-06-04)
started: 2026-06-03T19:00:00Z
completed: 2026-06-04T00:00:00Z
---

# Phase 8 Plan 02: Blanket-allow RLS Remediation Summary

**Closed the cross-tenant `authenticated` breach on 12 shared multi-tenant `public` tables on prod `gylkkzmcmbdftxieyabw` — one idempotent migration dropping 24 blanket `Allow all` policies, retightening `shops` survivors to `authenticated`, adding `profiles` self-row + superadmin read, and defaulting `clients` + 9 sibling tables to deny. M2 PII gate now satisfied.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2 sessions (T1-T3 2026-06-03; T4 verify 2026-06-04) |
| Started | 2026-06-03T19:00:00Z |
| Completed | 2026-06-04T00:00:00Z |
| Tasks | 4 completed (1 decision, 2 auto, 1 human-verify) |
| Files modified | 2 (1 migration created, STATE.md) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Cross-tenant authenticated breach closed | Pass | RLS impersonation proof: customer (5d6a) sees 1 shop / 1 profile / 0 clients — 0 cross-tenant rows. |
| AC-2: psg-hub member flows unbroken | Pass | Operator human-verify on hub.psgweb.me — dashboard/settings/ads/reviews render, no 500, no empty-shop regression. |
| AC-3: anon fully denied on remediated tables | Pass | anon impersonation 0/0/0 on shops/profiles/clients; blanket-anon gone, no replacement grants anon. |
| AC-4: PROTOCOL advisor gate clean | Pass | `rls_policy_always_true` 26->2; 0 new ERROR/WARN (ERROR steady 6; WARN 74->50 = -24 dropped; INFO +10 = intended default-deny tables). |
| AC-5: Migration PROTOCOL-compliant | Pass | migrations-as-code (`supabase migration new` + `db push` clean), one transaction, idempotent (drop if exists / create), inline rollback comment block in header. |

## Accomplishments

- Closed the literal Phase-8 entry condition: any logged-in shop could previously read/write every tenant's rows in `profiles`, `shops`, `clients`, `reviews`, and 8 more. That cross-tenant hole is gone — pilot onboarding onto live PII can proceed.
- Dropped 24 blanket `Allow all` policies (anon + authenticated pair) across 12 tables in a single idempotent, reversible migration.
- Retightened `shops` scoped survivors (`shops_select` / `shops_update`, qual `id in (select user_shop_ids())`) from `{public}` to `{authenticated}`; anon (null `auth.uid()` -> empty shop set) is denied.
- `profiles` option A: self-row SELECT/UPDATE (`id = (select auth.uid())`) + `psg_superadmin` read via `private.current_user_role()`; no INSERT policy (handle_new_user is SECURITY DEFINER, RLS-bypassing).
- `clients` + 9 sibling/agentic tables -> default-deny (RLS-on, no policy, service-role-only).
- Resolves D3 (deferred from 06-01, FIXED-to-Phase-8).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260603194623_close_blanket_allow_rls.sql` | Created | Drops 24 blanket policies on 12 tables; retightens shops survivors to authenticated; profiles self-row + superadmin read; clients + 9 siblings default-deny. Inline rollback SQL in header comment. |
| `.paul/STATE.md` | Modified | APPLY 08-02 execution log + T1 decision recorded to `### Decisions`. |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| T1: deny-all-9 (default-deny all 9 sibling tables) | 9 tables empty/stale (no writes since Mar 20), zero psg-hub refs, consuming apps retired (local_reach Phase 5, old `data` portal Phase 3). | Closes every blanket hole in one pass; any future reader gets an explicit scoped policy at its milestone. Inline rollback per table if an unknown anon consumer surfaces. |
| T1: profiles option A (self-row + superadmin read) | Superadmin (Nick) needs cross-profile read for ops; self-row covers normal members; highest-PII table. | Nick sees 4 profiles (intended); customer sees 1 (own). |
| No redeploy for the policy change | RLS is DB-side on the same shared prod DB as the running hub.psgweb.me app; Task 2 touched no app code. | Migration alone closed the breach live; no `vercel --prod` needed. |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 0 | No anon hole carried forward — deny-all-9 closed the full set. |

**Total impact:** Plan executed as written. T1 chose the full-close option (deny-all-9), so no deferred/known-open anon hole remains — the M2 gate closes completely rather than partially.

### Deferred Items

None — plan executed exactly as written. (T1 option `deny-confirmed-defer-public` was NOT chosen; no table deferred.)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Cross-tenant proof needed without writing rows | Used RLS impersonation (request.jwt.claims / scoped read) — customer 1/1/0, Nick 1/4/0, anon 0/0/0 — proven read-only, no test-row writes. |

## Skill Audit

No `.paul/SPECIAL-FLOWS.md` present — skill audit skipped.

## Next Phase Readiness

**Ready:**
- M2 PII gate satisfied — prod safe for a real shop to log in with live PII.
- RLS spine + remediation complete; cross-tenant isolation proven on the core multi-tenant tables.

**Concerns:**
- 9 sibling/agentic tables are now default-deny. When their consuming features land (v0.3+ MSO, agentic surfaces), each needs an explicit scoped policy — the blanket fallback is gone (by design). Rollback SQL in the migration header restores any single table if an unknown anon consumer surfaces.
- `reports` retains a benign `Service role full access` policy (service-role bypasses RLS regardless) — out of scope, noted.

**Blockers:**
- None.

---
*Phase: 08-launch-hardening, Plan: 02*
*Completed: 2026-06-04*
