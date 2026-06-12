---
phase: 12-psg-report
plan: 05c
type: execute
wave: 1
depends_on: ["12-05a", "12-05b"]
files_modified:
  - src/lib/analytics/snapshots.ts
  - src/app/reports/[slug]/print/route.ts
  - src/app/api/cron/ga4-dims-sync/route.ts
  - src/app/api/cron/perf-sync/route.ts
  - vercel.json
  - src/app/reports/[slug]/print/__tests__/print-route.test.ts
  - .paul/phases/12-psg-report/12-05c-GATE-BATCH.md
autonomous: false
---

<objective>
## Goal
Wire the GA4-dimensional + performance monthly ingests into the live report and close
Phase 12 + milestone v0.3. Two build-local tasks (reader-wiring + two cron routes,
ZERO prod), then one operator gate batch (apply the 12-05a/b migrations, set the new
secrets, deploy, live-smoke the build-blind parsers, merge to main).

## Purpose
12-05a (GA4 dims) and 12-05b (perf PSI/CrUX/GTMetrix) shipped the ingest orchestrators
and the render sections build-local, but NOTHING activates them yet: the monthly rows
are never produced (no cron) and never reach the PDF (the print route binds
`assembleReportData` WITHOUT the monthly readers). This plan closes both gaps and runs
the combined activation that turns the base report (12-04, already live) into the full
canon report the operator asked for after reviewing the Wallace Looker deliverable.

## Output
- A monthly single-row reader bound into the print route → the 4 GA4 dimensional
  sections + the Website-performance block render in the PDF.
- Two CRON_SECRET-gated monthly cron routes (`ga4-dims-sync`, `perf-sync`), ordered
  BEFORE the report cron, each injecting the prior (just-completed) month.
- The combined operator gate-batch runbook (`12-05c-GATE-BATCH.md`).
- Phase 12 + milestone v0.3 closed (the deferred 12-04 Stage-G merge folds in here).
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Prior Work (direct inputs)
@.paul/phases/12-psg-report/12-05a-SUMMARY.md   # GA4 dims ingest + readMonthlyDimensions seam + 0611 migration
@.paul/phases/12-psg-report/12-05b-SUMMARY.md   # perf ingest + readMonthlyPerformance seam + 0612 migration + GTMetrix scope hook
@.paul/phases/12-psg-report/12-04-GATE-BATCH.md  # the base-report activation pattern (Stages A-G) this extends

## Source Files (the wiring sites + orchestrators + binding pattern)
@src/lib/report/report-data.ts                  # assembleReportData accepts OPTIONAL readMonthlyDimensions/readMonthlyPerformance
@src/app/reports/[slug]/print/route.ts          # defaultLoader — the PDF path; binds assembleReportData WITHOUT the readers (the gap)
@src/app/api/cron/monthly-report/route.ts        # narrative path — binds assembleReportData WITHOUT the readers (LEAVE AS-IS, eval-safe)
@src/lib/report/prompt.ts                        # buildPlaceholders iterates ONLY linkedSources → why the narrative path is grounding-safe
@src/lib/analytics/snapshots.ts                  # getSnapshots (daily, 4-source-typed) — add the monthly single-row reader here
@src/lib/google-oauth/ga4-dims-sync.ts           # syncGa4Dimensions(service, { month }) — orchestrator to trigger
@src/lib/perf/perf-sync.ts                       # syncPerformance(service, { month, gtmetrixShopIds }) — orchestrator to trigger
@src/app/api/cron/ga4-sync/route.ts              # the cron-route template (CRON_SECRET gate + 503 not-configured + runtime nodejs)
@vercel.json                                     # 5 crons today; report at `0 0 1 * *`
@supabase/migrations/20260611000000_ga4_dimensions_source.sql  # 12-05a — apply at gate batch
@supabase/migrations/20260612000000_performance_source.sql     # 12-05b — apply at gate batch (recreates CHECK with the full 6-value set)
</context>

