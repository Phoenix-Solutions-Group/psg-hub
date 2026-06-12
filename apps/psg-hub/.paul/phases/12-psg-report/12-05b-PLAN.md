---
phase: 12-psg-report
plan: 05b
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/perf/psi.ts
  - src/lib/perf/gtmetrix.ts
  - src/lib/perf/perf-sync.ts
  - src/lib/analytics/types.ts
  - src/lib/report/types.ts
  - src/lib/report/report-data.ts
  - src/lib/report/render.ts
  - supabase/migrations/20260612000000_performance_source.sql
  - src/lib/perf/__tests__/psi.test.ts
  - src/lib/perf/__tests__/gtmetrix.test.ts
  - src/lib/perf/__tests__/perf-sync.test.ts
  - src/lib/report/__tests__/report-data.test.ts
  - src/lib/report/__tests__/render.test.ts
autonomous: true
---

<objective>
## Goal
Add the REAL website-performance layer to the monthly report: a PSI (PageSpeed Insights)
lab + CrUX-field fetch, a GTMetrix async (POST-then-poll) fetch, a monthly perf ingest
orchestrator writing `period='monthly'` `source='performance'` `analytics_snapshots` rows, an
additive `ReportData.performance` block read off the monthly path, and ONE render block in the
canon design language that REPLACES the old Looker deliverable's bogus GA4 "Performance Status /
server response 14:49" panel with real PSI/GTMetrix numbers. Build-local, ZERO prod contact,
behind a `configured()` guard until the operator sets keys (12-05c).

## Purpose
Second plan of the 12-05 arc (GA4 dims ✅ 12-05a · perf sources THIS · cron+gate 12-05c).
GA4 has no page-load/server-response metric — the old report's "server response 14:49" is a
mis-mapped duration. This plan ingests honest lab + real-user (when present) + GTMetrix
performance numbers from PROPER sources, the deliverable gap that most embarrassed the canon.

## Output
PSI fetch (lab always, CrUX field render-if-present) + GTMetrix async fetch (max-poll ceiling +
429 backoff) + monthly perf-sync orchestrator (ledger, contained failure, idempotent upsert,
configured-guard) + authored (NOT applied) source-CHECK migration + `ReportData.performance`
type/reader + one render block, all behind `tsc 0 / eslint 0 / vitest green / build green`, no
prod write, no new dependency, no cron wiring, no secret.
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Research (GOVERNS this plan — exact endpoints, JSON paths, gotchas)
@.paul/phases/12-psg-report/12-05-RESEARCH.md
# Binding sections: "Performance data sources" (PSI v5 lab JSON paths + the CrUX field KEYS with
# their spelling traps + GTMetrix v2.0 async/credit/rate contract), "Which metric comes from which
# source", "Architecture decision: cadence" (Architecture B monthly ingest, operator-confirmed),
# "Report sections" #5 (the perf block), "Open questions" (the operator defaults locked below).

## Prior Work (12-05a — the pattern this plan mirrors + extends)
@.paul/phases/12-psg-report/12-05a-SUMMARY.md
# 12-05a established: SnapshotSource superset (already carries 'performance'), the monthly
# single-row ingest mirroring ga4-sync, the rollup-bypassing monthly reader, the migration that
# widens BOTH source CHECKs (snapshots + sync_runs), and the additive-optional ReportData block.

