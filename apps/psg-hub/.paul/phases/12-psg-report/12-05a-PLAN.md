---
phase: 12-psg-report
plan: 05a
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/analytics/types.ts
  - src/lib/google-oauth/ga4-dimensions.ts
  - src/lib/google-oauth/ga4-dims-sync.ts
  - src/lib/report/types.ts
  - src/lib/report/report-data.ts
  - src/lib/report/render.ts
  - supabase/migrations/20260611000000_ga4_dimensions_source.sql
  - src/lib/google-oauth/__tests__/ga4-dimensions.test.ts
  - src/lib/google-oauth/__tests__/ga4-dims-sync.test.ts
  - src/lib/report/__tests__/report-data.test.ts
  - src/lib/report/__tests__/render.test.ts
autonomous: true
---

<objective>
## Goal
Add the GA4 secondary-dimension layer to the monthly report: a per-dimension monthly
ingest (Top Traffic Drivers, Top Landing Pages, Device Breakdown, New vs Returning, plus
`averageSessionDuration`) stored as `period='monthly'` `analytics_snapshots` rows, an
additive `ReportData.dimensions` block read via a monthly path that bypasses rollup, and
four new render sections in the canon design language. Build-local, ZERO prod contact.

## Purpose
First plan of the 12-05 arc (GA4 dims · perf sources · cron+gate). Closes the gap between
the live date-totals report and the operator-reviewed Looker GA4 deliverable's dimensional
breakdowns. Reuses the per-shop GA4 OAuth already in place — no new external API, no new
secret — so it is the lowest-friction slice and ships independently of the perf work (12-05b).

## Output
GA4 dimensional fetch + monthly sync orchestrator + authored (NOT applied) source-CHECK
migration + `ReportData.dimensions` type/reader + four render sections, all behind
`tsc 0 / eslint 0 / vitest green`, no prod write, no new dependency, no cron wiring.
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Research (governs this plan)
@.paul/phases/12-psg-report/12-05-RESEARCH.md
# Sections that bind 12-05a: "GA4 dimensional ingest" (call structure, derived bounce_rate),
# "Data-model + ReportData extension" (new DB sources NOT in the AnalyticsSource union),
# "Architecture decision: cadence" (Architecture B — operator-confirmed), "Report sections".

## Source Files (patterns to mirror)
@src/lib/google-oauth/ga4-metrics.ts      # the daily runReport + header-indexed string parse to MIRROR (do not edit)
@src/lib/google-oauth/ga4-sync.ts         # the ingest orchestrator (ledger, contained failure, dedupeByShop) to MIRROR (do not edit)
@src/lib/analytics/types.ts               # AnalyticsSnapshotInsert, AnalyticsSource, Ga4Metrics
@src/lib/analytics/snapshots.ts           # upsertSnapshots (onConflict shop_id,source,date,period)
@src/lib/report/types.ts                  # ReportData / SourceReportBlock
@src/lib/report/report-data.ts            # assembleReportData + SnapshotReader (the daily path to leave intact)
@src/lib/report/render.ts                 # renderSourceTable, .panel/.badge-src/table.psg canon classes
@supabase/migrations/20260604000000_analytics_snapshots.sql  # the source CHECK to ALTER
</context>

<skills>
## Required Skills (from SPECIAL-FLOWS.md)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| /paul:research-phase (or ultracode research Workflow) | required | Before /paul:plan | ✅ SATISFIED — 12-05-RESEARCH.md present |
| Per-plan research check | required | Before authoring this plan | ✅ SATISFIED — 12-05a opens NO new external API (reuses the in-place GA4 OAuth/runReport surface; PSI/CrUX/GTMetrix are 12-05b, already researched) |

**BLOCKING:** none outstanding. 12-05a adds no new external-API/library surface.
</skills>

<acceptance_criteria>

## AC-1: Per-dimension monthly GA4 fetch
```gherkin
Given a shop with a linked GA4 account and a 'YYYY-MM' report month
When the GA4 dimensional fetch runs
Then it issues ONE monthly-window runReport PER section dimension (NOT one combined
  multi-dimension report, NOT a daily loop), each with sessions descending
And it returns, per dimension, the top-N rows by sessions plus a synthetic '(other)'
  remainder row whose sessions = month total minus the sum of the top-N
And it returns averageSessionDuration (seconds); bounce_rate is NOT fetched (derived later
  as 1 - engagement_rate from already-ingested ga4 daily data)
And every external call is wrapped in CircuitBreaker + withRetry (resilience constraint)
```

