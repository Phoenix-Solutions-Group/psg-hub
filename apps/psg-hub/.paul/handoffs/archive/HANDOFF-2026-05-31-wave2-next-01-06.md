# PAUL Session Handoff

**Date:** 2026-05-31
**Status:** Paused (context clear). Clean stopping point — Phase 1 Wave 2 half done, all committed + green.
**Project:** psg-hub
**Phase:** 1 of 5 — Workspace consolidation + multi-repo relocation

---

## READ THIS FIRST

You have no prior context. This document tells you everything.

**Workspace root / monorepo:** `apps/psg/` (this IS the `github.com/Phoenix-Solutions-Group/data` repo — operator-confirmed as the monorepo home).
**Project dir:** `apps/psg/apps/psg-hub/`
**PAUL root:** `apps/psg/apps/psg-hub/.paul/`

**Core value:** Consolidate fragmented PSG tooling into one branded `hub.psgweb.me` surface (customers + staff + superadmins, role-gated).

Phase 1 progress: **5 of 7 plans LOOP CLOSED (71%)**. Wave 1 (01-01..04) done. Wave 2: 01-05 done; **01-06 + 01-07 remain**.

---

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [01-05 LOOP CLOSED 2026-05-31 — BSM anchor app live]
```
IDLE — ready for next APPLY (01-06).

---

## What Was Done This Session

1. **01-04 LOOP CLOSED** — local_reach (3.6G) hard-retired → `apps/psg/archive/local_reach/` (3.1G post-clean, -507.6MB); Tracy's outputs → `archive/local_reach-outputs/`; `local-reach-content/` sidecar (96M) archived + tracys extracted. `accidents.db` (2.9G) archived whole per operator (option A).
2. **Git strategy RESOLVED → single monorepo (collapse).** `apps/psg/.git` (= `data` repo) is THE monorepo. psg-hub's nested `.git` absorbed (bundled to `archive/_repo-bundles/psg-hub-pre-collapse-20260531.bundle`). `.gitignore` root-anchored to exclude `/archive/`, `/psg-import/`, `/api-psghub/`, `/psg-data-lake/`, `.claude/`, the loose `.docx`. Wave 1 committed (`fcdd471`).
3. **Operator confirmed `data` repo is the monorepo home** (it already held psg-advantage-portal + prior FlowerHill history).
4. **01-05 LOOP CLOSED** — BSM dashboard (886M) merged → `apps/psg-hub` as anchor app (D3). Renamed `dashboard`→`psg-hub`. Workspace `pnpm-lock.yaml` generated (766 pkgs). BSM Phase 1–5 PAUL → `.paul/references/bsm/` (59 files). BSM `.git` bundled + dropped; npm `package-lock.json` excluded.
5. **Stripe build fix** — `src/lib/stripe.ts` apiVersion `2026-03-25.dahlia` → `2026-05-27.dahlia` (match SDK ^22). Typecheck + build GREEN (24/24 static pages).
6. **Security: 2 HIGH IDOR fixed** — `content/[id]/approve` + `reject` had zero auth. Added `auth.getUser` (401) + shop tenancy (404) + `shop_members` owner/manager role gate (403), mirroring `reviews/[id]/approve-response`. (Surfaced by automated security review; confirmed real.)
7. **Wave 2 part 1 committed** (`956c256`, 184 files).

---

## Git State

- Branch: **`chore/phase-1-workspace-consolidation`** (NOT main, NOT pushed).
- Commits on branch: `956c256` (BSM anchor + fixes), `fcdd471` (Wave 1 monorepo scaffold). Below them: prior `data` repo history (`8baae0c`...).
- Working tree clean (except BASE's `.base/data/state.json` runtime churn — ignore it).
- **Operator merges to `main` / pushes when ready** — do not push without asking.
- Bundles (history backups) in gitignored `archive/_repo-bundles/`: psg-hub + bsm-dashboard.

---

## What's Next

**Immediate:** `/paul:apply .paul/phases/01-workspace-consolidation/01-06-PLAN.md`
- BSM siblings (`studio`, `integrations`, `onboarding`, `preview`, `shops`) at `~/apps/projects/bsm/` → `apps/psg/packages/*` as scoped `@psg/*`. Gated on 01-01 + 01-05 ✓.

**After that:** `/paul:apply 01-07` (`~/apps/ads/` → `apps/psg/apps/psg-ads-mutations/` Python worker). Then Phase 1 close → **transition** (transition-phase.md: evolve PROJECT/ROADMAP, phase commit, route to Phase 2).

---

## Deferred Issues (non-blocking)

| Issue | Effort | Notes |
|-------|--------|-------|
| Stray `~/package-lock.json` mis-roots Next builds | XS | Set `turbopack.root` in next.config.ts, or remove the home lockfile. Outside `apps/psg` boundary. |
| BSM `middleware.ts` deprecated in Next 16 (→ `proxy`) | S | Rename convention in a later phase. |
| Add `typecheck` script to psg-hub package.json | XS | For turbo `typecheck` pipeline (BSM had none; ran `tsc --noEmit` directly). |
| `psg-agentic-os-dev-packet.docx` (loose, gitignored) — classify | XS | Before Phase 1 close. |
| `.npmrc` npm warnings (cosmetic) | XS | Optional `.pnpmrc` split. |

---

## Key Files

| File | Purpose |
|------|---------|
| `.paul/STATE.md` | Live state (authoritative) |
| `.paul/ROADMAP.md` | Phase overview |
| `.paul/phases/01-workspace-consolidation/01-06-PLAN.md` | NEXT plan |
| `.paul/phases/01-workspace-consolidation/01-05-SUMMARY.md` | Last loop result |
| `.paul/references/bsm/` | BSM Phase 1–5 history (D8 foundation) |

---

## Resume Instructions

1. `/paul:resume` (will read this handoff + STATE).
2. Confirm loop at IDLE, 5/7 closed.
3. Proceed: `/paul:apply 01-06`.

**Gotchas for next session:**
- This Next.js is 16.2.3 with breaking changes — see `apps/psg-hub/AGENTS.md`; read `node_modules/next/dist/docs/` before writing app code. Mirror existing in-repo routes rather than training-data patterns.
- Default shell is **zsh** — bash `${var/pat/repl}` slash-escaping differs (bit 01-04 Task 4; use basename-style rewrites).
- Don't `git add archive/` — bundles + (gitignored) heavy dirs live there.

---

*Handoff created: 2026-05-31T21:57Z*
