---
phase: 13-gbp-presence
plan: 02a
subsystem: analytics
tags: [google-business-profile, analytics-source-union, metric-registry, report, migration, supabase, zod]

requires:
  - phase: 13-gbp-presence (13-01)
    provides: the source='gbp' google_oauth_accounts row + GoogleOAuthSource union (the link foundation the 13-02b ingest reads)
  - phase: 12-psg-report
    provides: the report assembler / rollup / prompt / schema / render / eval gate that 'gbp' is promoted into
provides:
  - 'gbp' as a first-class AnalyticsSource — admitted by both analytics source CHECKs and promoted across all 11 exhaustive union maps (the panel/report/rollup/trend earned "for free")
  - the GbpMetrics jsonb type (9 FLOW keys, all-summable, impressions_total derived-at-ingest) that 13-02b's parser writes
affects: [13-02b daily GBP insights ingest, 13-03 monthly presence + star rating]

tech-stack:
  added: []   # NO new dependency; pure TS + one additive migration
  patterns:
    - "Promoting a new AnalyticsSource after the Phase-12 report exists touches 11 exhaustive sites; tsc exhaustiveness (Record<AnalyticsSource,…>) is the completeness proof"
    - "A new source's report block is earned by the union promotion alone — assembleReportData/render iterate the union, so no per-source report code is written"
    - "All-FLOW source (no ratio) => METRIC_REGISTRY entry is flow-only, no deriveMetric branch, nothing aggregate-excluded"

key-files:
  created:
    - supabase/migrations/20260614202719_gbp_insights_source.sql
  modified:
    - src/lib/analytics/types.ts
    - src/lib/analytics/rollup.ts
    - src/lib/report/report-data.ts
    - src/lib/report/prompt.ts
    - src/lib/report/render.ts
    - src/lib/report/schema.ts
    - src/lib/report/evaluate.ts

key-decisions:
  - "Split 13-02 into 13-02a (this: migration + union promotion) + 13-02b (ingest + panel + e2e) on advisor review — 13-02 is the first source added after the report exists (~17 files), too big for one APPLY/50%-context"
  - "Migration mirrors 20260612 perf-source (drop-if-exists by standard name + verify-at-apply, proven on prod in 12-05c), NOT a DO-block — the analytics_sync_runs auto-name resolves to the standard name"
  - "Add ONLY 'gbp' here; 'gbp_presence' is 13-03's SnapshotSource-only monthly value (FLOW-vs-STOCK discriminator) and must not enter the union or either CHECK"
  - "GbpMetrics is all-FLOW: impressions_total is derived-at-ingest (sum of the 4 splits), so nothing is aggregate-excluded from the MSO KPIs (unlike ga4/gsc/ads)"

patterns-established:
  - "fullMap() test fixtures stay 4-source; a new source gets its own present/absent it-blocks so existing exact-count assertions don't break"
  - "TREND_KEYS picks 2 headline daily trends per source (gbp = call_clicks, website_clicks)"

duration: ~30min
started: 2026-06-14T20:30:00Z
completed: 2026-06-14T21:00:00Z
---

# Phase 13 Plan 02a: GBP `'gbp'` Union Promotion + Analytics CHECK Widen Summary

