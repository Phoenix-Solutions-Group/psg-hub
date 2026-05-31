---
phase: 01-workspace-consolidation
plan: 03
subsystem: infra
tags: [absorption, archive, decommission, ads-dashboard, D70]

requires: []
provides:
  - ads-dashboard PAUL plans + concepts absorbed at apps/psg/apps/psg-hub/.paul/references/ads-dashboard/ (v0.3 design canon)
  - ads-dashboard codebase archived at apps/psg/archive/ads-dashboard/ (.git + .paul preserved)
  - GitHub repo Phoenix-Solutions-Group/ads-dashboard archived (read-only)
  - Vercel decommission plan recorded (project: ads-dashboard, team: psg-digital; delete gated on v0.3 absorption-complete)
affects: [v0.3-phase-1]

tech-stack:
  added: []
  patterns:
    - "absorb-then-archive: PAUL artifacts to references/ (live design canon), code to archive/ (historical)"
    - "checkpoint:human-action for external mutations (gh archive, Vercel name capture)"
    - "pre-clean (node_modules/.next/.turbo/.vercel) before mv to keep archive small"

key-files:
  created:
    - apps/psg/apps/psg-hub/.paul/references/ads-dashboard/ (17 files; PROJECT, ROADMAP, STATE, SPECIAL-FLOWS, config, paul.json, 4 Phase-1 plans + 01-01 AUDIT, .prod-url, handoffs/archive/HANDOFF-2026-05-20, ORIGINAL-PLANNING, ORIGINAL-README, ORIGINAL-SECURITY)
    - apps/psg/apps/psg-hub/.paul/references/ads-dashboard/ABSORPTION-NOTES.md (3,463 bytes)
  relocated:
    - ~/apps/ads-dashboard/ → apps/psg/archive/ads-dashboard/ (468M pre-clean → 1.0M post; .git + .paul preserved)
  decommissioned:
    - GitHub Phoenix-Solutions-Group/ads-dashboard (archived 2026-05-29T17:55:48Z)

key-decisions:
  - "D70 reframe operationalized: plans + concepts absorbed as v0.3 design canon; code archived not folded"
  - "Vercel project ads-dashboard (psg-digital team) retained read-only until v0.3 absorption-complete (per D70 + 01-01 staging note); no delete in 01-03"
  - "Pre-clean strip of node_modules/.next/.turbo/.vercel before archive mv — 99.8% size reduction (468M → 1.0M)"

duration: ~40min (incl. operator gap for gh + Vercel name capture)
started: 2026-05-29T17:30Z
completed: 2026-05-29T18:00Z
---

# Phase 1 Plan 03: ads-dashboard PAUL Absorb + Codebase Archive Summary

