---
phase: 12-psg-report
plan: 05a
subsystem: api
tags: [ga4, analytics, runReport, metricAggregations, monthly-ingest, report-render, supabase, snapshots]

# Dependency graph
requires:
  - phase: 11-ga4-gsc
    provides: per-shop Google OAuth + getGa4DataClient + ga4-metrics/ga4-sync daily ingest pattern
  - phase: 12-psg-report (12-01)
    provides: assembleReportData + ReportData/SourceReportBlock + rollupMonth + monthWindow
  - phase: 12-psg-report (12-03)
    provides: render.ts canon helpers (escapeHtml, .panel, badge-src, table.psg, styleBlock)
provides:
  - GA4 dimensional fetch (fetchGa4Dimensions) — one monthly runReport per dimension with TOTAL-reconciled (other)
  - Monthly ingest orchestrator (syncGa4Dimensions) writing period=monthly ga4_dimensions snapshot rows
  - SnapshotSource insert-layer type + MonthlySnapshotRow read type (AnalyticsSource union untouched)
  - ReportData.dimensions additive optional block + rollup-bypassing monthly reader
  - Four GA4 dimensional render sections (canon design)
  - Authored migration widening the snapshots + sync_runs source CHECKs to admit ga4_dimensions
affects: [12-05b perf sources, 12-05c cron wiring + operator gate batch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "metricAggregations:['TOTAL'] -> totals[0] for the true dimension month total (reconciling (other))"
    - "extended DB source via SnapshotSource superset, NOT via the AnalyticsSource union (keeps 6 exhaustive maps untouched)"
    - "additive ReportData block read on a separate monthly path that bypasses rollupMonth"

key-files:
  created:
    - src/lib/google-oauth/ga4-dimensions.ts
    - src/lib/google-oauth/ga4-dims-sync.ts
    - supabase/migrations/20260611000000_ga4_dimensions_source.sql
  modified:
    - src/lib/analytics/types.ts
    - src/lib/report/types.ts
    - src/lib/report/report-data.ts
    - src/lib/report/render.ts

key-decisions:
  - "metricAggregations TOTAL over limit-only: limit=10 alone makes landing-page (other) always 0 and can't yield weighted avg duration"
  - "averageSessionDuration read from the device report's weighted TOTAL row, not meaned across rows"
  - "migration widens BOTH source CHECKs (snapshots + sync_runs) — AC-2 ledger row needs sync_runs too (plan named only snapshots)"
  - "bounce_rate derived (1 - rolled-up monthly engagement_rate), never fetched or stored"

patterns-established:
  - "GA4 dimensional ingest mirrors ga4-sync.ts (ledger/dedupeByShop/contained-failure/idempotent upsert) with a monthly single-row output"

# Metrics
duration: ~75min
started: 2026-06-11T15:10:00Z
completed: 2026-06-12T00:05:00Z
---

# Phase 12 Plan 05a: GA4 Dimensional Ingest + Render Sections Summary

**Added the GA4 secondary-dimension layer to the monthly report: a per-dimension monthly runReport fetch (TOTAL-reconciled top-N + (other)), a monthly ga4_dimensions ingest orchestrator, an additive rollup-bypassing ReportData.dimensions block, and four canon render sections — all build-local, tsc 0 / eslint 0 / vitest 551 green / build green, ZERO prod contact, no new dependency.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~75 min |
| Started | 2026-06-11T15:10:00Z |
| Completed | 2026-06-12T00:05:00Z |
| Tasks | 3 completed |
| Files modified | 11 (3 source + 1 migration + 4 tests + 3 edited) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Per-dimension monthly GA4 fetch | Pass | One runReport per dimension (test asserts 4 calls, single monthly dateRange, no `date` dim); top-N + reconciling `(other)` via `metricAggregations:['TOTAL']` → `totals[0]`; averageSessionDuration from the device weighted TOTAL; bounce_rate NOT fetched; CircuitBreaker + withRetry on every call |
| AC-2: Monthly ingest, one idempotent row/shop | Pass | `syncGa4Dimensions` writes ONE `source='ga4_dimensions'`, `period='monthly'`, `date=YYYY-MM-01` row/shop; onConflict idempotency key; contained per-shop auth_failed → markAccountError; one ledger row opened/closed |
| AC-3: ReportData.dimensions off the monthly path | Pass | Optional `readMonthlyDimensions` reader bypasses `rollupMonth`; undefined when absent/null; daily four-source assembly byte-unchanged (its 4 tests pass); `ga4_dimensions` NOT in the SOURCES array nor the AnalyticsSource union |
| AC-4: Four canon render sections | Pass | Traffic Drivers / Landing Pages / Device / New vs Returning as `.panel` + `.badge-src(GA4)` + `table.psg` with `(other)`; every GA4 string HTML-escaped; none render when `dimensions` undefined; bounce/duration KPI line |

## Verification Results

- `pnpm vitest run` — 71 files, **551 passed** (+11: 4 ga4-dimensions, 6 ga4-dims-sync incl. reportMonth, +4 report-data dimensions cases, +4 render sections)
- `pnpm tsc --noEmit` — clean
- `pnpm eslint` (changed files) — **0 errors** (1 warning `_a` unused, identical to the mirrored `ga4-sync.test.ts` convention)
- `pnpm build` — green (✓ Compiled successfully; 39/39 static pages)
- `git status` — `ga4-metrics.ts` / `ga4-sync.ts` NOT modified; `AnalyticsSource` still the four sources; migration untracked + unapplied; no vercel.json/cron/env/deploy

## Accomplishments

- GA4 dimensional fetch that issues exactly one monthly runReport per section dimension, never combined (cross-product/`(other)` corruption) and never daily, with a TOTAL-reconciled `(other)` remainder that stays honest even for high-cardinality landing pages
- A monthly ingest orchestrator structurally mirroring the daily `ga4-sync.ts` (ledger, dedupeByShop, contained per-shop failure, idempotent upsert) but emitting ONE monthly row per shop
- Lowest-blast-radius data model: extended DB source via a `SnapshotSource` superset + `MonthlySnapshotRow` read type, leaving the `AnalyticsSource` union (and its six exhaustive maps) untouched
- Four canon-styled render sections that appear only when dimensional data is present, with full HTML escaping of GA4 strings

## Task Commits

NOT committed this turn (global rule: commit only on request). Work is on disk on `feature/12-psg-report`. Matches the build-local arc — commit folds into the 12-05c transition, or on operator request.

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: GA4 fetch + types + migration | (uncommitted) | feat | ga4-dimensions.ts + types + source-CHECK migration + test |
| Task 2: monthly sync + reader | (uncommitted) | feat | ga4-dims-sync.ts + report types/reader + 2 tests |
| Task 3: four render sections | (uncommitted) | feat | render.ts dimensional sections + test |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/google-oauth/ga4-dimensions.ts` | Created | Per-dimension monthly runReport (TOTAL → reconciling `(other)`, weighted avg duration); mirrors ga4-metrics resilience |
| `src/lib/google-oauth/ga4-dims-sync.ts` | Created | Monthly ingest orchestrator; ledger `source='ga4_dimensions'`, ONE row/shop `date=YYYY-MM-01`, idempotent |
| `supabase/migrations/20260611000000_ga4_dimensions_source.sql` | Created | AUTHORED-not-applied; widens snapshots + sync_runs source CHECKs to admit `ga4_dimensions` |
| `src/lib/google-oauth/__tests__/ga4-dimensions.test.ts` | Created | 4 tests — per-dim call count, TOTAL-reconciled `(other)`, coercion, retry/breaker |
| `src/lib/google-oauth/__tests__/ga4-dims-sync.test.ts` | Created | 6 tests — one monthly row/shop, dedupe, contained auth_failed, ledger error, reportMonth |
| `src/lib/report/__tests__/report-data.test.ts` | Modified | +4 dimensions cases (undefined no-reader, undefined null, populated + derived bounce, ga4-absent null) — 4 originals unchanged |
| `src/lib/report/__tests__/render.test.ts` | Modified | +4 dimensional-section cases (headings, escaping + `(other)`, KPI line, none-when-undefined) |
| `src/lib/analytics/types.ts` | Modified | +SnapshotSource, +Ga4DimensionRow/Ga4DimensionsMetrics/MonthlySnapshotRow; AnalyticsSnapshotInsert.source widened; AnalyticsSource union UNTOUCHED |
| `src/lib/report/types.ts` | Modified | +optional ReportData.dimensions + Ga4DimensionsReport |
| `src/lib/report/report-data.ts` | Modified | +optional readMonthlyDimensions reader bypassing rollupMonth; daily assembly byte-unchanged |
| `src/lib/report/render.ts` | Modified | +4 GA4 dimensional sections + bounce/duration KPI line + `.lp` truncation CSS |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| `metricAggregations:['TOTAL']` + `totals[0]` | `limit=10` alone makes landing-page `(other)` always 0 (sum(topN) ≠ month total) and can't yield a weighted avg duration; TOTAL aggregates the full set regardless of limit | `(other)` reconciles honestly; avg duration correct |
| avg duration from device TOTAL row | GA4 computes the sessions-weighted aggregate there; meaning per-row ratios is a different, wrong number | aggregate-excluded metric handled correctly |
| Widen BOTH source CHECKs in the migration | AC-2's ledger row (`source='ga4_dimensions'`) hits the `analytics_sync_runs` CHECK, not just snapshots; plan Task 1 named only snapshots | migration complete for 12-05c apply; flagged as deviation |
| bounce_rate derived, not stored | `bounce_rate = 1 - engagement_rate`, already ingested; storing it would duplicate | one fewer stored field; computed from the rolled-up monthly engagement_rate |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential correctness fix (pre-build, advisor-caught) |
| Scope additions | 1 | Required for AC-2 on prod; still authored-only |
| Deferred | 0 | — |

**Total impact:** Two essential corrections, no scope creep.

### Auto-fixed Issues

**1. [Correctness] `(other)` remainder always-zero / avg duration unobtainable under `limit=10`**
- **Found during:** Task 1 (pre-write, advisor pass)
- **Issue:** Plan said `limit=TOP_N` AND `(other) = total − sum(topN)` AND "read avg duration off any row" — mutually inconsistent; with `limit=10` `sum(topN)` is not the month total (landing pages), so `(other)` is silently 0, and a per-row/meaned avg duration is the wrong number
- **Fix:** Added `metricAggregations:['TOTAL']`; read the dimension month total + weighted `averageSessionDuration` from `totals[0]`
- **Files:** `ga4-dimensions.ts`; test fixture encodes `total > sum(rows)` so it discriminates a broken implementation
- **Verification:** `ga4-dimensions.test.ts` asserts a non-zero `(other)=350` for landing pages and `averageSessionDuration=132` from the device TOTAL

**2. [Scope] Migration widens `analytics_sync_runs` source CHECK too**
- **Found during:** Task 1 (grounding the ledger insert)
- **Issue:** Plan Task 1 migration named only the `analytics_snapshots` source CHECK, but AC-2 opens an `analytics_sync_runs` ledger row with `source='ga4_dimensions'` — that table's CHECK (20260605) admits only the four flat sources and would reject the insert on prod
- **Fix:** Authored migration drop-and-recreates BOTH source CHECKs to add `ga4_dimensions` (`performance` reserved for 12-05b)
- **Files:** `20260611000000_ga4_dimensions_source.sql` (authored-only, unapplied)
- **Verification:** valid SQL + idempotent guards; empirical confirmation deferred to the 12-05c apply (see Concerns)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `analytics_sync_runs` source CHECK is an inline auto-named constraint | Drop uses the deterministic `<table>_<column>_check` name; flagged in-file + STATE as a 12-05c pre-apply verify (local Supabase stack not running this turn) |

## Skill Audit

All required skills (SPECIAL-FLOWS.md) invoked ✓ — research-first satisfied (12-05-RESEARCH.md present; 12-05a opens no new external-API surface, reuses the in-place GA4 OAuth/runReport). Advisor consulted pre-build (caught the TOTAL trap) and at done (flagged the migration verification gap).

## Next Phase Readiness

**Ready:**
- GA4 dimensional ingest + render land green build-local; ReportData.dimensions and the monthly reader seam are in place for 12-05c cron wiring
- The `SnapshotSource` superset + monthly-row pattern is the template 12-05b reuses for `performance` rows
- Migration authored and ready to fold into the 12-05c combined gate batch

**Concerns (carry to 12-05c):**
- **Confirm the `analytics_sync_runs_source_check` auto-name** matches at apply (\d+); then insert a `ga4_dimensions` row into BOTH `analytics_snapshots` and `analytics_sync_runs` to prove the widen took
- **Confirm the GA4 `totals[0]` response shape** on the first live dims-sync runReport — `metricAggregations` parsing is new code, never run against a live response (add next to the live-PSI-call item)
- Cron schedule must run BEFORE the `0 0 1 * *` report cron; report degrades to last-good monthly rows if a sync is late

**Blockers:** None (build-local complete; secrets/apply/deploy are the 12-05c operator gate).

---
*Phase: 12-psg-report, Plan: 05a*
*Completed: 2026-06-12*