**Promoted `'gbp'` to a first-class AnalyticsSource: one additive migration widening the analytics_snapshots + analytics_sync_runs source CHECKs, the new all-FLOW GbpMetrics jsonb type, and the union promotion across all 11 exhaustive maps (rollup registry, report assembler, prompt, render, eval, schema) so 13-02b's daily insights earn the dashboard panel + monthly report block + trend + rollup for free. Build-local, ZERO prod, fully verified against the local migrated DB + the report/rollup unit suites.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~30 min |
| Started | 2026-06-14T20:30:00Z |
| Completed | 2026-06-14T21:00:00Z |
| Tasks | 2 completed (all DONE/PASS) |
| Files created | 2 (migration + this summary) |
| Files modified | 9 (2 analytics + 5 report + 2 test; + the regression test SEED) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: One migration, LOCAL, both source CHECKs admit 'gbp' | Pass | `20260614202719_gbp_insights_source.sql` mirrors 20260612; `supabase db reset` exit 0; psql: BOTH CHECKs admit 'gbp' (full prior set preserved), a 'gbp' analytics_sync_runs insert ACCEPTED + a bogus source REJECTED; auto-named sync_runs constraint resolved to `analytics_sync_runs_source_check`; NOT 'gbp_presence'; no google_oauth_accounts/RLS touch |
| AC-2: GbpMetrics type — 9 FLOW keys, all summable | Pass | `GbpMetrics` = 4 impression splits + impressions_total + website_clicks + call_clicks + direction_requests + conversations; doc states all FLOW / nothing aggregate-excluded; impressions_total documented derived-at-ingest (not a DailyMetric enum value) |
| AC-3: AnalyticsSource +'gbp' AND every exhaustive map updated; tsc clean | Pass | union + 10 source sites (METRIC_REGISTRY, SOURCES, TREND_KEYS, SOURCE_LABELS, SOURCE_META, SOURCE_ORDER, KPI_SET, sourceSummaries zod, SOURCE_NAMES) + the regression SEED = 11; tsc 0 (exhaustiveness flagged the lone remaining miss = SEED, fixed) |
| AC-4: rollup correctness — gbp all-FLOW, no derived branch | Pass | METRIC_REGISTRY.gbp = 9 flow / [] stock / [] derived; deriveMetric unchanged; rollup.test +2 (all-flow sum, impressions_total independent of its splits, empty→null) |
| AC-5: report block for free — assembled present, omitted absent | Pass | report-data.test +2 (gbp block w/ current+prior+MoM+trend keyed by TREND_KEYS.gbp; gbp absent → omitted, four existing blocks unchanged); existing rollup/report-data/evaluate/narrative/render suites green |
| AC-6: Boundaries — promotion only, no ingest, zero prod | Pass | NO gbp-metrics/gbp-sync/cron/Performance-API call; page.tsx carries only the 13-01 link card (no gbp data panel); the lone Performance-API string in src is a doc comment; ZERO prod; no new dep |

## Verification Results

- **tsc:** 0 errors (exhaustiveness across every `Record<AnalyticsSource,…>` proved all 11 sites updated)
- **eslint:** 0 errors (5 pre-existing warnings: ga4-dims-sync/ga4-sync/gsc-sync `_a`, middleware `options` — none new)
- **vitest:** 602 passed (598 prior + 4 new gbp: 2 rollup + 2 report-data)
- **supabase db reset:** exit 0; `20260614202719` applied last, clean; psql `pg_get_constraintdef` confirms both CHECKs admit 'gbp'; functional verify: 'gbp' ledger insert accepted, bogus rejected (rolled back)
- **no new dep:** package.json / pnpm-lock.yaml / next.config.ts unchanged

## Accomplishments

- Made `'gbp'` a first-class AnalyticsSource so the entire daily panel + monthly report + trend + rollup path comes free for 13-02b's ingest — the deliberate price (11 exhaustive maps) paid once.
- Proved completeness by tsc exhaustiveness, not by hand: after the source-map edits the only remaining `Record<AnalyticsSource>` error was the regression SEED, which the type system surfaced and was fixed.
- Kept the existing four-source report byte-stable: `fullMap()` stayed 4-source, gbp got its own present/absent test cases, and every existing exact-count assertion stayed green.

## Task Commits

Not committed per-plan — this project commits at phase boundaries. 13-02a changes are staged-on-disk, uncommitted, accumulating with 13-01 (and the coming 13-02b/13-03/13-04) for the eventual `feat(13-gbp-presence): …` phase commit.