## Source Files (patterns to mirror — do NOT edit)
@src/lib/semrush/sync.ts                # shops.url eligibility (url-less SKIPPED), ledger, contained per-shop failure — the perf-sync template (URL-based, NOT OAuth-linked)
@src/lib/google-oauth/ga4-dims-sync.ts  # 12-05a monthly orchestrator: openLedger/closeLedger, one monthly row/shop date=YYYY-MM-01, idempotent upsert
@src/lib/resilience.ts                  # CircuitBreaker class + withRetry(fn, RetryOptions) — wrap EVERY external call
@src/lib/analytics/types.ts             # SnapshotSource (already includes 'performance'), AnalyticsSnapshotInsert, MonthlySnapshotRow
@src/lib/analytics/snapshots.ts         # upsertSnapshots (onConflict shop_id,source,date,period)
@src/lib/report/types.ts                # ReportData (12-05a added optional `dimensions`; this adds optional `performance`)
@src/lib/report/report-data.ts          # readMonthlyDimensions reader (12-05a) — readMonthlyPerformance MIRRORS it
@src/lib/report/render.ts               # canon helpers: escapeHtml, .panel, .badge-src, .kpi cards (good/warn/danger via up/down classes), table.psg, styleBlock
@supabase/migrations/20260611000000_ga4_dimensions_source.sql  # the 12-05a both-CHECKs migration to mirror for 'performance'
</context>

<skills>
## Required Skills (from SPECIAL-FLOWS.md)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first (phase + per-plan) | required | Before authoring | ✅ SATISFIED — 12-05-RESEARCH.md present; its "Performance data sources" section is a dedicated ultracode research pass over PSI v5 + CrUX + GTMetrix v2.0 (exact endpoints, JSON paths, the field-KEY spelling traps, async/credit/rate contract) |
| Context7 check at APPLY | optional | Before writing the PSI/GTMetrix parsers | Confirm PSI v5 `runPagespeed` response shape + GTMetrix API 2.0 `/tests`→`/reports` flow against current docs IF anything in RESEARCH reads stale; otherwise RESEARCH governs |

**BLOCKING:** none outstanding. The new external surfaces (PSI / CrUX / GTMetrix) are already
researched; 12-05b opens NO un-researched API. No new runtime dependency (plain HTTPS via the
Node-24 global `fetch`, NOT an SDK).

**⚠️ Build-blind caveat (SPECIAL-FLOWS mandate):** the PSI/GTMetrix parsers are written against
RESEARCH JSON paths, never run against a live response this plan. Lock the parsers behind
deps-injected `httpGet`/`httpPost` seams + presence-guarded field reads; the FIRST live keyed PSI
call + one live GTMetrix run are the 12-05c smoke (carry-forward, same as the 12-05a totals[0] check).
</skills>

<acceptance_criteria>

## AC-1: PSI lab + CrUX-field fetch (one call, field render-if-present)
```gherkin
Given a shop homepage URL and a PAGESPEED_API_KEY
When fetchPsi(url, deps) runs (strategy=mobile)
Then it issues ONE runPagespeed call and parses the lab block from `lighthouseResult`
  (perf_score = categories.performance.score * 100; LCP/TBT/FCP/SpeedIndex/TTFB in ms from the
  named audits; CLS unitless) — lab is ALWAYS present
And it reads the CrUX field from `loadingExperience.metrics` (URL) else `originLoadingExperience.metrics`
  (origin), using the RESEARCH-confirmed KEYS (LARGEST_CONTENTFUL_PAINT_MS, INTERACTION_TO_NEXT_PAINT,
  CUMULATIVE_LAYOUT_SHIFT_SCORE, EXPERIMENTAL_TIME_TO_FIRST_BYTE, FIRST_CONTENTFUL_PAINT_MS) with
  presence guards; CLS percentile is the integer scaled ×100 (10 -> 0.10)
And when no field block exists, field = null (a successful-EMPTY result that does NOT trip the
  CircuitBreaker), and origin_field flags whether the field came from the origin fallback
And every call is wrapped in CircuitBreaker + withRetry; configured() is false when PAGESPEED_API_KEY is unset
```

