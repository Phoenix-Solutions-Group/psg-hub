---
phase: 01-workspace-consolidation
plan: 02
subsystem: infra
tags: [cleanup, kill-list, relocation, archive, workspace]

requires: []
provides:
  - clean workspace at apps/psg/ (kill list cleared, non-code material relocated)
  - ~/apps/_psg-archive/ archive root with 9 relocated PSG-adjacent workspaces
  - MANIFEST.md documenting D26 + D71 decisions
affects: [01-04, 01-05]

tech-stack:
  added: []
  patterns:
    - "non-destructive pre-scan to .paul-bridge/ before any rm/mv"
    - "mv preferred over cp+rm (mtime preservation)"
    - "single archive root sibling of workspace (~/apps/_psg-archive/) for out-of-scope material"

key-files:
  created:
    - /Users/schoolcraft_mbpro/apps/_psg-archive/MANIFEST.md
    - apps/psg/projects/psg-hub/.paul-bridge/01-02-pre-scan.md
  deleted:
    - apps/psg/invoice/
    - apps/psg/portal/
    - apps/psg/sst-psgdigital/
    - apps/psg/dashboard-psgdigital/
    - apps/psg/shop-theacrb/
    - apps/psg/invoice-psgdigital/
    - apps/psg/web-dev-skills/ (auto-fix; D26-mandated, plan frontmatter omitted)
    - ~/apps/CTO/
    - ~/apps/morgan/
  relocated:
    - apps/psg/psg/ → ~/apps/_psg-archive/psg-obsidian/
    - apps/psg/pipedrive/ → ~/apps/_psg-archive/pipedrive/
    - ~/apps/Automation/ → ~/apps/_psg-archive/Automation/
    - ~/apps/CFO/ → ~/apps/_psg-archive/CFO/
    - ~/apps/daily-content-brief/ → ~/apps/_psg-archive/daily-content-brief/
    - ~/apps/governance/ → ~/apps/_psg-archive/governance/
    - ~/apps/obsidian-vault/ → ~/apps/_psg-archive/obsidian-vault/
    - ~/apps/python-scripts/ → ~/apps/_psg-archive/python-scripts/
    - ~/apps/DEGWEB-MODERNIZATION-REVIEW.md → ~/apps/_psg-archive/DEGWEB-MODERNIZATION-REVIEW.md

key-decisions:
  - "Auto-fix added web-dev-skills delete during APPLY — plan frontmatter omitted but D26 mandated"
  - "local-reach-content/ + psg-agentic-os-dev-packet.docx surfaced as new deferred items for 01-04 + future"

patterns-established:
  - "Pre-scan to .paul-bridge/ then checkpoint:human-action then batch mv/rm — safe pattern for destructive plans"
  - "Auto-fix during APPLY when plan-vs-decision-intent gap found (vs full re-plan) — when fix is clearly within original decision scope"

duration: ~8min
started: 2026-05-29T17:34:30Z
completed: 2026-05-29T17:45:00Z
---

# Phase 1 Plan 02: Kill List + Non-Code Relocation Summary

**Workspace cleared of 9 dead/legacy directories (~580 MB freed) and 9 out-of-scope workspaces relocated to `~/apps/_psg-archive/` (~180 MB). `apps/psg/` top level now near-final shape before BSM lands.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~8 min (incl. 1 checkpoint pause) |
| Started | 2026-05-29T17:34:30Z |
| Completed | 2026-05-29T17:45:00Z |
| Tasks | 5 of 5 completed + 1 auto-fix |
| Files modified | 18 paths (9 deleted, 9 relocated, MANIFEST + pre-scan created) |
| Bytes freed (kill) | ~580 MB |
| Bytes relocated | ~180 MB |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Pre-scan captures full state | PASS | 17 paths classified (all EXISTS); audit log written to `.paul-bridge/01-02-pre-scan.md` |
| AC-2: Kill list cleared | PASS+1 | 8 originally-scoped paths deleted; +1 auto-fix for `web-dev-skills/` (D26-mandated, plan omitted) |
| AC-3: Relocations land at single archive root | PASS | All 9 paths in `~/apps/_psg-archive/`; mtime preserved via `mv` (same filesystem); sources return ENOENT |
| AC-4: Archive root self-documents | PASS | MANIFEST.md 45 lines; D26/D71 mentioned 20+ times; includes Untouched section + Restoration note |
| AC-5: Adjacent third-party dirs left alone | PASS | `~/apps/gbrain/` + `~/apps/open-design/` untouched (confirmed via post-relocation `ls`) |

## Accomplishments

