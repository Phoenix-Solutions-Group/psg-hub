---
phase: 12-psg-report
plan: 05b
subsystem: api
tags: [performance, pagespeed, psi, crux, gtmetrix, web-vitals, monthly-ingest, report-render, supabase]

# Dependency graph
requires:
  - phase: 12-psg-report (12-05a)
    provides: SnapshotSource superset (carries 'performance'), MonthlySnapshotRow, the monthly single-row ingest + rollup-bypassing reader pattern, the both-CHECKs migration shape, additive-optional ReportData block
  - phase: 09-analytics (09-03)
    provides: semrush/sync.ts shops.url eligibility (url-less skipped) + ledger + contained-failure template
  - phase: 03-integrations
    provides: src/lib/resilience.ts (CircuitBreaker + withRetry)
provides:
  - PSI fetch (lab always + CrUX field render-if-present, one call)
  - GTMetrix async fetch (POST->poll->/reports/{id}, max-poll ceiling, 429 backoff, state=error contained)
  - Monthly performance ingest orchestrator (configured-guard, shops.url eligibility, idempotent)
  - ReportData.performance block + rollup-bypassing monthly reader
  - One "Website performance" render block (replaces the bogus GA4 "Performance Status")
  - Authored migration widening snapshots + sync_runs source CHECKs to admit 'performance'