| Task | Status | Description |
|------|--------|-------------|
| Task 1: Migration + GbpMetrics type | DONE/PASS | both analytics source CHECKs +'gbp' (mirror 20260612) + new all-FLOW GbpMetrics type; db reset + psql verified |
| Task 2: Union promotion (11 sites) + tests | DONE/PASS | AnalyticsSource +'gbp' across all exhaustive maps + rollup/report-data unit tests; tsc exhaustiveness clean |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260614202719_gbp_insights_source.sql` | Created | Widen analytics_snapshots + analytics_sync_runs source CHECKs +'gbp' (mirror 20260612) |
| `src/lib/analytics/types.ts` | Modified | AnalyticsSource +'gbp'; NEW GbpMetrics type (9 FLOW keys) |
| `src/lib/analytics/rollup.ts` | Modified | METRIC_REGISTRY.gbp = all-flow (no deriveMetric branch) |
| `src/lib/report/report-data.ts` | Modified | SOURCES += 'gbp'; TREND_KEYS.gbp = [call_clicks, website_clicks] |
| `src/lib/report/prompt.ts` | Modified | SOURCE_LABELS.gbp |
| `src/lib/report/render.ts` | Modified | SOURCE_META.gbp + SOURCE_ORDER += 'gbp' + KPI_SET gbp card + METRIC_LABELS gbp keys |
| `src/lib/report/schema.ts` | Modified | sourceSummaries.gbp.optional() |
| `src/lib/report/evaluate.ts` | Modified | SOURCE_NAMES += 'gbp' |
| `src/lib/analytics/__tests__/rollup.test.ts` | Modified | +2 gbp all-flow cases |
| `src/lib/report/__tests__/report-data.test.ts` | Modified | +2 gbp present/absent cases |
| `src/lib/report/__tests__/evaluate-grounding-regression.test.ts` | Modified | SEED += gbp fixture + linkedSources assertion updated |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Split 13-02 → 13-02a + 13-02b | 13-02 is the first source added after the report exists (~17 files / ~6 real tasks); one APPLY risks the 50%-context overflow + a half-promoted union | This plan = migration + union promotion (compiles, verifies on synthetic fixtures); 13-02b = ingest + panel + e2e, depends_on 13-02a |
| Mirror 20260612 (drop-if-exists by name), NOT a DO-block | The analytics_sync_runs auto-named constraint resolves to the standard name — this exact path applied on prod in 12-05c | Simpler migration; psql confirmed the standard name + the 'gbp' accept / bogus reject |
| Add ONLY 'gbp' (not 'gbp_presence') | FLOW-vs-STOCK discriminator: 'gbp' daily is summable → union; 'gbp_presence' monthly STOCK is 13-03's SnapshotSource-only value | Clean 13-02a/13-03 boundary; 13-03 owns its own migration |
| GbpMetrics all-FLOW; impressions_total derived-at-ingest | Performance API counts all sum honestly; impressions_total = per-day sum of the 4 splits computed by the parser, not an enum metric | No deriveMetric branch, nothing aggregate-excluded; 13-02b must NOT request impressions_total as a DailyMetric (400s) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Regression-test assertion updated for the new linkedSources shape — no behavior change |
| Scope additions | 1 | METRIC_LABELS gbp keys (open Record<string,string>, table-quality) — not in the 11 required maps, additive |
| Deferred | 0 | All AC verified this session |

**Total impact:** No scope creep. The build matched the plan; the union promotion landed exactly across the mapped 11 sites.

### Auto-fixed Issues

**1. [test] evaluate-grounding-regression linkedSources assertion**
- **Found during:** Task 2 (adding the SEED.gbp fixture)
- **Issue:** the test asserted `linkedSources` deep-equals the 4-source array; seeding gbp data makes assembleReportData emit a 5th block
- **Fix:** updated the assertion to include `"gbp"` (the intended new shape); the deterministic template still passes the eval gate by construction
- **Files:** `src/lib/report/__tests__/evaluate-grounding-regression.test.ts`
- **Verification:** vitest 602 green

### Deferred Items

None for 13-02a.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `Edit` "File has not been read yet" on STATE.md/paul.json after prior-step Bash reads | Re-read the target with the Read tool before editing (the read-tracking did not carry from the earlier partial/Bash reads) |

## Next Phase Readiness

**Ready:**
- 13-02b (daily GBP insights ingest): can build `gbp-metrics` (FRESH metric-major→date-major parser; request 8 DailyMetric enum values; `impressions_total` derived-at-ingest), `gbp-sync` (clone gsc-sync, source='gbp', GBP_RESYNC_DAYS=7), `/api/cron/gbp-sync` (vercel.json `0 7 * * *`), and the dashboard "Local presence" panel against a real `GbpMetrics` type and CHECKs that accept 'gbp'. `depends_on: ["13-02a"]`. All precision traps recorded in `13-02a-PLAN.md` §output.
- 13-03 (monthly presence + star rating): unaffected; will add its own `'gbp_presence'` SnapshotSource value + migration.

**Concerns:**
- Skill audit: research-first ✓ (13-RESEARCH.md). The Context7 zod check was marked optional and not invoked — the `sourceSummaries` `.optional()` add was a one-line additive edit verified by tsc + the AI-SDK schema binding test, so no gap.

**Blockers:**
- None for the build. Activation (live Performance API + prod migration + deploy) stays the 13-04 gate batch behind Google Gate A + Gate B (unchanged, still on the clock from 13-01).

---
*Phase: 13-gbp-presence, Plan: 02a*
*Completed: 2026-06-14*
