---
phase: 04-paul-inheritance
plan: 01
subsystem: docs
tags: [paul, inheritance, tracking, bsm, ads-dashboard, index, base]

requires:
  - phase: 01-workspace-consolidation
    provides: references/bsm/ + references/ads-dashboard/ (inherited PAUL snapshots, absorbed 01-03)
  - phase: 02-design-system
    provides: brand-reconcile addendum (psg-brand submodule = single source of truth)
provides:
  - .paul/references/INDEX.md (navigable inheritance map → consuming milestones)
  - ACTIVE.md-superseded-by-STATE.md tracking model (recorded, no file created)
  - verified BASE satellite at Phase 4 / in_progress
affects: [v0.3-customer-analytics, v1.1-ops-foundation, v1.6-internal-agentic, v0.2-customer-mvp]

tech-stack:
  added: []
  patterns: [inherited-PAUL-snapshots-immutable, single-living-INDEX-per-references-dir]

key-files:
  created: [.paul/references/INDEX.md, .paul/phases/04-paul-inheritance/04-01-SUMMARY.md]
  modified: [.paul/STATE.md, .paul/ROADMAP.md, .paul/PROJECT.md]

key-decisions:
  - "Phase 4 inheritance was front-loaded into Phase 1; reframed to add a usability layer (INDEX), not re-copy"
  - "ACTIVE.md superseded by STATE.md — no file created (current PAUL framework has no ACTIVE.md)"
  - "Inherited snapshots are immutable; INDEX.md is the only living file under references/"

patterns-established:
  - "verify-by-building: deep-read sources to build the artifact, which doubles as the completeness audit"
  - "adversarial multi-lens verification of doc claims against primary sources before loop close"

duration: ~45min (incl. 2 verification workflows, 10 agents)
completed: 2026-06-01
---

# 04-01 SUMMARY — Inheritance INDEX + tracking reconcile

## Outcome

Phase 4 closed the PAUL-inheritance loop without re-copying anything. The two inherited PAUL snapshots (`references/bsm/`, `references/ads-dashboard/`) were already in place from Phase 1; this plan made them **navigable** via a new `references/INDEX.md` and reconciled the two loose ends (the phantom `ACTIVE.md` and the BASE tracking record). Both ACs' deliverables are verified against primary sources by a 3-lens adversarial pass.

## Tasks