## AC-2: GTMetrix async POST-then-poll fetch (credit/rate safe)
```gherkin
Given a shop homepage URL and a GTMETRIX_API_KEY
When fetchGtmetrix(url, deps) runs
Then it POSTs /tests (HTTP Basic, key as username + blank password), then POLLS GET /tests/{id}
  on a fixed interval (injected for tests) through queued->started->completed, bounded by a hard
  max-poll ceiling, then reads the report fields from data.attributes
  (fully_loaded_time, time_to_first_byte, backend_duration, page_bytes, page_requests,
   largest_contentful_paint, total_blocking_time, cumulative_layout_shift, gtmetrix_grade,
   performance_score, structure_score)
And state='error' throws a contained error (caught by perf-sync), a 429 backs off, and exceeding
  the max-poll ceiling throws rather than hanging the Fluid invocation
And when GTMETRIX_API_KEY is unset, fetchGtmetrix is skipped (the perf row stores gtmetrix=null);
  every call is wrapped in CircuitBreaker + withRetry
```

## AC-3: Monthly perf ingest + ReportData.performance read off the monthly path
```gherkin
Given the perf-sync orchestrator runs over all shops with a non-empty website url
When it completes (and PAGESPEED_API_KEY is configured)
Then it writes exactly ONE analytics_snapshots row per url-bearing shop with source='performance',
  period='monthly', date=<first-of-report-month YYYY-MM-01>, metrics = { psi, gtmetrix|null, strategy,
  tested_url }; url-less shops are SKIPPED; a single shop's failure is CONTAINED and the batch
  continues, with one analytics_sync_runs ledger row (source='performance') opened/closed
And when PAGESPEED_API_KEY is unconfigured the orchestrator early-returns a designed no-op
  (synced:0) WITHOUT opening a torn ledger — the report degrades gracefully (no perf block)
And re-running nets zero new rows (idempotent on shop_id,source,date,period)
And assembleReportData populates ReportData.performance from a monthly performance row via a
  readMonthlyPerformance reader that bypasses rollupMonth; undefined when the reader is absent or
  returns null; the existing daily four-source assembly AND the 12-05a dimensions path are unchanged
```