## AC-2: Monthly ingest writes one idempotent snapshot row per shop
```gherkin
Given the GA4 dimensional sync orchestrator runs over all shops with a status='linked' ga4 account
When it completes
Then it writes exactly ONE analytics_snapshots row per shop with source='ga4_dimensions',
  period='monthly', date=<first-of-report-month YYYY-MM-01>, and the nested dimension arrays
  in metrics jsonb
And re-running the sync nets zero new rows (idempotent on shop_id,source,date,period)
And a single shop's failure is CONTAINED (no bare catch) and the batch continues, with one
  analytics_sync_runs ledger row opened/closed for the run (mirrors ga4-sync.ts)
```

## AC-3: ReportData carries an optional dimensions block read off the monthly path
```gherkin
Given assembleReportData runs for a shop+month
When a ga4_dimensions monthly row exists for that shop+month
Then ReportData.dimensions is populated from that row via a monthly reader that bypasses
  rollupMonth entirely (these top-N arrays are not FLOW/STOCK/DERIVED and never enter METRIC_REGISTRY)
And when no ga4_dimensions row exists, ReportData.dimensions is undefined (graceful omission)
And the existing four-source flat SourceReportBlock assembly is byte-unchanged — 'ga4_dimensions'
  is NOT added to the report-data SOURCES rollup array nor to the AnalyticsSource union
```