### Task 1 — Build the inheritance INDEX (verify-by-building) → DONE / PASS (AC-1 + AC-2)
- Created `.paul/references/INDEX.md`: a navigable map with sections A (BSM Phases 1-5), B (ads-dashboard absorption + brand caveat), C (milestone reverse-map v0.2..v2.0), D (tracking model / ACTIVE.md supersession), E (restoration pointers).
- Verification was done **by building**: 7 parallel deep-readers (one per BSM phase + ads-dashboard + a milestone mapper) read every SUMMARY/PLAN/AUDIT in both trees and returned grounded structured data, which the INDEX is synthesized from. This confirmed AC-1 (both trees populated with real content) in the same pass.
- **Discrepancies recorded in the INDEX** (AC-1 requires surfacing, not silently passing): BSM ROADMAP/PROJECT stale vs shipped reality (Phase 5 header still "TBD/Not started"; Phase 4 lists 6 plans but 3 shipped; Phase 1 names test client "Phil Long" but artifacts used Tracy's); Phase 5 is code-complete + 136 tests but runtime-UNVERIFIED (not deployed); uneven doc coverage (Phases 2/3 mostly SUMMARY-only; 01-02/01-03 SUMMARY-without-PLAN; 05-01 no AUDIT); carried bugs/risks (Stripe webhook INSERT-not-UPSERT dup rows; pre-existing Google Ads campaigns mutable; refresh-token-compromise window; Facebook/Carwise adapters deferred; no review cron); reputation half has no clean named consumer.
- Mechanical verify (from app root): file exists; required strings present (`v0.3`, `v1.1`, `psg-brand`, `STATE.md`, `supersed`); **all 25 markdown links resolve**; all 5 BSM phase dirs + ads-dashboard ABSORPTION-NOTES exist.

### Task 2 — Reconcile tracking + close the phantom → DONE / PASS (AC-3)
- BASE satellite (`.base/data/projects.json`, PRJ-002 psg-hub) verified: `milestone: v0.1 Foundation`, `phase / phase_name: PAUL inheritance + tracking`, status in_progress, `completed_phases: 3`. Already synced this session (pending `.base` commit); no drift vs target, so no re-sync issued. `completed_phases` deliberately left at 3 (Phase 4 not complete until UNIFY). `loop_position: IDLE` is expected-stale and refreshes at the next BASE sync.
- ACTIVE.md disposition recorded in INDEX Section D: superseded by STATE.md, no file created. Filesystem confirms `.paul/ACTIVE.md` does not exist.

## Adversarial verification (quality gate)

Two background workflows, 10 agents total, ~1.05M subagent tokens:
- **Read** (7 agents): grounded the INDEX in primary sources.
- **Verify** (3 lenses, refute-first): BSM claims → **PASS**; ads-dashboard + brand caveat → ISSUES (2 LOW only; the critical brand caveat verified high-confidence against ABSORPTION-NOTES verbatim + submodule on disk); milestone-map + tracking → ISSUES (1 MEDIUM).

**Findings applied (qualify GAP/DRIFT fix loop):**
- **MEDIUM (fixed)** — internal contradiction: Section C v1.1 said "inherits *only* cross-cutting conventions" while Section A attributed BSM schema/survey/SysConfig to v1.1. Reconciled in the greenfield direction (PROJECT D51): Section A v1.1 callouts softened to "shape ref only"; Section C v1.1 rewritten to "greenfield + shape references only." A and C now agree.
- **LOW (fixed)** — tier-gating precision (Performance ads tier *was* hard-gated via `assertAdsTier`); Phase 5 row loose cross-ref to v0.3 sentiment/presence; D61 cohort clarified (full cohort includes Tracy's, which has no ads ID).
- **LOW (no change, per verifier)** — submodule path-prefix (INDEX uses the house `packages/ui/psg-brand/` convention); "dual approval" source tension (the INDEX caveat is the more accurate reading; added a one-clause note anyway).
- Re-verified post-edit: strings + all 25 links still resolve; A/C consistent.

## Files changed
- **Added:** `.paul/references/INDEX.md` (the only deliverable file).
- **Verified-only (not modified by this plan):** `.base/data/projects.json` (BASE satellite; pending sync committed at operator's discretion).
- **STATE.md / ROADMAP.md:** updated for loop position (PLAN at plan-time; APPLY at finalize).

## Boundaries held
- `references/bsm/**` and `references/ads-dashboard/**` content untouched (git porcelain shows only the new INDEX.md under `references/`).
- No app source, no submodule, no Phase 3 integration code, no other BASE satellites touched.
- No `ACTIVE.md` created. No commit / no merge (operator owns those at/after UNIFY).

## Acceptance criteria
- **AC-1** (inheritance verified complete + faithful) — MET: both trees confirmed populated during the build; discrepancies recorded in the INDEX, not silently passed.
- **AC-2** (navigable, not just archived) — MET: every inherited body of work mapped to its consuming milestone with resolving paths; brand-reconcile caveat stated (submodule wins).
- **AC-3** (phantom + tracking reconciled) — MET: ACTIVE.md documented as superseded by STATE.md, no file created; BASE satellite verified at Phase 4 / in_progress / completed_phases 3.

## Deviations / concerns
- None blocking. The INDEX deliberately records BSM-doc discrepancies and Phase-5 not-deployed status as guidance for downstream milestone planners (v0.3 / v1.1 / v1.6).
- BASE `loop_position` will read IDLE until the next sync advances it; not a correctness issue (project-level status is in_progress).

## Next
Run `/paul:unify .paul/phases/04-paul-inheritance/04-01-PLAN.md` to reconcile + close the Phase 4 loop.
