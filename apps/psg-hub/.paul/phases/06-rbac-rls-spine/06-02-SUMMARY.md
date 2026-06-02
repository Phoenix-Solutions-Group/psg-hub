---
phase: 06-rbac-rls-spine
plan: 02
subsystem: database
tags: [rbac, rls, supabase, postgres, security-definer, migrations-as-code, authz]

# Dependency graph
requires:
  - phase: 06-rbac-rls-spine (06-01)
    provides: path-A forks, migrations-as-code link, S1 PROTOCOL + S4 CHECKLIST, read-only schema baseline
provides:
  - app_user_roles (3-role CHECK vocab), security_profiles (functions_jsonb), superadmin_emails — RLS-on default-deny
  - private.current_user_role() / current_user_has_fn() — no-hook role resolvers
  - 3 existing helpers hardened (fixed search_path)
  - superadmin bootstrap (Nick + Tina live; Brian on-signup) + extended handle_new_user
affects: [06-03-middleware-app-reconcile, 07-tier-gating-shop-switcher, 08-launch-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: [no-hook in-DB security-definer role resolution, private-schema helpers with search_path='', RLS-on-no-policy default-deny, email-allowlist superadmin bootstrap, db-push history-stub alignment]

key-files:
  created:
    - apps/psg-hub/supabase/migrations/20260602163208_app_user_roles_security_profiles.sql
    - apps/psg-hub/supabase/migrations/20260602163210_rbac_helpers.sql
    - apps/psg-hub/supabase/migrations/20260602163212_superadmin_bootstrap.sql
    - apps/psg-hub/supabase/migrations/{00001,20260429133000,20260429170000,20260601162129,20260601174021}_*.sql (5 history stubs)
  modified: [.paul/STATE.md]

key-decisions:
  - "superadmins = Nick + Tina + Brian (operator added Tina/Brian at review); Claire excluded"
  - "db push needs local files for ALL remote versions -> 5 empty history stubs (non-destructive)"
  - "new private resolvers granted authenticated/service_role only; revoked from public"

patterns-established:
  - "Role resolution = private.current_user_role()/current_user_has_fn() security-definer subqueries, no JWT hook"
  - "New authz tables born RLS-on with zero anon/auth policy (default-deny); service-role bypasses"

# Metrics
duration: ~45min
started: 2026-06-02T16:25:00Z
completed: 2026-06-02T17:10:00Z
---

# Phase 6 Plan 02: RBAC + RLS DB Spine Summary

**Pushed the v0.2 authorization spine LIVE to the shared prod project under the S1 review gate: a CHECK-constrained 3-role model, greenfield ops-capability table, no-hook security-definer resolvers, hardened existing helpers, and an idempotent superadmin bootstrap (Nick/Tina live, Brian on-signup) — with zero new security-advisor findings.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~45 min |
| Started | 2026-06-02T16:25:00Z |
| Completed | 2026-06-02T17:10:00Z |
| Tasks | 4 (3 auto + 1 checkpoint:human-verify) |
| Files modified | 8 new migrations (3 spine + 5 stubs) + STATE.md; 3 migrations applied to prod |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Migration history reconciled so db push works | Pass | Baseline repaired `applied`; 5 history stubs added (db push needs local files for ALL remote versions); proved push clean with throwaway test (created→dropped→reverted→deleted); residual_test_tables=0. |
| AC-2: Authz tables + helpers (default-deny, hardened) | Pass | 3 tables RLS-on, zero anon/auth policy; CHECK=(customer/psg_internal/psg_superadmin); resolvers in `private` with search_path=''; 3 existing helpers hardened AND verified still execute (0/0/false under service-role — no broken qualification). |
| AC-3: Idempotent superadmin bootstrap | Pass | superadmin_emails={nick,tina,bfinn}; granted psg_superadmin = Nick+Tina (Brian 0 auth rows → on-signup via handle_new_user); Claire 0 superadmin rows, legacy profiles.role='admin' untouched; new-signup default=customer; on-conflict guards = idempotent. |
| AC-4: Live verification — deny-by-default, no new advisor finding | Pass | anon context → current_user_role()=null, current_user_has_fn=false. Advisor diff: +3 INFO rls_enabled_no_policy (intended default-deny, only findings naming my objects), −3 function_search_path_mutable; 6 ERRORs all pre-existing; 0 new ERROR/WARN; new private resolvers correctly absent from executable-security-definer findings. |

## Verification Results

- `supabase migration list` — 3 new versions (163208/163210/163212) on remote; baseline + 5 historical aligned; no residual test version.
- Live `execute_sql`: tables_rls all true; CHECK def correct; allowlist=[bfinn,nick,tina]; granted=[nick,tina]→psg_superadmin; brian_auth_rows=0; claire_superadmin_rows=0; claire_legacy_profiles_role='admin'; role_no_identity=null; hasfn_no_identity=false.
- Hardened helpers execute: user_shop_ids()=0, user_location_ids()=0, user_is_shop_owner(zero-uuid)=false (no error).
- `get_advisors(security)`: 133 findings; vs baseline +3 rls_enabled_no_policy (mine, intended), −3 function_search_path_mutable; ERROR=6 (5 sec-def-view + spatial_ref_sys, all pre-existing).

## Accomplishments

- Authorization spine is LIVE on shared prod with deny-by-default, proven by live read-only checks — not asserted.
- No-hook design realized: role/capability resolve via `private` security-definer subqueries; zero project-global token surface (adv-portal + Claire's tokens untouched).
- First real DDL on a 314k-PII shared DB shipped through migrations-as-code + an operator SQL-review gate, with a clean advisor diff.

## Task Commits

Not committed — operator commits at/after UNIFY (project convention; branch `chore/phase-3-integrations`). No atomic per-task commits.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `..._app_user_roles_security_profiles.sql` | Created+applied | 3 authz tables, RLS-on default-deny |
| `..._rbac_helpers.sql` | Created+applied | private resolvers + harden 3 existing helpers |
| `..._superadmin_bootstrap.sql` | Created+applied | seed Nick/Tina/Brian; extend handle_new_user |
| 5 × `<historical>_*.sql` | Created | empty history stubs (db-push alignment) |
| `.paul/STATE.md` | Modified | decisions, APPLY log, loop position |
| prod schema (`gylkkzmcmbdftxieyabw`) | Applied | 3 migrations live |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Superadmins = Nick + Tina + Brian (operator added Tina/Brian at review) | Operator call at the human-verify checkpoint | Tina granted now; Brian on-signup (no auth row); Claire excluded |
| 5 empty history stubs instead of repairing the 5 historical as reverted | db push (like pull) requires local files for ALL remote versions; reverted would be the wrong direction + a needless write | Repo has a complete named migration trail; zero remote write for the stubs |
| Resolvers in `private`, granted authenticated/service_role only | Avoids executable-security-definer-in-exposed-schema finding; least privilege | Confirmed absent from advisor's anon/authenticated_security_definer findings |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Non-destructive history-alignment fix |
| Scope additions | 1 | Operator-directed allowlist expansion |
| Deferred | 0 | — |

**Total impact:** Both essential; no scope creep beyond the plan's intent.

### Auto-fixed Issues

**1. [History] db push required local files for all 5 remote versions**
- **Found during:** Task 1
- **Issue:** After marking the baseline applied, `db push` still errored "Remote migration versions not found in local migrations directory" — it enforces the same strict check as `db pull`, for all 5 historical versions.
- **Fix:** Created 5 empty stub files (already-applied markers; push skips them). Zero remote write.
- **Verification:** `migration list` shows full alignment; test migration pushed clean.

### Deferred Items

None.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| db push strict history check (5 historical versions) | 5 empty stub files (above) |
| Hardened helpers needed runtime proof, not just proconfig inspection | Ran all 3 live — execute cleanly |

## Next Phase Readiness

**Ready:**
- Role model + resolvers + bootstrap live → 06-03 can build the customer-id middleware gate (reads `current_user_role()` + `user_shop_ids()`) and reconcile phantom-table app code onto `shop_users`.
- Phase 7 tier gating can consume `app_user_roles` (orthogonal to tier).

**Concerns:**
- **Fresh-replay trap (stubs):** the 5 stubs are empty; on a fresh `db reset`/new environment the real historical schema lives ONLY in `20260602105554_remote_schema.sql` (baseline dump). Works for current prod; fragile for CI reproducibility. 06-03 (or whoever owns CI) should decide whether to backfill real DDL into the stubs or document the reset path.
- **Non-seeded users resolve `current_user_role()=NULL`** (Claire + any non-superadmin in the 3-row pool). Expected — 06-03 owns membership reconcile + customer backfill (today only Nick has a `shop_users` row). Claire's "removal" = NULL role + untouched vestigial `profiles.role='admin'`; operator can veto at this UNIFY if a stronger removal was intended.
- **Pre-existing (not this plan):** public helpers (`user_shop_ids`/`user_location_ids`/`user_is_shop_owner`/`handle_new_user`) are anon-executable security-definer (8+8 advisor findings) — revoke-anon hardening candidate for a later phase.

**Blockers:** None.

---
*Phase: 06-rbac-rls-spine, Plan: 02*
*Completed: 2026-06-02*
