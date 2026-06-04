---
phase: 01-workspace-consolidation
plan: 05
type: execute
wave: 2
applied: 2026-05-31
unified: 2026-05-31
result: COMPLETE
acs_passed: 6
acs_partial: 0
acs_total: 6
tasks_passed: 6
tasks_total: 6
checkpoints: 1
---

# 01-05 SUMMARY — BSM dashboard → psg-hub anchor app

**Applied:** 2026-05-31
**Result:** 6/6 tasks executed, 1 checkpoint resolved. **6/6 ACs PASS** (build was initially red on a pre-existing Stripe apiVersion type error; fixed 2026-05-31 → typecheck + build green). Plus 2 HIGH IDOR routes remediated (see Security Remediation below).

**BSM dashboard is now the psg-hub anchor app (D3).** Merged into `apps/psg/apps/psg-hub/`, renamed to `psg-hub`, workspace lockfile generated, BSM Phase 1–5 PAUL history preserved as reference.

## Metrics

| Metric | Value |
|--------|-------|
| BSM source pre-clean | 886 MB → 1 MB (**884 MB freed**: node_modules 794M + .next 89M) |
| BSM PAUL absorbed | 59 files (5 phases + PROJECT/ROADMAP/STATE/paul.json/config/SPECIAL-FLOWS/handoffs + 3 ORIGINAL docs) |
| Original package name | `dashboard` → `psg-hub` |
| .env files dropped | none (only `.env.example` existed — merged; no secrets) |
| pnpm install | 14.6s, 766 packages, lockfile 250638 B at workspace root |
| Workspace members | psg-workspace@0.0.0 + **psg-hub@0.1.0** (recognized) |
| Typecheck | **PASS** (after Stripe apiVersion fix) |
| Build (next build) | **PASS** (exit 0; ✓ compiled 7.1s, 24/24 static pages) |

## Acceptance Criteria Results

| AC | Status | Notes |
|----|--------|-------|
| AC-1 pre-scan documents conflicts | PASS | conflicts (README, .DS_Store) + policy recorded |
| AC-2 BSM PAUL → references/bsm/ | PASS | 59 files, 5 phases, mtime preserved |
| AC-3 BSM merged into psg-hub | PASS | src/ public/ configs landed; .paul/ + README v7 preserved |
| AC-4 package.json renamed | PASS | name=psg-hub; deps/scripts preserved |
| AC-5 install + dev/build smoke | PASS | install ✓ + lockfile ✓ + psg-hub recognized ✓ + typecheck ✓ + build ✓ (after Stripe apiVersion fix) |
| AC-6 BSM siblings untouched | PASS | studio/integrations/onboarding/preview/shops + docs/supabase/PLANNING intact; only dashboard/ removed |

## Files Created/Modified

| Path | Change |
|------|--------|
| `apps/psg-hub/{src/,public/,*.config.*,components.json,package.json,...}` | BSM dashboard merged in (anchor app) |
| `apps/psg-hub/package.json` | name → psg-hub |
| `apps/psg-hub/.paul/references/bsm/` | 59 files BSM PAUL history absorbed |
| `apps/psg/pnpm-lock.yaml` | NEW (250 KB) |
| `apps/psg/node_modules/`, `apps/psg-hub/node_modules/` | installed (gitignored) |
| `projects/psg-hub/.paul-bridge/01-05-pre-scan.md` | pre-scan |
| `archive/_repo-bundles/bsm-dashboard-pre-drop-20260531.bundle` | BSM .git backup (safety) |

## Deviations from Plan

1. **`package-lock.json` excluded from merge** — BSM was an npm project; an npm lockfile is wrong in a pnpm monorepo (root `pnpm-lock.yaml` supersedes). Not in plan's rsync exclude list; added it.
2. **BSM `.git` bundled before drop** — D6 said plain-drop; bundled to `archive/_repo-bundles/bsm-dashboard-pre-drop-20260531.bundle` first (reversible). Result still = dropped from merge.
3. **psg-hub `.git` "unchanged" checks N/A** — collapse (git-strategy decision) already removed psg-hub's nested .git; it is tracked by the root monorepo. rsync excluded `.git` regardless.
4. **BSM uses `src/` layout** (app/components/lib/middleware.ts/styles under src/), not the top-level `app/` the plan's files_modified assumed. rsync copied all; functionally identical.
5. **No `typecheck` script in psg-hub package.json** — ran `tsc --noEmit` directly instead of `pnpm typecheck`. (Follow-up: add a `typecheck` script for turbo pipeline.)

## Deferred Issues

| Issue | Origin | Effort | Notes |
|-------|--------|--------|-------|
| ~~Stripe `apiVersion` type error~~ **RESOLVED 2026-05-31** | 01-05 build | XS | `src/lib/stripe.ts` apiVersion → `"2026-05-27.dahlia"` (match SDK stripe@^22; forward-aligned, zero live customers so low risk). typecheck + build green. |
| **Stray `~/package-lock.json`** confuses Next workspace-root inference | 01-05 build warning | XS | Next picked `/Users/schoolcraft_mbpro/package-lock.json` (HOME, outside repo) as root. Fix: set `turbopack.root` in next.config.ts, or remove the stray home lockfile. Outside this plan's boundary. |
| **BSM `middleware.ts` deprecated in Next 16** | 01-05 build warning | S | Next 16 deprecates `middleware` convention → rename to `proxy`. Address in a later phase. |
| Add `typecheck` script to psg-hub | deviation #5 | XS | For turbo `typecheck` pipeline to work. |

## Next Phase Readiness

**Ready:**
- Workspace has a real lockfile + one recognized app (psg-hub anchor). Wave 2 can continue: 01-06 (BSM siblings → packages), 01-07 (apps/ads → Python worker).
- BSM Phase 1–5 history preserved at `references/bsm/` for D8 foundation reference.

**Concerns:**
- Build is **green** (Stripe apiVersion resolved → `"2026-05-27.dahlia"`). psg-hub typechecks + builds clean (24/24 static pages).
- `~/package-lock.json` will keep mis-rooting Next builds until cleared / `turbopack.root` set.

**Blockers:** None for 01-06/07. The build failure is a captured follow-up, not a relocation blocker.

## Security Remediation (post-merge, 2026-05-31)

Automated security review flagged 2 **HIGH IDOR / missing-auth** issues in BSM-merged code:
- `src/app/api/content/[id]/approve/route.ts`
- `src/app/api/content/[id]/reject/route.ts`

Both POST handlers updated `content_items.status` by `id` with **zero auth** — any caller could approve/reject any item. **Confirmed real** (pre-existing BSM code; only unguarded mutation routes in the app — all ads/billing/reviews routes already gate on `auth.getUser`; stripe webhook uses signature verification).

**Fixed** by mirroring the established in-repo pattern (`reviews/[id]/approve-response/route.ts`):
1. `auth.getUser()` → 401 if unauthenticated
2. load `content_items(id, shop_id)` → 404 if not found
3. `shop_members(profile_id, shop_id).role` → 403 if not a member
4. require role `owner`/`manager` → 403 otherwise
5. mutate via service client after the explicit gate

Verified: `content_items.shop_id` + `shop_members(shop_id, profile_id, role)` exist (BSM migration `001_initial_schema.sql`); both routes typecheck clean (no new errors). Not previously exploitable in prod (zero live customers D57; no deploy — Vercel re-link is v0.1 Phase 3), but would have been a live IDOR at launch.

## Git note
Merge result uncommitted on branch `chore/phase-1-workspace-consolidation`. Commit after UNIFY (or batch with 01-06/07). `.env.example` only — no secrets entered the remote-connected repo.
