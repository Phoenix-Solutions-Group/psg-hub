---
phase: 06-rbac-rls-spine
plan: 01
subsystem: database
tags: [supabase, rls, rbac, migrations-as-code, security-definer, postgres]

# Dependency graph
requires:
  - phase: 03-integrations
    provides: shared Supabase project gylkkzmcmbdftxieyabw with email_events/sms_events migrations (versions 4-5 of the 5 baselined)
provides:
  - operator decisions for the Phase-6 architecture forks (path-A locked)
  - repo↔project link + a read-only in-repo schema baseline (migrations-as-code foundation)
  - S1 migration-safety protocol + S4 RLS-review checklist (the gate 06-02 DDL must pass)
affects: [06-02-rbac-rls-db-spine, 06-03-middleware-app-reconcile, 08-launch-hardening]

# Tech tracking
tech-stack:
  added: [supabase CLI (pinned devDependency ^2.104)]
  patterns: [migrations-as-code (in-repo SQL migrations are the ONLY DDL path; MCP read-only-inspection only), no-hook in-DB security-definer authority, private-schema security-definer helpers]

key-files:
  created: [apps/psg-hub/supabase/config.toml, apps/psg-hub/supabase/migrations/20260602105554_remote_schema.sql, apps/psg-hub/supabase/.gitignore, .paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md, .paul/phases/06-rbac-rls-spine/CHECKLIST-rls-review.md]
  modified: [apps/psg-hub/package.json, pnpm-lock.yaml, .paul/STATE.md]

key-decisions:
  - "path-A: no-hook in-DB security-definer subquery (D2) + shared-mutate on public schema (D1)"
  - "D3 defer 26 anon policies to Phase 8 (fixed); D4 per-shop; D5 profiles.role vestigial"
  - "Superadmin bootstrap = Nick only; Claire removed; Brian not provisioned"
  - "db pull unusable → substituted read-only db dump for the schema baseline (zero prod write)"

patterns-established:
  - "Migrations-as-code: every DDL change to gylkkzmcmbdftxieyabw is a reviewed in-repo migration; MCP execute_sql/apply_migration is read-only inspection only"
  - "Post-migration get_advisors(security) diff gate, re-captured at each apply (shared DB drifts)"

# Metrics
duration: ~35min
started: 2026-06-02T10:40:00Z
completed: 2026-06-02T11:05:00Z
---

# Phase 6 Plan 01: RBAC/RLS Forks + Migrations-as-Code S1 Gate Summary

**Resolved the Phase-6 architecture forks (path-A: no-hook + shared-mutate), linked the repo to the shared prod project with a read-only schema baseline (zero prod writes), and committed the S1 migration-safety protocol + S4 RLS-review checklist that all 06-02 customer DDL must pass.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min |
| Started | 2026-06-02T10:40:00Z |
| Completed | 2026-06-02T11:05:00Z |
| Tasks | 3 completed (1 checkpoint:decision + 2 auto) |
| Files modified | 8 (5 created, 3 modified) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Architecture forks resolved and recorded | Pass | path-A (D1=A1 public / D2=no-hook subquery) coherent; D3 fixed-defer; D4 per-shop; D5 vestigial; superadmin=Nick only, Claire removed, Brian not provisioned. Recorded to STATE `### Decisions`; 06-02/06-03 split annotated path-A. |
| AC-2: Migrations-as-code linkage (zero writes) | Pass | Repo linked to gylkkzmcmbdftxieyabw; ONE read-only schema snapshot in supabase/migrations/. MCP list_migrations = exactly the 5 pre-existing versions BEFORE and AFTER (no CLI-injected baseline row); no db push/apply_migration/execute_sql DDL ran. **Deviation:** captured via `db dump` not `db pull` (see below) — same artifact, same zero-write guarantee. |
| AC-3: S1 + S4 protocol docs committed | Pass | PROTOCOL-migration-safety.md (migrations-as-code, read-only-MCP rule, path-A target, advisor baseline + diff gate, hard DO-NOTs) + CHECKLIST-rls-review.md (per-table reader decision, RLS-with-create-table, `to authenticated`, `(select auth.uid())`, shop/fn clamps, `private`-schema security-definer helpers + `SET search_path`, FK profiles(id), idempotency). All required tokens verified; STATE references both. |

## Verification Results

- `ls supabase/migrations/` → exactly one `20260602105554_remote_schema.sql` (14,620 lines); `supabase/config.toml` exists.
- MCP `list_migrations(gylkkzmcmbdftxieyabw)` (pre + post dump) → `00001 location_paperclip_mapping`, `20260429133000 market_viewport_intelligence`, `20260429170000 google_profile_shop_matching`, `20260601162129 create_email_events`, `20260601174021 create_sms_events` — exactly 5, unchanged.
- `git status` → only `M apps/psg-hub/package.json`, `M pnpm-lock.yaml`, `?? apps/psg-hub/supabase/`; `.temp`/`.branches` gitignored; no `src/**` change.
- Token greps on both docs → all required strings present.

## Accomplishments

- Operator forks resolved into one coherent, recorded path (no-hook ⇒ shared-mutate) — unblocks 06-02 DDL design.
- Established migrations-as-code on a shared multi-tenant prod project WITHOUT a single write to it — the S1 gate exists before any customer table lands.
- Two reviewable in-repo gate docs (S1 protocol + S4 checklist) that encode the path-A decisions and the dated advisor baseline.

