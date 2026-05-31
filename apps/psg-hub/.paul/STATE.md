# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.
**Current focus:** Phase 1 Wave 1 complete (01-01..04 LOOP CLOSED 2026-05-31). Next: Wave 2 — 01-05 (BSM relocation), recommended gated on git-strategy decision. Then 01-06/07.

## Current Position

Milestone: v0.1 Foundation (v0.1.0) — In progress
Phase: 1 of 5 (Workspace consolidation + multi-repo relocation) — In progress
Plan: 01-04 LOOP CLOSED ✓ (UNIFY 2026-05-31); 01-01..04 all LOOP CLOSED; Wave 2 pending (01-05/06/07 ready)
Status: Ready for next plan — 01-05 (Wave 2 BSM relocation)
Last activity: 2026-05-31 — 01-04 UNIFY complete, loop closed. (APPLY: local_reach 3.6G → archive/local_reach/ 3.1G, -507.6MB regenerable; Tracy's outputs + 96M sidecar archived.)

Progress:
- Milestone: [░░░░░░░░░░] 0%
- Phase 1: [██████░░░░] 57% (4 of 7 loop-closed; Wave 1 done; Wave 2 01-05/06/07 pending APPLY)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [01-04 LOOP CLOSED 2026-05-31 — Wave 1 complete]
```
Ready for next PLAN: 01-05 (Wave 2 — BSM relocation).

Carry-over to track in next plans:
- Resolved 2026-05-31: workspace-root git strategy = single monorepo (collapse). `apps/psg/.git` is THE monorepo; psg-hub `.git` absorbed (history bundled); `/archive/` + `/psg-import/` + `/api-psghub/` + `/psg-data-lake/` gitignored (root-anchored). Wave 1 committed on branch `chore/phase-1-workspace-consolidation` (NOT pushed).
- Deferred (01-02): `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose) — operator decision needed before Phase 1 close
- Concern (01-01): `.npmrc` warnings from npm (cosmetic; pnpm reads correctly). Optional later cleanup: split to `.pnpmrc`.
- Resolved 2026-05-31: `apps/psg/local-reach-content/` archived via 01-04 (Task 5) — sidecar at archive/local-reach-content/, tracys/ extracted. LOOP CLOSED.

## Phase 1 Plan Split (7 plans, 2 waves) — all created

| Plan | Scope | Wave | Deps | Lines | Status |
|------|-------|------|------|-------|--------|
| 01-01 | Monorepo scaffold (workspace-root configs at `apps/psg/`) | 1 | none | 341 | PLAN ✓ |
| 01-02 | Kill list + non-code relocation to `~/apps/_psg-archive/` (Q23–25) | 1 | none | 377 | PLAN ✓ |
| 01-03 | ads-dashboard PAUL absorb + codebase archive + GitHub archive flag (D70) | 1 | none | 311 | LOOP CLOSED ✓ |
| 01-04 | local_reach archive + active client outputs extracted (D69) + `local-reach-content/` addendum (carryover from 01-02) | 1 | none | 351 | LOOP CLOSED ✓ |
| 01-05 | BSM dashboard relocated to `apps/psg/apps/psg-hub/`; pnpm-lock generated | 2 | 01-01 | 401 | PLAN ✓ |
| 01-06 | BSM siblings → `apps/psg/packages/*` scoped `@psg/*` | 2 | 01-01, 01-05 | 390 | PLAN ✓ |
| 01-07 | `apps/ads/` → `apps/psg/apps/psg-ads-mutations/` Python worker | 2 | 01-01 | 350 | PLAN ✓ |

## Accumulated Context

### Decisions

70 decisions logged in `../../projects/psg-hub/PLANNING.md` (v7). Recent decisions affecting v0.1:

| Decision | Phase | Impact |
|----------|-------|--------|
| D3 — BSM dashboard is the anchor | All | Relocates from `~/apps/projects/bsm/dashboard/` to this directory in Phase 1 |
| D50 — SendGrid + Twilio replace Resend | v0.1 Phase 3 | Email + SMS integration |
| D52 — Python worker = Vercel Sandbox | v1.2 + v1.6 | Consistent runtime |
| D53 — Mail dual adapter (Lob + in-house) | v1.3 | Production module architecture |
| D54 — Retire BSM Vercel, rename portal → psg-hub | v0.1 Phase 3 | Preserve analytics history |
| D55 — Provision new Sanity project | v0.1 Phase 3 | No existing project to inherit |
| D57 — Zero live BSM customers | v0.1 | Hard cutover OK |
| D60 — No fixed launch date | All | Quality-first cadence |
| D61 — Pilot: Wallace + Tedesco + Tracy's | v1.0 | Pilot cohort identity |
| D62 — Strictly sequential post-v1.0 | v1.1+ | Single team scheduling |
| D70 — ads-dashboard reframed to plans/concepts | v0.3 + v0.1 Phase 4 | Absorb intent + PAUL plans only; not code |
| 2026-05-31: local_reach `accidents.db` (2.9G) archived whole, not stripped | Phase 1 / 01-04 | Operator chose option A at checkpoint; archive recoverable, +2.9G workspace |
| 2026-05-31: Workspace git = single monorepo (collapse) | Phase 1 / git strategy | `apps/psg/.git` is THE monorepo; psg-hub absorbed (history → `archive/_repo-bundles/` bundle); psg-import + api-psghub kept independent (own .git, gitignored); Wave 1 committed on branch `chore/phase-1-workspace-consolidation`, not pushed |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Q15 — FileMaker historical migration scope | SEED v7 | M | Only if v1.3.5 add-on triggered |
| First-login UX (tour, empty state, sample data) | SEED v7 | M | v2.0 hardening |
| End-consumer PII retention policy | SEED v7 | S | v0.2 PII review |
| Domain coexistence (`hub.psgweb.me` + `psgweb.me` marketing) | SEED v7 | S | v2.0 launch readiness |
| Workspace-root git strategy — RESOLVED 2026-05-31 → collapse to single monorepo | 01-01 planning | S | Done (see Decisions); not pushed — operator merges to main |
| `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose) — classify | 01-02 APPLY post-state | XS | Decide before Phase 1 close |

### Blockers/Concerns
None yet.

## Boundaries (Active)

From 01-01-PLAN.md:
- `apps/psg/apps/psg-hub/**` — psg-hub directory + .paul/ untouched in 01-01
- `apps/psg/projects/**` — SEED PLANNING.md artifacts immutable post-graduation
- `apps/psg/.paul/codebase/**` — workspace codebase map read-only
- `apps/psg/psg-data-lake/**` — untouched (D14)
- `apps/psg/psg-advantage-portal/**` — untouched in v0.1
- `apps/psg/psg-import/**` — untouched in v0.1
- `apps/psg/api-psghub/**` — reference only
- Anything outside `/Users/schoolcraft_mbpro/apps/psg/`

## Session Continuity

Last session: 2026-05-31
Stopped at: 01-04 LOOP CLOSED (UNIFY complete). Wave 1 done (01-01..04). 4 of 7 Phase-1 plans closed.
Next action: `/paul:apply .paul/phases/01-workspace-consolidation/01-05-PLAN.md` (Wave 2 — BSM relocation). Git strategy RESOLVED (monorepo collapse; Wave 1 committed on branch `chore/phase-1-workspace-consolidation`, not pushed). 01-05 lands BSM as a tracked monorepo app under `apps/`.
Resume file: `.paul/phases/01-workspace-consolidation/01-04-SUMMARY.md`
Resume context:
- Wave 1 complete: 01-01 (scaffold), 01-02 (kill list), 01-03 (ads-dashboard absorb), 01-04 (local_reach + sidecar archive) all LOOP CLOSED. Committed 2026-05-31 as monorepo on branch `chore/phase-1-workspace-consolidation` (not pushed).
- Wave 2: 01-05 (BSM relocation, gated 01-01 ✓), 01-06 (BSM siblings → packages, gated 01-01+01-05), 01-07 (apps/ads → psg-ads-mutations, gated 01-01 ✓).
- Git monorepo: `apps/psg/.git` is THE repo; psg-hub absorbed; `/archive/`, `/psg-import/`, `/api-psghub/`, `/psg-data-lake/` gitignored (root-anchored). psg-hub history bundled at `archive/_repo-bundles/`. Not pushed — operator merges to main when ready.
Git strategy: RESOLVED 2026-05-31 — single monorepo (collapse). `apps/psg/.git` = THE monorepo. **Home repo = `github.com/Phoenix-Solutions-Group/data` CONFIRMED by operator 2026-05-31** (repo already held psg-advantage-portal + prior history; operator confirmed it as the monorepo home). Wave 1 committed on branch `chore/phase-1-workspace-consolidation`; NOT pushed — operator reviews/merges to main. psg-hub `.git` absorbed (bundle at `archive/_repo-bundles/psg-hub-pre-collapse-20260531.bundle`). Trap neutralized: `/archive/` root-anchored in `.gitignore`.

---
*STATE.md — Updated after every significant action*