<skills>
## Required Skills (from SPECIAL-FLOWS.md)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first (per-plan check) | required | Before authoring | ✅ Satisfied — `12-05-RESEARCH.md` covers GA4 dims + CrUX/PSI/GTMetrix; 12-05c opens NO new external-API surface (cron wiring + activation of already-researched 12-05a/b) |
| PROTOCOL-migration-safety.md | required | Gate-batch Stage A (prod migration apply) | ○ — advisor baseline + diff per migration |

**BLOCKING:** No new API/library contract is opened. The migration-safety protocol
governs the Stage-A prod apply (operator gate, Task 3).
</skills>

<acceptance_criteria>

## AC-1: The PDF renders the GA4 dimensional + performance sections (print path only)
```gherkin
Given a shop has a period='monthly' ga4_dimensions row AND a performance row for the report month
When the Hetzner worker fetches /reports/{shopId}__{period}/print
Then assembleReportData is called WITH readMonthlyDimensions + readMonthlyPerformance bound to a service-client monthly reader
And the rendered HTML contains the four GA4 dimensional sections and the "Website performance" block
And the monthly-report cron's narrative binding is UNCHANGED (stays on the four linked sources — buildPlaceholders never traverses dimensions/performance, so the eval gate cannot be tripped by an ungrounded dims/perf number)
```

## AC-2: Two monthly cron routes, prior-month-injected, ordered before the report
```gherkin
Given the two ingest orchestrators (syncGa4Dimensions, syncPerformance)
When /api/cron/ga4-dims-sync and /api/cron/perf-sync receive a request
Then each rejects a missing/invalid CRON_SECRET with 401 BEFORE any work
And each returns 503 when its prerequisite env is unset (ga4-dims: the Phase-11 Google OAuth creds; perf: PAGESPEED_API_KEY)
And each invokes its orchestrator with month = priorMonth(current YYYY-MM) so the row date is {just-completed-month}-01 — exactly what the report reads (monthly-report/route.ts computes the same priorMonth)
And vercel.json lists 7 crons with ga4-dims-sync AND perf-sync scheduled on the 1st BEFORE the monthly-report cron
```

## AC-3: GTMetrix is scoped to the pilot via env (Fluid-ceiling + credit safe)
```gherkin
Given GTMetrix in-loop polling is ~80s/shop and the 300s Fluid invocation ceiling
When the perf-sync route runs
Then it passes gtmetrixShopIds (from GTMETRIX_SHOP_IDS, comma-split) — or a small gtmetrixShopLimit fallback — so GTMetrix runs only for the pilot shop(s)
And PSI still runs for all url-bearing shops (the ~4 url-shops today fit the ceiling; fleet-scale 842-shop batching is recorded as a deferred follow-on, NOT silently "covered")
```