**ads-dashboard fully decommissioned as an active project. PAUL plans + concepts land in `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/` as v0.3 design canon. Codebase relocated to `apps/psg/archive/ads-dashboard/` (1.0M post pre-clean). GitHub archived. Vercel project recorded for v0.3 decommission.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~40 min (incl. checkpoint pause for external actions) |
| Started | 2026-05-29T17:30Z |
| Completed | 2026-05-29T18:00Z |
| Tasks | 5 of 5 completed |
| Files absorbed | 17 (16 copied + 1 ABSORPTION-NOTES.md written) |
| Codebase archive size | 1.0M (pre-clean: 468M; 99.8% reduction) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: PAUL plans + concepts absorbed | PASS | 17 files at `references/ads-dashboard/` incl. PROJECT, ROADMAP, STATE, SPECIAL-FLOWS, config, paul.json, 4 Phase-1 plans + 01-01 AUDIT, handoffs/archive, ORIGINAL-PLANNING/README/SECURITY |
| AC-2: ABSORPTION-NOTES documents D70 reframe | PASS | 3,463 bytes; D70 + D61 referenced; Wallace/Tedesco/Flower Hill listed; v0.3 phase 1 handoff explicit |
| AC-3: Codebase relocated to archive | PASS | `~/apps/ads-dashboard/` ENOENT; `apps/psg/archive/ads-dashboard/` 1.0M with `.git` + `.paul` + code; node_modules/.next/.turbo/.vercel excluded |
| AC-4: GitHub repo archived | PASS | `gh repo view --json archivedAt` → `2026-05-29T17:55:48Z`; isArchived: true |
| AC-5: Vercel decommission plan recorded | PASS | Project `ads-dashboard` (team `psg-digital`, URL https://vercel.com/psg-digital/ads-dashboard) noted with v0.3 absorption-complete gate; no CLI mutation |

## Accomplishments

- ads-dashboard PAUL state preserved in two trees:
  - **Live design canon** at `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/` (17 files; v0.3 phase plans will reference by path)
  - **Historical archive** at `apps/psg/archive/ads-dashboard/.paul/` (full original tree with `.git` audit trail)
- D70 reframe fully discharged for ads-dashboard scope: design intent absorbed (story-led narrative, per-client goals, monthly PDF, Wallace/Tedesco/Flower Hill identities); scaffold code archived (BSM Next 16 supersedes)
- GitHub repo flipped to read-only — no further commits possible, history still readable
- Vercel decommission gate set: project stays up read-only until v0.3 phase 1 unify closes, then operator removes via dashboard or `vercel projects rm ads-dashboard --scope psg-digital`

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/{PROJECT,ROADMAP,STATE,SPECIAL-FLOWS,config}.md` | Created (cp -p) | PAUL top-level absorbed with original mtime |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/paul.json` | Created (cp -p) | Source PAUL manifest preserved |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/phases/01-foundation/{01-01-PLAN,01-01-AUDIT,01-02-PLAN,01-03-PLAN,01-04-PLAN}.md` | Created (cp -p) | Phase 1 plans absorbed (Foundation scaffold, brandkit, Supabase auth, demo /c/wallace) |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/phases/01-foundation/.prod-url` | Created (cp -p) | ads-dashboard-ten-pink.vercel.app reference |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/handoffs/archive/HANDOFF-2026-05-20-01-01-apply-blocked.md` | Created (cp -p) | Handoff history preserved |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/ORIGINAL-{PLANNING,README,SECURITY}.md` | Created (cp -p) | Top-level design docs preserved with provenance |
| `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/ABSORPTION-NOTES.md` | Created | D70 bridge: what absorbed, what archived, what decommissioned, v0.3 handoff |
| `apps/psg/archive/ads-dashboard/` | Created (mv from `~/apps/ads-dashboard/`) | Full historical codebase; node_modules/.next/.turbo/.vercel pre-stripped |
| `~/apps/ads-dashboard/` | Deleted (via mv) | Source path now ENOENT |

## External Actions Confirmed

| Action | Result | Evidence |
|--------|--------|----------|
| `gh repo archive Phoenix-Solutions-Group/ads-dashboard --yes` | Success | `gh repo view --json archivedAt,isArchived` → `{"archivedAt":"2026-05-29T17:55:48Z","isArchived":true}` |
| Vercel project name capture | Confirmed | Operator provided https://vercel.com/psg-digital/ads-dashboard → project `ads-dashboard` under team `psg-digital` |

## Vercel Decommission Plan

- **Project name:** `ads-dashboard`
- **Team / scope:** `psg-digital`
- **Dashboard URL:** https://vercel.com/psg-digital/ads-dashboard
- **Production URL (current):** `ads-dashboard-ten-pink.vercel.app` (per absorbed `.prod-url`)
- **Decommission gate:** v0.3 phase 1 unify closes (per D70 + 01-01 staging note: ads-dashboard Vercel kept read-only until v0.3 absorption complete)
- **Reference command at gate:** `vercel projects rm ads-dashboard --scope psg-digital` or remove via dashboard
- **No mutation in 01-03** — documentation only

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Pre-clean codebase before mv (node_modules, .next, .turbo, .vercel) | Regenerable artifacts; 468M → 1.0M is 99.8% reduction with zero information loss | Archive stays inspection-friendly |
| Preserve `.git` + `.paul` inside archived copy | `.git` = audit trail; `.paul/` archived copy is distinct from absorbed `references/` copy (different purposes) | Two PAUL trees by design |
| Keep absorbed PAUL files read-only (no edits in 01-03) | Absorption ≠ rewrite; v0.3 phase plans will reference these as design canon | Provenance preserved |
| Vercel project stays live read-only | D70 + 01-01 staging note — v0.3 may need to verify against running demo | Defer delete to v0.3 phase 1 unify |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 0 (carryovers from prior plans still active, see Next Phase Readiness) |

**Total impact:** Plan executed cleanly against frontmatter. Five tasks completed in stated order with one operator gap at Task 4 checkpoint:human-action.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Task 4 checkpoint required two external actions outside the agent's scope | Operator resolved: provided Vercel URL `https://vercel.com/psg-digital/ads-dashboard`; agent ran `gh repo archive --yes` after resume |
| Source archive `.DS_Store` files at root of `archive/ads-dashboard/` | Cosmetic; left in place (matches pattern in other archive trees) |

## Next Phase Readiness

**Ready:**
- Wave 1 sibling 01-04 (local_reach archive) — but PLAN.md must absorb `apps/psg/local-reach-content/` (96 MB) addendum first (carryover from 01-02 deferred)
- Wave 2 (01-05 BSM relocation, 01-06 BSM siblings → packages, 01-07 apps/ads → psg-ads-mutations) all unblocked since 01-01 LOOP CLOSED

**Concerns:**
- `apps/psg/local-reach-content/` carryover from 01-02 — fold into 01-04 PLAN.md before its APPLY (otherwise same gap pattern as web-dev-skills in 01-02)
- `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose) — Phase 1 close operator decision
- Workspace-root git strategy (collapse vs nested) — decide before 01-05 BSM relocation lands

**Blockers:**
- None for Wave 1 (01-04 only needs the local-reach-content addendum)
- None for Wave 2

---
*Phase: 01-workspace-consolidation, Plan: 03*
*Completed: 2026-05-29*