affects: [12-05c cron wiring + combined operator gate batch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PSI one-call lab+CrUX-field (loadingExperience/originLoadingExperience parse, no separate queryRecord)"
    - "optional-enrichment isolation: GTMetrix in its own try so the required PSI floor row survives a GTMetrix failure"
    - "configured-guard no-op (no torn ledger) when the required key is unset"
    - "scope hook (gtmetrixShopLimit/gtmetrixShopIds) to bound metered/slow calls without editing the module"

key-files:
  created:
    - src/lib/perf/psi.ts
    - src/lib/perf/gtmetrix.ts
    - src/lib/perf/perf-sync.ts
    - supabase/migrations/20260612000000_performance_source.sql
  modified:
    - src/lib/analytics/types.ts
    - src/lib/report/types.ts
    - src/lib/report/report-data.ts
    - src/lib/report/render.ts

key-decisions:
  - "CrUX folded into PSI (no separate queryRecord module) — PSI returns the field block in the same call"
  - "PSI = required floor, GTMetrix = optional enrichment isolated in its own try (advisor-caught fix)"
  - "no new dependency — Node-24 global fetch, not a PSI/GTMetrix SDK"
  - "mobile-only + homepage-only locked; field render-if-present else 'Lab data'"

patterns-established:
  - "perf ingest mirrors semrush/sync (URL eligibility) + ga4-dims-sync (monthly single-row) with a configured-guard + optional-source isolation"

# Metrics
duration: ~60min
started: 2026-06-12T09:40:00Z
completed: 2026-06-12T10:05:00Z
---

# Phase 12 Plan 05b: Performance Sources (PSI/CrUX/GTMetrix) Summary

**Added the real website-performance layer to the monthly report: a one-call PSI lab + CrUX-field fetch, a GTMetrix async POST-then-poll fetch, a monthly `performance` ingest orchestrator behind a PSI configured-guard, an additive rollup-bypassing `ReportData.performance` block, and one canon render block replacing the old Looker deliverable's bogus GA4 "Performance Status / server response 14:49" — all build-local, tsc 0 / eslint 0 / vitest 573 green / build green, ZERO prod contact, no new dependency.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~60 min |
| Started | 2026-06-12T09:40:00Z |
| Completed | 2026-06-12T10:05:00Z |
| Tasks | 3 completed |
| Files modified | 13 (3 source + 1 migration + 3 tests + 4 edited + 2 extended tests) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: PSI lab + CrUX-field fetch (one call) | Pass | `fetchPsi` (mobile) parses lab from `lighthouseResult` (score×100, named-audit ms, CLS) + CrUX field from `loadingExperience` else `originLoadingExperience` (exact KEYS, CLS÷100); field=null = successful-empty, breaker untripped; CircuitBreaker+withRetry; `psiConfigured()` |
| AC-2: GTMetrix async POST-then-poll | Pass | POST→poll `/tests/{id}`→completed (`redirect:manual` observes the 303)→GET `/reports/{id}`; hard max-poll ceiling throws, state=error throws, 429 backoff; HTTP Basic key:blank; `gtmetrixConfigured()` |
| AC-3: Monthly perf ingest + ReportData.performance | Pass | One idempotent `performance` monthly row/shop (date=YYYY-MM-01), url-less skipped, contained failure + ledger, PSI configured-guard no-op (no torn ledger); `readMonthlyPerformance` populates ReportData.performance off the rollup-bypassing path, undefined when absent; daily + 12-05a paths unchanged. **PSI floor survives a GTMetrix failure (advisor fix).** |
| AC-4: One canon perf render block | Pass | "Website performance" `.panel` + PageSpeed/GTMetrix badges + good/warn/danger score card + LCP/CLS (field-else-lab) + TTFB (GTMetrix backend_duration else PSI server-response-time) + fully-loaded/page-weight when GTMetrix present; field row only when CrUX present else "Lab data"; omitted when performance undefined; no GA4 "Performance Status"/"server response" string |

## Verification Results

- `pnpm vitest run` — 74 files, **573 passed** (+22 net: psi 6, gtmetrix 4, perf-sync 8, report-data +1, render +3)
- `pnpm tsc --noEmit` — clean
- `pnpm eslint` (changed files) — **0 errors, 0 warnings**
- `pnpm build` — green (✓ Compiled successfully)
- `git status` — AnalyticsSource union still four sources; no edits to ga4-dimensions/ga4-dims-sync/existing syncs; `package.json`/`vercel.json` untouched (no new dep, no cron); migration untracked + unapplied

## Accomplishments

- A PSI fetch that gets lab + real-user (CrUX) in ONE call, treating CrUX-absence (the collision-shop default) as a successful-empty result that degrades to lab-only rather than failing
- A GTMetrix async client that survives one Fluid invocation (max-poll ceiling) and is credit/rate safe, with the test/report resource split named explicitly (303 → `/reports/{id}`)
- A perf ingest that mirrors the established sync template but adds two new safety primitives: a configured-guard no-op (no torn ledger when unkeyed) and optional-source isolation (GTMetrix failure never discards the PSI floor)
- One render block that finally replaces the deliverable's most embarrassing artifact (the mis-mapped GA4 "server response 14:49") with honest PSI/GTMetrix numbers

## Task Commits

NOT committed this turn (global rule: commit only on request). On `feature/12-psg-report` with 12-05a. Commit folds into the 12-05c transition or on request.

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: PSI fetch + types + migration | (uncommitted) | feat | psi.ts + Perf types + both-CHECKs migration + psi.test |
| Task 2: GTMetrix + perf-sync + reader | (uncommitted) | feat | gtmetrix.ts + perf-sync.ts + ReportData.performance reader + 3 tests |
| Task 3: perf render block | (uncommitted) | feat | render.ts "Website performance" block + render.test |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/perf/psi.ts` | Created | One mobile `runPagespeed` → lab + CrUX field (folded in); PerfHttpError + isRetryablePerfError; psiConfigured |
| `src/lib/perf/gtmetrix.ts` | Created | Async POST→poll→`/reports/{id}`; max-poll ceiling + 429 backoff + state=error; gtmetrixConfigured |
| `src/lib/perf/perf-sync.ts` | Created | Monthly `performance` ingest; configured-guard, shops.url eligibility, optional-GTMetrix isolation, gtmetrixShopLimit/Ids scope hook |
| `supabase/migrations/20260612000000_performance_source.sql` | Created | AUTHORED-not-applied; widens snapshots + sync_runs source CHECKs to admit `performance` (keeps ga4_dimensions) |
| `src/lib/perf/__tests__/psi.test.ts` | Created | 6 tests — lab+field parse, field-null empty, origin fallback, retry, 403 no-retry, configured |
| `src/lib/perf/__tests__/gtmetrix.test.ts` | Created | 4 tests — poll→report parse, state=error, max-poll ceiling, configured |
| `src/lib/perf/__tests__/perf-sync.test.ts` | Created | 8 tests — one row/shop, url-less skip, gtmetrix scope, **PSI floor survives GTMetrix failure**, contained failure, configured no-op, read error |
| `src/lib/analytics/types.ts` | Modified | +PsiFieldMetrics/PsiResult/GtmetrixResult/PerformanceMetrics; AnalyticsSource union UNTOUCHED |
| `src/lib/report/types.ts` | Modified | +optional ReportData.performance + PerformanceReport |
| `src/lib/report/report-data.ts` | Modified | +optional readMonthlyPerformance reader bypassing rollupMonth; daily + 12-05a paths byte-unchanged |
| `src/lib/report/render.ts` | Modified | +"Website performance" block + perf format helpers |
| `src/lib/report/__tests__/report-data.test.ts` | Modified | +1 performance case (undefined/null/populated) |
| `src/lib/report/__tests__/render.test.ts` | Modified | +3 perf cases (field present, lab-only, undefined) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| CrUX folded into PSI, no separate queryRecord module | PSI returns `loadingExperience`/`originLoadingExperience` in the same call; a standalone CrUX call is metered + zero-data for low-traffic origins | one fewer external surface; the field IS CrUX |
| PSI floor isolated from GTMetrix enrichment (own try) | AC-3 declares PSI the always-present floor; sharing a try discarded the PSI row on a GTMetrix failure | a GTMetrix timeout/429/credit-exhaustion degrades to lab-only, never zeroes the shop |
| No new dependency (global fetch) | PSI/GTMetrix are plain HTTPS; an SDK is needless surface | app runtime deps unchanged |
| gtmetrixShopLimit/gtmetrixShopIds scope hook built now | perf-sync polls GTMetrix in-loop (~60s/shop); unbounded × N shops can exceed the 300s Fluid invocation | 12-05c scopes GTMetrix to the pilot via config, not a module redesign |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential correctness fix (advisor done-check) |
| Scope additions | 1 | In-plan (both-CHECKs migration, anticipated from 12-05a) |
| Deferred | 0 | — |

**Total impact:** One correctness fix, no scope creep.

### Auto-fixed Issues

**1. [Correctness] GTMetrix failure discarded the required PSI floor row**
- **Found during:** advisor done-check (after the suite was green — the failure path was untested)
- **Issue:** PSI (required floor) and GTMetrix (optional enrichment) shared one try block; a GTMetrix throw skipped `rows.push`, so the shop got NO perf data — contradicting AC-3's floor/enrichment intent. The original "contained failure" test threw in PSI, never in GTMetrix-with-PSI-succeeding, so the one path where the distinction matters was untested.
- **Fix:** Wrapped only the GTMetrix call in its own try (log, keep PSI, `gtmetrix:null`); the shop counts `synced`. Added a test: GTMetrix throws + PSI succeeds → lab-only row stored, `gtmetrix:null`.
- **Files:** `perf-sync.ts`, `perf-sync.test.ts`
- **Verification:** new test passes; full suite 573 green
- **Commit:** (uncommitted, part of Task 2)

### Deferred Items

None — plan executed as written (plus the advisor fix above).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Single-file vitest run reported "Cannot find package '@/lib/perf/perf-sync'" after the edit | Transient vite dep-optimizer cache; tsc clean + a re-run resolved it (18 perf tests pass, full suite 573 green) |

## Skill Audit

All required skills (SPECIAL-FLOWS.md) invoked ✓ — research-first satisfied (12-05-RESEARCH.md "Performance data sources" is a dedicated PSI/CrUX/GTMetrix pass; 12-05b opens no un-researched API). Advisor consulted pre-build (303/`reports` precision + the wall-clock `gtmetrixShopLimit` hook) and at done (caught + fixed the floor/enrichment defect).

## Next Phase Readiness

**Ready:**
- PSI + GTMetrix fetches, the monthly `performance` ingest, and the perf render block land green build-local; the ingest is configured-guarded and ready for 12-05c cron wiring
- `gtmetrixShopLimit`/`gtmetrixShopIds` already in place so 12-05c can scope GTMetrix to the pilot via config
- Both authored migrations (12-05a `ga4_dimensions` + 12-05b `performance`) are ready to fold into the 12-05c combined gate batch

**Concerns (carry to 12-05c):**
- **Build-blind parsers:** run ONE keyed PSI call + one GTMetrix run against the Wallace pilot to confirm `lighthouseResult` / `loadingExperience` / `/reports/{id}` shapes match the parsers (JSON paths written from RESEARCH, never run live)
- **GTMetrix wall-clock + credits:** scope GTMetrix via `gtmetrixShopLimit`/`gtmetrixShopIds` so the in-loop poll (~80s/shop) stays under the 300s Fluid ceiling; confirm the plan-tier daily-credit allowance (Micro 10 / Growth 100 / Team 300 / Enterprise 500; fleet 842/day > Enterprise)
- **Both source-CHECK migrations:** confirm the `analytics_sync_runs_source_check` auto-name at apply, then insert `ga4_dimensions` + `performance` rows into BOTH tables to prove the widens took
- **Cron ordering:** perf-sync + ga4-dims-sync crons must run BEFORE the `0 0 1 * *` report cron; the report degrades to last-good monthly rows if late

**Blockers:** None (build-local complete; secrets/apply/deploy are the 12-05c operator gate that closes Phase 12 + milestone v0.3).

---
*Phase: 12-psg-report, Plan: 05b*
*Completed: 2026-06-12*