## AC-4: Four render sections in the canon design language
```gherkin
Given a ReportData with a populated dimensions block
When the report HTML is rendered
Then it emits four sections — Top Traffic Drivers (channel), Top Landing Pages, Device
  Breakdown, New vs Returning — each a .panel + .badge-src(GA4) + table.psg with the top-N
  rows plus the '(other)' remainder, all GA4 string values HTML-escaped
And when ReportData.dimensions is undefined, none of the four sections render (no empty cards)
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: GA4 dimensional fetch + types + source-CHECK migration</name>
  <files>src/lib/google-oauth/ga4-dimensions.ts, src/lib/analytics/types.ts, supabase/migrations/20260611000000_ga4_dimensions_source.sql, src/lib/google-oauth/__tests__/ga4-dimensions.test.ts</files>
  <action>
    Create `fetchGa4Dimensions(shopId, month: {start,end}, deps)` in ga4-dimensions.ts,
    MIRRORING ga4-metrics.ts (CircuitBreaker + withRetry, getGa4DataClient, header-indexed
    parse, ALL metricValues are STRINGS -> Number(), returnPropertyQuota logging) but with a
    DIFFERENT request shape:
      - ONE runReport PER dimension (loop over the four section dimensions), each:
        dateRanges=[{startDate: month.start, endDate: month.end}] (single monthly window, NO
        `date` dimension), dimensions=[{name: <apiName>}], metrics = sessions/totalUsers/
        engagedSessions/engagementRate + averageSessionDuration, orderBys sessions desc,
        limit = TOP_N (default 10; channels/devices/newVsReturning are naturally small),
        returnPropertyQuota: true.
      - Section dimension apiNames (RESEARCH-confirmed valid): traffic drivers
        `sessionDefaultChannelGroup`; landing pages `landingPagePlusQueryString`; device
        `deviceCategory`; new-vs-returning `newVsReturning`.
      - For each dimension, take top-N rows {name, sessions, users} by sessions desc, then
        append a synthetic `(other)` row = (dimension session total - sum of top-N sessions);
        omit `(other)` when <= 0. The section total must always reconcile.
      - Also capture month-level averageSessionDuration (seconds) — read it from any one of
        the per-dimension responses' (other-free) total, or a tiny dedicated totals call;
        prefer deriving from the device report's full set to avoid an extra call.
    Return a typed `Ga4DimensionsMetrics` object (the nested arrays + averageSessionDuration).
    NEVER combine the four dimensions into one runReport (cross-product overflows the 50k
    row/report cap -> rows collapse into (other) -> every marginal corrupts simultaneously;
    RESEARCH). NEVER pull daily dimensional rows.
    Add `Ga4DimensionsMetrics` to analytics/types.ts (document averageSessionDuration as a
    ratio-like average — aggregate-excluded, like engagement_rate). Add a separate insert-layer
    `SnapshotSource = AnalyticsSource | 'ga4_dimensions' | 'performance'` type for the DB/upsert
    path; DO NOT add 'ga4_dimensions' to the `AnalyticsSource` union (keeps the six exhaustive
    maps untouched — RESEARCH data-model section).
    Author migration 20260611000000_ga4_dimensions_source.sql: ALTER the analytics_snapshots
    source CHECK constraint (defined in 20260604000000) to additionally admit 'ga4_dimensions'
    (idempotent drop-and-recreate of the CHECK under the 06-01 migration protocol). AUTHORED
    ONLY — do NOT apply to prod (applied at the 12-05c gate batch). No data migration.
  </action>
  <verify>pnpm vitest run src/lib/google-oauth/__tests__/ga4-dimensions.test.ts — asserts: one runReport per dimension (mock counts calls), top-N + reconciling (other) remainder, string metricValues coerced, averageSessionDuration parsed, retry/breaker seam exercised. `pnpm tsc --noEmit` clean. Migration file is valid SQL (psql --dry or eslint-sql n/a — visual + idempotent guard).</verify>
  <done>AC-1 satisfied; the insert-source type + authored migration unblock Task 2's upsert.</done>
</task>

<task type="auto">
  <name>Task 2: Monthly ingest orchestrator + ReportData.dimensions reader</name>
  <files>src/lib/google-oauth/ga4-dims-sync.ts, src/lib/report/types.ts, src/lib/report/report-data.ts, src/lib/google-oauth/__tests__/ga4-dims-sync.test.ts, src/lib/report/__tests__/report-data.test.ts</files>
  <action>
    Create `syncGa4Dimensions(service, options)` in ga4-dims-sync.ts, MIRRORING ga4-sync.ts
    (openLedger/closeLedger on analytics_sync_runs with source='ga4_dimensions', dedupeByShop
    on linked ga4 accounts, contained per-shop failure with markAccountError on auth_failed,
    upsertSnapshots at the end). Differences:
      - month window = the report month (default: the calendar month containing
        options.today, or an injected `month`); compute first-of-month for the row date.
      - For each eligible shop, call fetchGa4Dimensions(shopId, monthWindow, deps) and push
        ONE AnalyticsSnapshotInsert: { shop_id, source: 'ga4_dimensions', period: 'monthly',
        date: 'YYYY-MM-01', metrics: <Ga4DimensionsMetrics> }. Cast the source through the
        insert-layer SnapshotSource type (upsertSnapshots takes AnalyticsSnapshotInsert — widen
        its source field to SnapshotSource, or add a sibling insert type; keep the daily callers
        type-valid).
      - Idempotent: re-run nets zero rows (onConflict shop_id,source,date,period).
    Extend ReportData (report/types.ts) with an OPTIONAL `dimensions?: Ga4DimensionsReport`
    block OUTSIDE `sources` (parallel to SourceReportBlock — NOT threaded through it), shaped
    as the four named top-N tables + averageSessionDuration + derived bounce_rate
    (1 - the month's engagement_rate, pulled from the already-assembled ga4 SourceReportBlock
    if present, else omitted).
    In report-data.ts, add a SEPARATE monthly reader to AssembleDeps (e.g.
    `readMonthlyDimensions?: (q:{shopId,month}) => Promise<AnalyticsSnapshot|null>`) and, when it
    returns a row, populate ReportData.dimensions from row.metrics — WITHOUT touching the daily
    SOURCES rollup loop and WITHOUT calling rollupMonth on it. When the reader is absent or
    returns null, leave ReportData.dimensions undefined. The existing daily assembly stays
    byte-identical (its test must still pass unchanged).
  </action>
  <verify>pnpm vitest run src/lib/google-oauth/__tests__/ga4-dims-sync.test.ts src/lib/report/__tests__/report-data.test.ts — asserts: one monthly row/shop with date=YYYY-MM-01 + source='ga4_dimensions', idempotent re-run, contained failure + ledger close on error, ReportData.dimensions populated from a monthly row and undefined when absent, daily four-source assembly unchanged. `pnpm tsc --noEmit` clean.</verify>
  <done>AC-2 + AC-3 satisfied.</done>
</task>

<task type="auto">
  <name>Task 3: Four dimensional render sections (canon design)</name>
  <files>src/lib/report/render.ts, src/lib/report/__tests__/render.test.ts</files>
  <action>
    Add four render sections to render.ts, emitted only when reportData.dimensions is present,
    inserted after the per-source sections (exact order a render decision — default: Traffic
    Drivers, Landing Pages, Device, New vs Returning). Each section reuses the canon helpers/
    classes (escapeHtml on EVERY GA4 string value, .panel, `<span class="badge-src">GA4</span>`,
    table.psg with tabular-nums, @media print break-inside via existing styleBlock):
      - Top Traffic Drivers: columns Channel / Sessions / Users / Share % (share = row.sessions
        / section total). Top-N rows + the (other) row already in the data.
      - Top Landing Pages: columns Landing page (escaped, CSS-truncated) / Sessions /
        Engagement rate. Top-N + (other).
      - Device Breakdown: columns Device / Sessions / Share %.
      - New vs Returning: columns Segment / Sessions / Share %.
    If a derived bounce_rate / averageSessionDuration is present, surface them as two small KPI
    stat lines in or above the Traffic Drivers panel (formatted: bounce_rate as %, duration as
    m:ss). Do NOT add a perf/"Performance Status" block — that is 12-05b. Do NOT modify the
    existing masthead/story/source-section/mom/recommendations rendering.
  </action>
  <verify>pnpm vitest run src/lib/report/__tests__/render.test.ts — asserts: the four section headings + a sample escaped landing-page value + the (other) row render when dimensions present, and NONE render when reportData.dimensions is undefined. `pnpm tsc --noEmit` clean; `pnpm build` green.</verify>
  <done>AC-4 satisfied.</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- src/lib/google-oauth/ga4-metrics.ts and ga4-sync.ts (the DAILY GA4 path — mirror, never edit)
- src/lib/analytics/types.ts `AnalyticsSource` union (stays the four flat sources — RESEARCH)
- report-data.ts `SOURCES` rollup array and the daily four-source assembly (byte-unchanged)
- src/lib/report/{prompt,schema,evaluate,narrative,generate}.ts — the LLM narrative + eval gate
  (no narrative cites a dimensional number in v1, so no buildPlaceholders change — RESEARCH eval note)
- vercel.json / any cron route (cron wiring is 12-05c)
- Any prod database (the migration is AUTHORED, applied at the 12-05c gate batch)

## SCOPE LIMITS
- Performance sources (PSI / CrUX / GTMetrix), their migration, secrets, and the perf render
  block are 12-05b — explicitly out of this plan.
- No cron route, no vercel.json entry, no deploy, no secret, no prod migration apply (12-05c).
- No new runtime dependency (reuse the googleapis/gax client already installed in Phase 11).
- bounce_rate is DERIVED (1 - engagement_rate), never fetched or stored.
</boundaries>

<verification>
Before declaring plan complete:
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm eslint` 0 errors on changed files
- [ ] `pnpm vitest run` green (existing suite + new ga4-dimensions / ga4-dims-sync / report-data / render tests)
- [ ] `pnpm build` green
- [ ] git diff shows ZERO prod contact (no migration applied, no env, no deploy); no edits to the daily GA4 path or the AnalyticsSource union
- [ ] All four acceptance criteria met
</verification>

<success_criteria>
- GA4 dimensional fetch issues one monthly runReport per dimension with reconciling (other) rows
- Monthly sync writes one idempotent ga4_dimensions snapshot row per linked shop with a ledger entry
- ReportData gains an additive optional dimensions block read off a rollup-bypassing monthly path
- Four canon-styled render sections appear only when dimensions data is present
- Build-local: tsc/eslint/vitest/build green, zero prod contact, no new dependency
</success_criteria>

<output>
After completion, create `.paul/phases/12-psg-report/12-05a-SUMMARY.md`.
Next in the arc: 12-05b (perf sources PSI/CrUX/GTMetrix, build-local + key gate), then
12-05c (cron wiring + the combined operator gate batch that applies this plan's migration and
closes Phase 12 + milestone v0.3).
</output>