## AC-4: One canon perf render block (replaces the bogus GA4 "Performance Status")
```gherkin
Given a ReportData with a populated performance block
When the report HTML is rendered
Then it emits ONE "Website performance" .panel with .badge-src tags (PageSpeed / GTMetrix) and
  KPI/status cards — Performance score (0-100, good/warn/danger by class), LCP, CLS,
  TTFB/server-response (GTMetrix backend_duration if present else PSI server-response-time), and
  (when GTMetrix present) fully loaded time + page weight
And the CrUX field row renders ONLY when psi.field is present; when field is null it renders
  lab-only with a "Lab data" label, never a blank or zeroed field block
And when ReportData.performance is undefined, the block does NOT render (no empty card)
And all values are formatted (score int, ms as s, bytes as KB/MB, CLS to 2-3 dp); no GA4
  "Performance Status" / "server response" string appears
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: PSI lab+field fetch + PerformanceMetrics types + source-CHECK migration</name>
  <files>src/lib/perf/psi.ts, src/lib/analytics/types.ts, supabase/migrations/20260612000000_performance_source.sql, src/lib/perf/__tests__/psi.test.ts</files>
  <action>
    Create `fetchPsi(url, deps)` in src/lib/perf/psi.ts (strategy MOBILE, the locked default).
    - Endpoint: GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<url>&strategy=mobile&category=performance&key=<PAGESPEED_API_KEY>.
      Use the Node-24 global `fetch` (NO new dependency, NO SDK). Inject an `httpGet` seam in deps
      (default = real fetch) so tests pass canned JSON; wrap the call in CircuitBreaker + withRetry
      (mirror ga4-dimensions.ts: a defaultBreaker + a retry with isRetryable on timeout/upstream/429),
      timeout >=30s (Lighthouse latency).
    - Parse LAB from `lighthouseResult` (RESEARCH "PSI API v5" table, paths CONFIRMED):
      perf_score = categories.performance.score * 100 (round); lab_lcp_ms = audits['largest-contentful-paint'].numericValue;
      lab_cls = audits['cumulative-layout-shift'].numericValue; lab_tbt_ms = audits['total-blocking-time'].numericValue;
      lab_fcp_ms = audits['first-contentful-paint'].numericValue; lab_speed_index_ms = audits['speed-index'].numericValue;
      lab_ttfb_ms = audits['server-response-time'].numericValue. All numeric, guard undefined -> null.
    - Parse FIELD (best-effort) from `loadingExperience.metrics` (URL) else `originLoadingExperience.metrics`
      (origin) — set origin_field=true when the origin fallback supplied it. KEYS (RESEARCH, spelling
      traps — guard each, fail silent to undefined): LARGEST_CONTENTFUL_PAINT_MS, INTERACTION_TO_NEXT_PAINT
      (NO _MS), CUMULATIVE_LAYOUT_SHIFT_SCORE, EXPERIMENTAL_TIME_TO_FIRST_BYTE, FIRST_CONTENTFUL_PAINT_MS.
      Read `.percentile` per key; CLS percentile is an INTEGER scaled ×100 -> divide by 100 for the real
      value; LCP/INP/FCP/TTFB percentiles are integer ms. Capture overall_category from
      loadingExperience.overall_category. If neither block exists OR has no metrics -> field = null
      (a SUCCESSFUL-EMPTY result; do NOT throw, do NOT trip the breaker — RESEARCH directive #3).
    - Export `psiConfigured()` = Boolean(process.env.PAGESPEED_API_KEY). Do NOT pull a separate CrUX
      queryRecord — PSI returns the field block in the SAME call (RESEARCH "one call returns BOTH"); a
      standalone crux.ts module is intentionally OMITTED to avoid a redundant metered call (defensible
      simplification of the RESEARCH 3-module split; the field IS CrUX).
    - Return a typed `PsiResult` (lab fields + field:{lcp_ms,inp_ms,cls,fcp_ms,ttfb_ms,overall_category}|null + origin_field).
    Add to src/lib/analytics/types.ts: `PsiResult`, `GtmetrixResult` (Task-2 shape, declare here), and
    `PerformanceMetrics = { psi: PsiResult; gtmetrix: GtmetrixResult | null; strategy: 'mobile'; tested_url: string }`
    (the jsonb shape of a performance row). Document field/score as render-if-present, aggregate-excluded
    point-in-time STOCK (never rolled up). DO NOT add 'performance' to the AnalyticsSource union —
    SnapshotSource already carries it (12-05a).
    Author migration 20260612000000_performance_source.sql MIRRORING 20260611000000: drop-and-recreate
    BOTH source CHECKs to additionally admit 'performance' — analytics_snapshots (keep null-allowance +
    semrush/google_ads/ga4/gsc/ga4_dimensions/performance) AND analytics_sync_runs (the ledger insert uses
    source='performance'; same auto-named-constraint note as 12-05a). AUTHORED ONLY — applied at 12-05c. No data migration.
  </action>
  <verify>pnpm vitest run src/lib/perf/__tests__/psi.test.ts — asserts: lab parsed from a canned lighthouseResult (score×100, named-audit ms, CLS unitless); field parsed from loadingExperience with the exact KEYS + CLS ÷100; field=null + NO throw + breaker NOT tripped when loadingExperience absent (origin fallback exercised); request carries strategy=mobile + key; retry/breaker seam exercised; psiConfigured() false with no env key. `pnpm tsc --noEmit` clean. Migration valid SQL + idempotent (visual; the both-CHECKs name note carried).</verify>
  <done>AC-1 satisfied; PerformanceMetrics type + authored migration unblock Task 2's upsert.</done>
</task>

<task type="auto">
  <name>Task 2: GTMetrix async fetch + perf-sync orchestrator + ReportData.performance reader</name>
  <files>src/lib/perf/gtmetrix.ts, src/lib/perf/perf-sync.ts, src/lib/report/types.ts, src/lib/report/report-data.ts, src/lib/perf/__tests__/gtmetrix.test.ts, src/lib/perf/__tests__/perf-sync.test.ts, src/lib/report/__tests__/report-data.test.ts</files>
  <action>
    Create `fetchGtmetrix(url, deps)` in src/lib/perf/gtmetrix.ts (RESEARCH "GTMetrix API v2.0"):
    - Base api.gtmetrix.com/api/2.0; HTTP Basic = GTMETRIX_API_KEY as username, BLANK password
      (Authorization: Basic base64(`${key}:`)).
    - ASYNC two-phase (no sync option): POST /tests -> { test id, state }; POLL GET /tests/{id} every
      `pollIntervalMs` (deps-injected, default ~3000) through queued->started->completed. On completion
      GET /tests/{id} returns a 303 redirect to GET /reports/{id} — the REPORT resource, where the
      fields live (NOT on /tests/{id}; name the /reports/{id} step explicitly so the parser + fixture
      target the right resource even though global fetch auto-follows the 303). Read data.attributes
      report fields from /reports/{id} (fully_loaded_time, onload_time, time_to_first_byte,
      backend_duration, page_bytes, html_bytes, page_requests, redirect_duration, connect_duration,
      largest_contentful_paint, total_blocking_time, cumulative_layout_shift, speed_index,
      time_to_interactive, gtmetrix_grade, gtmetrix_score, performance_score, structure_score) into a
      typed `GtmetrixResult`.
    - Guards: a hard MAX_POLLS ceiling (e.g. ~20) -> throw 'gtmetrix poll timeout' rather than hang the
      300s Fluid invocation; state='error' -> throw (contained by perf-sync); HTTP 429 (E42901) -> back
      off via withRetry. Inject httpPost/httpGet + a `sleep`/poll seam so tests run instantly. Wrap in
      CircuitBreaker + withRetry. Export `gtmetrixConfigured()` = Boolean(process.env.GTMETRIX_API_KEY).
    Create `syncPerformance(service, options)` in src/lib/perf/perf-sync.ts, MIRRORING semrush/sync.ts +
    ga4-dims-sync.ts:
    - **Configured guard FIRST:** if !psiConfigured() return { synced:0, skipped:0, failed:0 } WITHOUT
      opening a ledger (designed no-op; the report omits perf gracefully — AC-3). PSI is the required
      floor; GTMetrix is optional enrichment.
    - openLedger source='performance'; read shops (id, url); url-less -> skipped++ (mirror semrush
      normalizeDomain skip). For each url-bearing shop: build the homepage https URL, fetchPsi(url),
      and fetchGtmetrix(url) ONLY when gtmetrixConfigured() AND the shop is within the GTMetrix scope
      (else gtmetrix=null). Add options `gtmetrixShopLimit?: number` and/or `gtmetrixShopIds?: string[]`
      (test seam) so 12-05c can BOUND which shops get a GTMetrix run without editing this module — PSI
      runs for ALL url-shops, GTMetrix only for the bounded set. This exists because perf-sync polls
      GTMetrix in-loop (~60s/shop) on top of ~20s PSI/shop, so unbounded across N url-shops can exceed
      the 300s Fluid invocation (4 pilot shops × ~80s ≈ 320s) — the bound is the cheap escape hatch
      (default: no bound build-local; 12-05c sets the pilot scope). Push ONE
      AnalyticsSnapshotInsert { shop_id, source:'performance', period:'monthly', date:`${month}-01`,
      metrics:{ psi, gtmetrix, strategy:'mobile', tested_url } }. Contained per-shop failure (failed++,
      log, continue — no markAccountError, perf has no OAuth account). month = options.month ('YYYY-MM')
      else the calendar month of options.today. upsertSnapshots at the end; closeLedger success/error.
      Inject fetchPsi/fetchGtmetrix as deps (test seams).
    Extend ReportData (report/types.ts) with OPTIONAL `performance?: PerformanceReport` OUTSIDE `sources`
    (parallel to `dimensions`), shaped as the render-ready perf view (lab scalars + field|null +
    gtmetrix|null + tested_url). In report-data.ts add a SEPARATE `readMonthlyPerformance?: (q:{shopId,month})
    => Promise<MonthlySnapshotRow|null>` to AssembleDeps (MIRROR readMonthlyDimensions) and, when it
    returns a row, populate ReportData.performance from row.metrics WITHOUT rollupMonth and WITHOUT
    touching the daily SOURCES loop or the 12-05a dimensions path. Absent/null reader -> performance undefined.
  </action>
  <verify>pnpm vitest run src/lib/perf/__tests__/gtmetrix.test.ts src/lib/perf/__tests__/perf-sync.test.ts src/lib/report/__tests__/report-data.test.ts — asserts: GTMetrix POST->poll->completed parse, state=error throws, max-poll ceiling throws, gtmetrixConfigured gating; perf-sync writes ONE monthly performance row/shop (date=YYYY-MM-01), url-less skipped, contained failure + ledger close, configured-guard no-op (synced:0, no ledger) when PSI key unset, gtmetrix=null when its key unset; ReportData.performance populated from a monthly row + undefined when absent; the four daily-source tests AND the 12-05a dimensions tests still pass unchanged. `pnpm tsc --noEmit` clean.</verify>
  <done>AC-2 + AC-3 satisfied.</done>
</task>

<task type="auto">
  <name>Task 3: Website-performance render block (canon, replaces the bogus GA4 panel)</name>
  <files>src/lib/report/render.ts, src/lib/report/__tests__/render.test.ts</files>
  <action>
    Add ONE "Website performance" render section to render.ts, emitted only when
    reportData.performance is present, inserted after the GA4 dimensional sections (12-05a) and before
    the mom table. Reuse the canon helpers/classes (escapeHtml, .panel, `<span class="badge-src">`,
    .kpi cards with the up/down=good/danger tint, table.psg, @media print break-inside via styleBlock):
      - Badge row: `PageSpeed` always; `GTMetrix` when gtmetrix present.
      - KPI/status cards: Performance score (0-100; class good/warn/danger by threshold — e.g. >=90 good,
        50-89 warn, <50 danger, reusing the existing chg up/down color classes or a new small status
        class); LCP (field if present else lab, ms->s); CLS (field if present else lab, 2-3 dp);
        TTFB / server response (GTMetrix backend_duration if present else PSI lab_ttfb_ms, ms->s, the
        CORRECT replacement for the bogus "server response 14:49"); and when gtmetrix present, fully
        loaded time (ms->s) + page weight (bytes->KB/MB).
      - Field row: render the real-user (CrUX) distribution/overall_category ONLY when psi.field is
        present (a small "Real-user data" badge/line); when field is null, render the lab cards with a
        "Lab data" label and NO field row (never a blank/zeroed field block — RESEARCH directive #4).
      - Add any needed formatting helpers (ms->"N.Ns", bytes->"N KB"/"N.N MB", score class) next to the
        existing formatValue/formatDuration; escape the tested_url if shown.
    Do NOT add the GA4 dimensional sections logic (12-05a) or touch masthead/story/source/mom/
    recommendations/dimensions rendering. Do NOT emit any "Performance Status" or "server response"
    GA4-style string.
  </action>
  <verify>pnpm vitest run src/lib/report/__tests__/render.test.ts — asserts: the "Website performance" panel + PageSpeed badge render when performance present; a field row renders with field present and is ABSENT (with a "Lab data" label) when psi.field is null; GTMetrix cards (fully loaded / page weight) render only when gtmetrix present; the block does NOT render when reportData.performance is undefined; TTFB shows the GTMetrix backend_duration when present; no "server response 14:49"/"Performance Status" string. `pnpm tsc --noEmit` clean; `pnpm build` green.</verify>
  <done>AC-4 satisfied.</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- src/lib/analytics/types.ts `AnalyticsSource` union (stays the four flat sources — SnapshotSource already carries 'performance')
- src/lib/google-oauth/ga4-dimensions.ts, ga4-dims-sync.ts, and the 12-05a dimensions path (mirror, never edit)
- src/lib/semrush/sync.ts, ga4-sync.ts, gsc-sync, google-ads sync (the existing sync paths — mirror, never edit)
- report-data.ts daily SOURCES rollup + the daily four-source assembly + the 12-05a readMonthlyDimensions path (byte-unchanged)
- src/lib/report/{prompt,schema,evaluate,narrative,generate}.ts — the LLM narrative + eval gate (no narrative cites a perf number in v1 — RESEARCH eval note)
- vercel.json / any cron route (perf-sync cron wiring is 12-05c)
- Any prod database (the migration is AUTHORED, applied at the 12-05c gate batch)

## SCOPE LIMITS
- GA4 dimensional ingest + its render sections are 12-05a (DONE) — out of this plan.
- No cron route, no vercel.json entry, no deploy, no secret, no prod migration apply (all 12-05c).
- No new runtime dependency — plain HTTPS via the Node-24 global `fetch`, NOT a PSI/GTMetrix SDK.
- Mobile-only PSI (1 call/shop) + homepage-only tested URL — desktop column + multi-page are deferred.
- No standalone CrUX queryRecord module — the field comes free in the PSI response.
- GTMetrix plan-tier / fleet-credit-ceiling confirmation + the live keyed PSI/GTMetrix smoke are 12-05c.

</boundaries>

<verification>
Before declaring plan complete:
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm eslint` 0 errors on changed files
- [ ] `pnpm vitest run` green (existing suite + new psi / gtmetrix / perf-sync + extended report-data / render tests)
- [ ] `pnpm build` green
- [ ] git diff shows ZERO prod contact (no migration applied, no env, no deploy); no edits to AnalyticsSource union, the 12-05a dimensions path, or any existing sync path
- [ ] All four acceptance criteria met
</verification>

