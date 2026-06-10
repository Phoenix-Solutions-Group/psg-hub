---
phase: 12-psg-report
plan: 01
subsystem: api
tags: [analytics, report, rollup, monthly, typescript, vitest]

# Dependency graph
requires:
  - phase: 09-analytics
    provides: analytics_snapshots source-agnostic model + aggregate helpers (latestSnapshot, toSeries)
  - phase: 11-ga4-gsc
    provides: the four live sources (semrush, google_ads, ga4, gsc) with real daily data on prod
provides:
  - analytics/rollup.ts — per-source FLOW/STOCK/DERIVED metric-class rollup engine (monthWindow, priorMonth, rollupMonth, momDelta)
  - report/types.ts — ReportData + SourceReportBlock (the single payload for narrative + PDF)
  - report/report-data.ts — assembleReportData (pure, deps-injected, vitest-testable)
affects: [12-02-narrative-eval, 12-03-pdf-delivery, 12-04-cron]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Metric-class rollup: classify every metric FLOW(sum)/STOCK(latest)/DERIVED(recompute-from-summed); never average a ratio, never sum a stock"
    - "Pure assembler: inject the DB read (SnapshotReader) + the clock (generatedAt) via deps so the module avoids the server-only import and stays node-testable"

key-files:
  created:
    - src/lib/analytics/rollup.ts
    - src/lib/analytics/__tests__/rollup.test.ts
    - src/lib/report/types.ts
    - src/lib/report/report-data.ts
    - src/lib/report/__tests__/report-data.test.ts
  modified: []

key-decisions:
  - "SEMrush metrics are all STOCK (organic_traffic is an estimated-monthly value re-snapshotted daily; summing overcounts)"
  - "DERIVED ratios recomputed from summed components: cpl=sumSpend/sumConv, ctr=sumClicks/sumImpr, position=impression-weighted, engagement_rate=sumEngaged/sumSessions"
  - "GA4 total_users/active_users summed but tagged approximate (daily sum overcounts monthly uniques; true uniques deferred to a monthly runReport)"
  - "Assembler reads prior-month-start through current-month-end in ONE call per source (exact two-month coverage, no arbitrary 90-day math)"

patterns-established:
  - "Report blocks omit unlinked sources entirely (never present-with-zeros); cold-start sets prior=null/momDelta=null"

# Metrics
duration: ~15min
started: 2026-06-10
completed: 2026-06-10
---

# Phase 12 Plan 01: Report Data Layer Summary

**A deterministic monthly-rollup engine and a single `ReportData` assembler that turn the four live analytics sources into one typed payload per shop per month, classifying every metric FLOW/STOCK/DERIVED so sums never corrupt stocks or ratios. Pure, fully unit-tested, zero prod contact, no new dependency.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~15 min |
| Tasks | 2 of 2 DONE/PASS |
| Files created | 5 (2 modules + 1 types + 2 test files) |
| Tests added | +19 (15 rollup, 4 report-data) -> suite 482/482 |
| Migrations / new deps | 0 / 0 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Monthly rollup classifies + reduces every metric | PASS | FLOW summed, STOCK latest (SEMrush organic_traffic latest-not-sum), DERIVED recomputed (cpl, ctr, impression-weighted position, engagement_rate), empty->null. 15 tests |
| AC-2: ReportData assembled per shop per month | PASS | One read/source spanning prior+current month, rollup both, momDelta, trend via toSeries; window + generatedAt set |
| AC-3: Missing sources + cold-start degrade gracefully | PASS | No-current source omitted (not zeroed); current-but-no-prior sets prior=null/momDelta=null and excludes from sourcesWithPriorMonth |
| AC-4: Pure, typed, green, zero prod contact | PASS | tsc 0, eslint 0, vitest 482/482, no migration, no new dep, DB read + clock injected via deps |

## Accomplishments