## Task Commits

Not committed — operator commits at/after this UNIFY (project convention; branch `chore/phase-3-integrations`). No atomic per-task commits this plan.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `apps/psg-hub/supabase/config.toml` | Created | Supabase project config (from `supabase init`) |
| `apps/psg-hub/supabase/migrations/20260602105554_remote_schema.sql` | Created | Read-only schema baseline (14.6k lines); committed, NEVER pushed; 06-02 marks applied |
| `apps/psg-hub/supabase/.gitignore` | Created | Ignore `.branches`/`.temp`/`.env` (local state + secrets) |
| `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` | Created | S1 gate — migrations-as-code workflow, read-only-MCP rule, advisor diff gate, DO-NOTs |
| `.paul/phases/06-rbac-rls-spine/CHECKLIST-rls-review.md` | Created | S4 gate — per-table RLS review checklist |
| `apps/psg-hub/package.json` | Modified | supabase pinned as devDependency |
| `pnpm-lock.yaml` | Modified | lockfile for supabase devDep |
| `.paul/STATE.md` | Modified | Decisions, split annotation, APPLY log, loop position |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| path-A: D2 no-hook in-DB security-definer subquery + D1 shared-mutate (A1 public) | A project-global token hook would rewrite sibling-app (psg-advantage-portal) + Claire's tokens and can't carry the ops functions_jsonb gate; the subquery reuses the clamp already on ~20 prod tables, gives live revocation | 06-02 builds role authority as `private`-schema functions, not JWT claims; 06-03 middleware does a per-request role+shop DB lookup |
| D3 defer 26 anon policies → Phase 8 | Fixed per ROADMAP line 24; dropping them needs a per-app anon-read audit Phase 6 can't do | 26 `Allow all` policies untouched in Phase 6 |
| D4 per-shop; D5 profiles.role vestigial | Matches deployed `shop_users.shop_id` + `user_shop_ids()`; new CHECK-constrained `app_user_roles` is authoritative | No migration of existing profiles.role rows |
| Superadmin = Nick only; Claire removed; Brian not provisioned | Operator: "make sure superadmin is nick"; Brian has no auth row | 06-02 idempotent bootstrap seeds Nick only — **confirm at next checkpoint if Brian/others should be added** |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Mechanism swap, intent + boundaries preserved |
| Scope additions | 0 | — |
| Deferred | 0 | — |

**Total impact:** One essential mechanism deviation; zero scope creep; all ACs met.

### Auto-fixed Issues

**1. [Mechanism] `supabase db pull` unusable → substituted `supabase db dump`**
- **Found during:** Task 2 (migrations-as-code linkage)
- **Issue:** `db pull` refused with "remote migration history does not match local files" (empty local vs 5 remote versions). Its only suggested forward path — `migration repair --status reverted <version>` — is a WRITE to the remote `schema_migrations` table, which the plan's boundary forbids (zero prod write; 06-02 owns baselining).
- **Fix:** Used `supabase db dump` (pure pg_dump) instead — it produces the same single `<ts>_remote_schema.sql` baseline and structurally cannot touch migration history. Required Docker (CLI v2.90 runs pg_dump in a container); operator started Docker.
- **Files:** `apps/psg-hub/supabase/migrations/20260602105554_remote_schema.sql`
- **Verification:** MCP `list_migrations` shows remote unchanged (5 versions) pre + post; no `db push`/`apply_migration` ran.
- **Advisor-vetted:** confirmed sound + zero-write before committing to it.

### Deferred Items

None.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `db pull` history mismatch + prod-write-only forward path | Swapped to read-only `db dump` (above) |
| No local `pg_dump`; Docker daemon initially off | Operator started Docker; `db dump` then succeeded |
| `supabase init` created only `config.toml`, not `migrations/` dir | `mkdir -p supabase/migrations` before dump |
| `migrations-as-code` token grep case-sensitive (had only capitalized) | Added a lowercase occurrence in PROTOCOL §2 |

## Next Phase Readiness

**Ready:**
- path-A decisions locked → 06-02 can design `app_user_roles` (3-role CHECK vocab), greenfield `security_profiles(functions_jsonb)`, `superadmin_emails` (Nick), `current_user_role()`/`current_user_has_fn()` security-definer subqueries in `private` schema, + harden the 3 existing helpers with `SET search_path`.
- migrations-as-code linkage + S1/S4 docs in place → 06-02 DDL is reviewable + gated.

**Concerns:**
- **06-02 history reconcile is non-trivial.** Local `migrations/` has only the 1 baseline file; remote has 5 historical versions with no local files. Before 06-02's first `db push`: `migration repair --status applied <baseline-ts>` (else push replays the 14.6k-line baseline → hard fail), AND likely `repair --status applied` (or local stubs) for the 5 historical versions too (else the same "history does not match" recurs). Use `applied`, NOT the `reverted` the CLI error suggested. 06-02 must prove a trivial test `db push` goes clean after the repair before shipping real DDL.
- Superadmin = Nick only is an interpretation of an ambiguous instruction — re-confirm before the 06-02 bootstrap runs if Brian/others belong.
- Schema baseline exposes sibling-app + `sensitive` schema structure (shared-project reality) — schema only, no row data.

**Blockers:** None.

---
*Phase: 06-rbac-rls-spine, Plan: 01*
*Completed: 2026-06-02*