<success_criteria>
- PSI fetch returns lab always + CrUX field render-if-present (field=null is a successful-empty, breaker untripped)
- GTMetrix async fetch is credit/rate safe (max-poll ceiling + 429 backoff + state=error contained), optional via configured()
- perf-sync writes one idempotent monthly 'performance' row per url-bearing shop with a ledger entry, behind a PSI configured-guard no-op
- ReportData gains an additive optional performance block read off the rollup-bypassing monthly path
- One canon perf render block replaces the bogus GA4 "Performance Status"; field row only when CrUX present, else "Lab data"
- Build-local: tsc/eslint/vitest/build green, zero prod contact, no new dependency, no cron, no secret
</success_criteria>

<output>
After completion, create `.paul/phases/12-psg-report/12-05b-SUMMARY.md`.
Next in the arc: 12-05c (cron wiring for perf-sync + ga4-dims + the combined operator gate batch
that applies the 12-05a + 12-05b migrations, sets PAGESPEED_API_KEY [+ CrUX-enabled] + GTMETRIX_API_KEY,
runs the live keyed PSI + GTMetrix smoke, and closes Phase 12 + milestone v0.3).

## Carry-forward to 12-05c (build-blind + scaling — surface in 12-05b-SUMMARY)
1. **Live-parser smoke (build-blind):** run ONE keyed PSI call + one GTMetrix run against the Wallace
   pilot to confirm the `lighthouseResult` / `loadingExperience` / `/reports/{id}` response shapes
   match the parsers (the JSON paths were written from RESEARCH, never run live this plan).
2. **GTMetrix WALL-CLOCK ceiling (not just credits):** perf-sync polls GTMetrix in-loop (~60s/shop) on
   top of ~20s PSI/shop; across N url-shops the run can exceed the 300s Fluid invocation (4 pilot shops
   × ~80s ≈ 320s). 12-05c MUST scope GTMetrix via `gtmetrixShopLimit`/`gtmetrixShopIds` to the pilot,
   sequence it, OR move to a two-phase submit-then-collect design — AND confirm the GTMetrix plan-tier
   daily-credit allowance (Micro 10 / Growth 100 / Team 300 / Enterprise 500; fleet 842/day > Enterprise).
3. **Cron ordering:** the perf-sync cron must run BEFORE the `0 0 1 * *` report cron; the report
   degrades to last-good monthly rows if a sync is late.
</output>