- Workspace at `apps/psg/` reduced to its core inventory: 6 workspace-root configs from 01-01 + 4 monorepo dirs (apps/, packages/, archive/, projects/) + 4 in-place satellites (api-psghub/, psg-advantage-portal/, psg-data-lake/, psg-import/) + 2 newly-surfaced TBDs (local-reach-content/, psg-agentic-os-dev-packet.docx)
- `~/apps/_psg-archive/` established as single local-only archive root with MANIFEST.md cross-referenced to D26 + D71 decision history
- 9 destructive deletions executed only after pre-scan + operator approval (zero unintended deletes)
- D26 + D71 fully discharged for paths the plan covered; 1 D26 path (web-dev-skills) caught during APPLY via post-state comparison and auto-fixed

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `apps/psg/projects/psg-hub/.paul-bridge/01-02-pre-scan.md` | Created | Pre-state audit log: 17 paths × (exists/missing, size, mtime, file count) |
| `~/apps/_psg-archive/` | Created | Single archive root for relocated material |
| `~/apps/_psg-archive/MANIFEST.md` | Created | 45-line manifest documenting relocations + deletions with D26/D71 refs + Untouched + Restoration sections |
| `~/apps/_psg-archive/{Automation, CFO, daily-content-brief, governance, obsidian-vault, pipedrive, psg-obsidian, python-scripts}/` | Created (relocated) | 9 archived material directories with original mtime |
| `~/apps/_psg-archive/DEGWEB-MODERNIZATION-REVIEW.md` | Created (relocated) | Separate file, original mtime preserved |
| `apps/psg/{invoice,portal,sst-psgdigital,dashboard-psgdigital,shop-theacrb,invoice-psgdigital,web-dev-skills}/` | Deleted | D26 kill list (web-dev-skills auto-fixed) |
| `~/apps/{CTO,morgan}/` | Deleted | D71 empty/stub kills |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Auto-fix `web-dev-skills/` delete during APPLY | Plan frontmatter omitted it, but D26 explicitly approved it; path was 0B empty stub (confirmed by `ls`); fix is clearly within original decision scope | Closes D26 gap immediately without re-planning ceremony |
| Defer classification of `apps/psg/local-reach-content/` to 01-04 | Strongly LocalReach-related (contains tracys/, lr-seo-auditor.skill, web-scraping.skill, agent-prompt-local-reach.md, discovery.mp4) — natural fit for 01-04 archive scope | 01-04 PLAN.md must be updated before its APPLY to include this 96 MB directory |
| Defer classification of `apps/psg/psg-agentic-os-dev-packet.docx` | Loose 32K file with no clear D26/D71 categorization; needs operator classification | Tracked as deferred issue; resolve before Phase 1 close |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential — closes D26 gap (web-dev-skills) |
| Scope additions | 1 | web-dev-skills delete (D26-mandated; within decision scope, not new scope) |
| Deferred | 2 | local-reach-content + .docx |

**Total impact:** Plan executed cleanly against frontmatter. One D26-required path caught at post-state comparison (added via auto-fix). Two pre-existing workspace items surfaced for downstream classification.

### Auto-fixed Issues

**1. `apps/psg/web-dev-skills/` missing from plan frontmatter**
- **Found during:** Task 5 post-state verification (`ls /Users/schoolcraft_mbpro/apps/psg/`)
- **Issue:** D26 listed web-dev-skills explicitly in the approved kill list, but `01-02-PLAN.md`'s `deleted_paths` frontmatter omitted it. Pre-scan therefore missed it.
- **Fix:** Confirmed contents = 0B empty `projects/` stub. Deleted with `rm -rf`. Appended note to `~/apps/_psg-archive/MANIFEST.md` deletions section.
- **Files:** `apps/psg/web-dev-skills/` (deleted), `~/apps/_psg-archive/MANIFEST.md` (appended)
- **Verification:** `[ -e /Users/schoolcraft_mbpro/apps/psg/web-dev-skills ] && echo FAIL || echo DELETED` → DELETED.
- **Classification:** SPEC issue at the PLAN.md frontmatter level (plan didn't enumerate D26 fully). Fix is within D26 intent so handled as auto-fix during APPLY rather than re-plan.

### Deferred Items

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| `apps/psg/local-reach-content/` (96 MB; contains `tracys/`, `lr-seo-auditor.skill`, `web-scraping.skill`, `agent-prompt-local-reach.md`, `discovery.mp4`, `gsd-update-vertex`) needs classification | Surfaced by Task 5 post-state ls | S | Update 01-04 PLAN.md to fold this into local_reach archive before its APPLY |
| `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose file) — needs operator classification (relocate to `_psg-archive/`, keep as workspace doc, or delete) | Surfaced by Task 5 post-state ls | XS | Decide before Phase 1 close |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Plan frontmatter missed a D26 path (`web-dev-skills`) | Auto-fixed during APPLY after Task 5 post-state ls flagged the gap; closes inside this plan's loop rather than spawning a re-plan |
| Two pre-existing items (`local-reach-content/`, `.docx`) not in any plan scope | Logged as deferred for 01-04 (clear scope match) + Phase 1 close (loose file) |

## Next Phase Readiness

**Ready:**
- Workspace at `apps/psg/` clear of legacy junk and out-of-scope material
- Single archive root pattern established for Wave 1 sibling plans (01-03 ads-dashboard, 01-04 local_reach) to reuse if needed
- Pre-scan → checkpoint → execute pattern proven safe; reusable in remaining destructive plans (01-03, 01-04, 01-05, 01-06, 01-07)

**Concerns:**
- `apps/psg/local-reach-content/` must be folded into 01-04 PLAN.md before that APPLY (otherwise the same gap pattern repeats)
- `apps/psg/psg-agentic-os-dev-packet.docx` needs an operator decision; tag for resolution at Phase 1 close
- 01-04 references `~/apps/projects/local_reach/` (source path) — confirm during 01-04 pre-scan that this is distinct from the just-surfaced `apps/psg/local-reach-content/`

**Blockers:**
- None for Wave 1 siblings (01-03, 01-04 — only 01-04 needs the local-reach-content addendum noted above)
- None for Wave 2 (01-05 BSM still gated only on 01-01)

---
*Phase: 01-workspace-consolidation, Plan: 02*
*Completed: 2026-05-29*