## AC-4: Combined gate-batch runbook authored; build-local stays green + ZERO prod + no new dep
```gherkin
Given Tasks 1-2 are build-local
When the plan completes
Then 12-05c-GATE-BATCH.md exists with: Stage 0 PAGESPEED_API_KEY lead-time (keyless PSI quota = 0, hard prereq) + GTMETRIX_API_KEY + GTMETRIX_SHOP_IDS; Stage A apply 20260611 + 20260612 under PROTOCOL (verify the auto-named analytics_sync_runs_source_check; insert one ga4_dimensions AND one performance proof row into BOTH analytics_snapshots and analytics_sync_runs); Stage B set secrets + vercel --prod; Stage C live smoke (confirm the build-blind PSI loadingExperience / GTMetrix /reports/{id} / GA4 totals[0] parsers against Wallace, then a real PDF showing the new sections); Stage D merge feature/12-psg-report → main + secret rotation (closes Phase 12 + v0.3)
And tsc 0 / eslint 0 / vitest green / build green
And package.json is unchanged (no new runtime dependency) and Tasks 1-2 make ZERO prod contact
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Monthly single-row reader + wire it into the print (PDF) path only</name>
  <files>src/lib/analytics/snapshots.ts, src/app/reports/[slug]/print/route.ts, src/app/reports/[slug]/print/__tests__/print-route.test.ts</files>
  <action>
    Make the ingested monthly rows reach the PDF — print path ONLY.

    1. snapshots.ts — add `getMonthlySnapshot(client, { shopId, source, month })`:
       - `source` typed as the `SnapshotSource` superset (admits 'ga4_dimensions' |
         'performance'), NOT the 4-value `AnalyticsSource` union (that is why
         getSnapshots cannot be reused directly).
       - Query TABLE where shop_id = shopId, source = source, period = 'monthly',
         date = `${month}-01`; `.maybeSingle()`. Throw on a real error, return null on
         no row. Return typed `MonthlySnapshotRow | null`.
    2. print/route.ts `defaultLoader` — bind the two optional readers and pass them
       into the existing `assembleReportData(shopId, period, { ... })` call:
       ```
       const readMonthlyDimensions: MonthlyDimensionsReader =
         ({ shopId, month }) => getMonthlySnapshot(service, { shopId, source: "ga4_dimensions", month });
       const readMonthlyPerformance: MonthlyPerformanceReader =
         ({ shopId, month }) => getMonthlySnapshot(service, { shopId, source: "performance", month });
       ```
       Add both to the deps object. `service` is already the service client (the print
       route is RENDER_TOKEN-gated/internal, not a user session) — correct for a render
       read. Import the two reader types from report-data.ts.
    3. DO NOT touch src/app/api/cron/monthly-report/route.ts. Its `assembleReportData`
       binding stays on the four sources: `buildPlaceholders` (prompt.ts:53-55) iterates
       ONLY `linkedSources → sources[].current`, so the writer can never cite a dims/perf
       number and the eval gate cannot hold on one. Wiring the narrative path would
       re-open the exact 12-04 grounding trap for zero product gain (the canon dims/perf
       sections are tabular, not narrated).
    4. Test (print-route.test.ts) — add cases proving the wiring: defaultLoader/handle
       with a stubbed loader where a populated ga4_dimensions + performance monthly row
       yields HTML containing the dimensional section headings AND the "Website
       performance" block; and a no-monthly-row case still renders the base report
       (graceful omission). Assert both readers are passed (a silent un-wiring must fail
       a test — the advisor's regression guard).
  </action>
  <verify>pnpm tsc --noEmit (0); pnpm vitest run src/app/reports (print-route cases green incl. the new dims+perf render + omission); grep confirms monthly-report/route.ts assembleReportData binding UNCHANGED</verify>
  <done>AC-1 satisfied: the PDF path assembles with both monthly readers and renders the new sections; the narrative/eval path is untouched and grounding-safe.</done>
</task>

<task type="auto">
  <name>Task 2: Two monthly cron routes (prior-month-injected, GTMetrix-scoped) + vercel.json ordering</name>
  <files>src/app/api/cron/ga4-dims-sync/route.ts, src/app/api/cron/perf-sync/route.ts, vercel.json</files>
  <action>
    Clone the ga4-sync route template (CRON_SECRET timingSafeEqual gate → 503
    not-configured guard → service client → orchestrator; `export const runtime =
    "nodejs"`; GET + POST both call one `handle`).

    1. ga4-dims-sync/route.ts:
       - Gate: CRON_SECRET (401). Not-configured 503 when the Phase-11 Google OAuth
         creds are absent (GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET +
         GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI) — identical guard to ga4-sync (GA4 has no
         dev token).
       - `const month = priorMonth(new Date().toISOString().slice(0, 7));`
       - `await syncGa4Dimensions(service, { month });` Return the SyncResult JSON.
    2. perf-sync/route.ts:
       - Gate: CRON_SECRET (401). Not-configured 503 when PAGESPEED_API_KEY is unset
         (`psiConfigured()` — PSI is the required floor; keyless quota = 0).
       - `const month = priorMonth(...)` (same idiom).
       - GTMetrix scope from env: read `GTMETRIX_SHOP_IDS` (comma-split, trimmed,
         non-empty) → pass as `gtmetrixShopIds`; if unset, pass a conservative
         `gtmetrixShopLimit` (e.g. 1) so an unscoped prod run can never fan ~80s/shop
         GTMetrix polls past the 300s Fluid ceiling.
       - `await syncPerformance(service, { month, gtmetrixShopIds | gtmetrixShopLimit });`
    3. vercel.json — append the two crons and MOVE the report cron later on the 1st so
       the monthly ingests land first (the report degrades to last-good rows if a sync
       is late — 12-05a/b carry-forward). Target order (all on the 1st, UTC):
       - `/api/cron/ga4-dims-sync`  → `0 2 1 * *`
       - `/api/cron/perf-sync`      → `0 3 1 * *`  (1h after dims; perf is the slow one)
       - `/api/cron/monthly-report` → CHANGE `0 0 1 * *` → `0 5 1 * *`
       The four daily syncs (06:00-06:45) are untouched (they feed the DAILY rollup, not
       the monthly dims/perf rows; their time vs the report is irrelevant). Result = 7
       crons. Note in-file that the report-cron hour moved (the July-1 scheduled
       verification agent still fires the same day).
    4. Route auth tests mirroring monthly-route.test.ts: 401 on bad secret; 503 on
       not-configured; 200 path invokes the orchestrator with the injected prior month
       (assert the `month` argument).
  </action>
  <verify>pnpm tsc --noEmit (0); pnpm build (ƒ ga4-dims-sync + ƒ perf-sync compiled, runtime nodejs); vercel.json shows 7 crons with both ingests before monthly-report; pnpm vitest run (route auth + month-injection tests green)</verify>
  <done>AC-2 + AC-3 satisfied: both cron routes gate-then-503, inject the prior month, GTMetrix is env-scoped, and vercel.json orders the ingests before the report.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    Authoring `12-05c-GATE-BATCH.md` (the operator runbook) is part of THIS task; the
    operator then EXECUTES it (prod migrations + new secrets + deploy + live smoke +
    merge). Same build-local → operator-gate shape as 12-04 / 11-04 / 10-03. The loop
    closes on a REAL PDF that renders the new GA4 dimensional + performance sections (not
    a cron-200), or — if a lead-time blocker hits — an honest activation-pending close
    with the base report still live.
  </what-built>
  <how-to-verify>
    The runbook (Claude authors it; operator runs it):

    Stage 0 — lead-time secrets (do FIRST):
      - PAGESPEED_API_KEY: a Google Cloud API key with the PageSpeed Insights API
        enabled. HARD prereq for the ENTIRE perf section (keyless PSI quota = 0); without
        it perf-sync 503s and the perf block omits. Treat like the 10-03 dev-token.
      - GTMETRIX_API_KEY (operator's GTMetrix account) + GTMETRIX_SHOP_IDS (the Wallace
        pilot shop id — pilot scope; fleet credits exceed even Enterprise/day).

    Stage A — apply both migrations to gylkkzmcmbdftxieyabw under PROTOCOL
    (advisor baseline + diff): `20260611000000_ga4_dimensions_source.sql` then
    `20260612000000_performance_source.sql` (0612 recreates the CHECK with the full
    6-value set, preserving ga4_dimensions). VERIFY the auto-named
    `analytics_sync_runs_source_check` (`\d+ public.analytics_sync_runs`) before trusting
    the widen — if the live name differs the IF-EXISTS drop silently no-ops. PROOF:
    insert one `ga4_dimensions` AND one `performance` row into BOTH analytics_snapshots
    and analytics_sync_runs, then clean them.

    Stage B — set the three secrets on Vercel; `vercel --prod` from the repo root.
    Verify: 7 crons; ƒ ga4-dims-sync + ƒ perf-sync live.

    Stage C — live smoke (confirm the build-blind parsers, 12-05a/b carry-forward):
      1. POST /api/cron/ga4-dims-sync (Bearer CRON_SECRET) → a ga4_dimensions monthly row
         for Wallace; confirm topChannels/topLandingPages/devices/newVsReturning populated
         and the TOTAL-reconciled `(other)` (the `metricAggregations` totals[0] parse,
         never run live).
      2. POST /api/cron/perf-sync → a performance monthly row for Wallace; PSI lab present,
         CrUX field present-or-null, GTMetrix present (Wallace in scope) — confirms the
         loadingExperience + /reports/{id} parsers.
      3. POST /api/cron/monthly-report (idempotent) for the smoke month → a REAL PDF that
         now renders the four GA4 dimensional sections + the "Website performance" block
         (replacing the old GA4 "server response 14:49"). Operator visually confirms the
         new sections; the membership-gated download still 200-owner / 401-unauth.

    Stage D — milestone close: merge feature/12-psg-report → main (the deferred 12-04
    Stage G) + rotate the chat-pasted secrets (12-04 carry: Hetzner / AI Gateway /
    SendGrid + now PAGESPEED / GTMETRIX). Closes Phase 12 + milestone v0.3.

    Fallback: if the Google Cloud key or GTMetrix access has lead time, close 12-05c with
    activation-pending recorded honestly (Phase-9 precedent). The BASE report is already
    live (12-04); the expansion degrades gracefully (no key → perf omits; no dims-sync →
    dims omit), so the report still ships and the milestone still closes.
  </how-to-verify>
  <resume-signal>Type "activated" with the real-PDF confirmation (new sections visible), or "activation-pending: &lt;blocker&gt;" to close honestly on the live base report.</resume-signal>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- src/app/api/cron/monthly-report/route.ts assembleReportData binding (eval-safe on the
  four sources — wiring it re-opens the 12-04 grounding trap).
- src/lib/report/report-data.ts, render.ts, prompt.ts, evaluate.ts (12-01/02/04 +
  12-05a/b shipped them; this plan only BINDS the existing optional reader seams).
- The ingest orchestrators ga4-dims-sync.ts / perf-sync.ts and the fetchers
  ga4-dimensions.ts / psi.ts / gtmetrix.ts (built + tested in 12-05a/b; only TRIGGERED here).
- The four daily sync crons + their schedules.
- The two authored migration files (apply as-is at the gate batch; do not rewrite).

## SCOPE LIMITS
- NO new runtime dependency (package.json unchanged).
- Tasks 1-2 make ZERO prod contact — all prod actions are the Task-3 operator gate.
- NO AnalyticsSource union change (dims/perf stay DB-only SnapshotSource, per RESEARCH).
- Fleet-scale (842-shop) perf batching/queueing is OUT — record it as a deferred
  follow-on; the pilot-scoped path is what activates now.
- Peec AI + Local Falcon ingestion stays the post-v0.3 follow-on (not this plan).
</boundaries>

<verification>
Before declaring plan complete:
- [ ] pnpm tsc --noEmit → 0
- [ ] pnpm eslint (changed files) → 0 errors
- [ ] pnpm vitest run → green (new print-route render/omission + two cron-route auth/month tests)
- [ ] pnpm build → green; ƒ ga4-dims-sync + ƒ perf-sync present (runtime nodejs)
- [ ] vercel.json → 7 crons; ga4-dims-sync + perf-sync BEFORE monthly-report on the 1st
- [ ] git: package.json unchanged; monthly-report/route.ts binding unchanged; migrations untracked-or-applied-only-at-gate
- [ ] 12-05c-GATE-BATCH.md authored (Stages 0–D)
- [ ] All acceptance criteria met
</verification>

<success_criteria>
- The PDF path assembles with both monthly readers; the four GA4 dimensional sections +
  the Website-performance block render when the rows exist (graceful omission otherwise).
- Two prior-month-injected, env-guarded cron routes exist; vercel.json orders them before
  the report; GTMetrix is pilot-scoped under the Fluid ceiling.
- The combined gate-batch runbook is authored and executed (or honestly
  activation-pending), closing Phase 12 + milestone v0.3.
- tsc 0 / eslint 0 / vitest green / build green; no new dep; ZERO prod contact in Tasks 1-2.
</success_criteria>

<output>
After completion, create `.paul/phases/12-psg-report/12-05c-SUMMARY.md`.
</output>