- **The rollup correctness core**, proven by adversarial tests: GSC `position` is impression-weighted (test asserts 17.5, not the 15 simple mean); `cpl`/`ctr`/`engagement_rate` recomputed from summed components and null on zero denominator; SEMrush `organic_traffic` takes the latest June value (1500), never the sum.
- **`assembleReportData`** kept pure: the supabase read is injected as a pre-bound `SnapshotReader` and the clock as `generatedAt`, so the module never imports the `server-only` snapshots module and runs under vitest's node env.
- **Graceful degradation + cold-start** modeled first-class (Option A live-data base: a shop linked to only some of the four sources still produces a coherent report).

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: rollup engine + tests | `a487b33` | feat | analytics/rollup.ts + rollup.test.ts (15) |
| Task 2: ReportData + assembler + tests | `a487b33` | feat | report/{types,report-data}.ts + report-data.test.ts (4) |

Plan + both tasks committed together on `feature/12-psg-report` (`a487b33`). 12-01-PLAN.md included.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/analytics/rollup.ts` | Created | monthWindow/priorMonth, METRIC_REGISTRY, rollupMonth, momDelta |
| `src/lib/analytics/__tests__/rollup.test.ts` | Created | 15 rollup-correctness tests |
| `src/lib/report/types.ts` | Created | ReportData + SourceReportBlock |
| `src/lib/report/report-data.ts` | Created | assembleReportData (pure, deps-injected) |
| `src/lib/report/__tests__/report-data.test.ts` | Created | 4 assembler tests |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Read prior-month-start..current-month-end in one call per source | Exact two-month coverage; avoids an arbitrary 90-day subtraction | Simpler, exact; 12-03/04 bind the reader to getSnapshots |
| Inject SnapshotReader + generatedAt via deps | Keep the assembler pure + free of the server-only import so it is vitest-testable | report-data.ts has no server-only; the cron/route binds the client in 12-03/04 |
| GA4 total_users/active_users summed-but-approximate | Daily sum overcounts monthly uniques; true uniques need a monthly runReport | Documented caveat in the registry; flagged for a later monthly-runReport follow-on |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Trivial type import |
| Scope additions | 0 | None |
| Deferred | 1 | GA4 true-monthly-uniques (documented, not in scope) |

**Total impact:** None material. Plan executed as written.

### Auto-fixed Issues

**1. [Type] `SeriesPoint` used in scope but only re-exported**
- **Found during:** Task 2 qualify (tsc error report-data.ts:82)
- **Issue:** the bottom `export type { SeriesPoint } from ...` re-export does not bring the name into module scope; the `trend: Record<string, SeriesPoint[]>` annotation failed to resolve
- **Fix:** added a top `import type { SeriesPoint } from "../analytics/aggregate"`
- **Verification:** tsc 0
- **Commit:** `a487b33`

### Deferred Items

- GA4 true monthly unique users (total_users/active_users are summed-approximate; a monthly runReport would give exact uniques). Documented in METRIC_REGISTRY; revisit if the report needs exact monthly uniques.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| SeriesPoint scope (tsc) | Top type import added; tsc 0 |

## Skill Audit (Phase 12)

| Expected | Invoked | Notes |
|----------|---------|-------|
| Research-first / per-plan research check | ✓ | RESEARCH.md committed `f917f2b` (ultracode `wf_8f01e69a-625`) covers the rollup classification + ReportData shape. 12-01 opened no new external surface (pure TS over existing reads) |

All required flows invoked.

## Next Phase Readiness

**Ready:**
- `ReportData` is the typed contract 12-02 (narrative + eval) and 12-03 (PDF) both consume.
- The rollup classification is locked and tested, so downstream plans build on correct numbers.

**Concerns:**
- GA4 monthly-uniques approximation (deferred).
- 12-02 adds the first new deps of the phase (`ai`, `zod`) and the Vercel AI Gateway surface.

**Blockers:**
- None. Phase 12 is 1 of 4 plans (ROADMAP map); 12-02 is next. No phase transition (file count would falsely trigger it; the 4-plan shape in RESEARCH.md is truth).

---
*Phase: 12-psg-report, Plan: 01*
*Completed: 2026-06-10*
