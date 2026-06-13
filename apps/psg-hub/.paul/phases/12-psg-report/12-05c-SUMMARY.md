---
phase: 12-psg-report
plan: 05c
subsystem: api
tags: [monthly-ingest, cron, report-render, ga4-dimensions, performance, operator-gate, milestone-close, activation-pending]

# Dependency graph
requires:
  - phase: 12-psg-report (12-05a)
    provides: GA4 dimensional ingest orchestrator (syncGa4Dimensions), SnapshotSource superset, MonthlyDimensionsReader seam, 20260611 migration, 4 render sections
  - phase: 12-psg-report (12-05b)
    provides: performance ingest orchestrator (syncPerformance) + PSI/GTMetrix fetchers, MonthlyPerformanceReader seam, 20260612 migration, gtmetrixShopLimit/Ids scope hook, "Website performance" render block
  - phase: 12-psg-report (12-04)
    provides: the live base report (monthly cron + Hetzner worker + private bucket + SendGrid template) this expansion layers onto — no new worker
provides:
  - getMonthlySnapshot (rollup-bypassing monthly single-row reader, SnapshotSource-typed)
  - readMonthlyDimensions + readMonthlyPerformance bound into the PRINT (PDF) path only — the GAP that kept 12-05a/b rows out of the PDF, now closed
  - two CRON_SECRET-gated monthly cron routes (ga4-dims-sync, perf-sync), prior-month-injected, GTMetrix pilot-scoped
  - vercel.json 5->7 crons, both ingests ordered before the report (report moved 0 0 1 -> 0 5 1)
  - 12-05c-GATE-BATCH.md operator runbook (Stages 0-D)
affects: [closes Phase 12 + milestone v0.3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "print-path-only reader wiring (narrative/eval binding left untouched so buildPlaceholders cannot cite an ungrounded dims/perf number — avoids the 12-04 grounding-hold trap)"
    - "prior-month-injected monthly cron (month = priorMonth(now)) matching the report cron's own priorMonth so the row date aligns with what the report reads"
    - "env-scoped metered-call fan-out (GTMETRIX_SHOP_IDS comma-split -> gtmetrixShopIds; unset -> safe gtmetrixShopLimit 1) keeping the in-loop GTMetrix poll under the 300s Fluid ceiling"

key-files:
  created:
    - src/app/api/cron/ga4-dims-sync/route.ts
    - src/app/api/cron/perf-sync/route.ts
    - src/lib/google-oauth/__tests__/ga4-dims-sync-route.test.ts
    - src/lib/perf/__tests__/perf-sync-route.test.ts
    - .paul/phases/12-psg-report/12-05c-GATE-BATCH.md
  modified:
    - src/lib/analytics/snapshots.ts
    - src/app/reports/[slug]/print/route.ts
    - src/app/reports/[slug]/print/__tests__/print-route.test.ts
    - vercel.json

key-decisions:
  - "wire the readers into the PRINT path ONLY; leave monthly-report/route.ts (narrative) binding untouched — eval-safe"
  - "close 12-05c activation-pending (operator declined the CRON_SECRET rotation needed for a live smoke); the expansion auto-activates on the July 1 cron"
  - "GTMetrix scoped to the Wallace pilot shop id via GTMETRIX_SHOP_IDS env (fleet credits exceed even Enterprise/day)"

# Metrics
duration: ~build-local + multi-session operator gate
completed: 2026-06-13
---

# Phase 12 Plan 05c: Cron Wiring + Combined Operator Gate Batch Summary

**Closed the two activation gaps from 12-05a/b and ran the combined operator gate batch through prod deploy: a rollup-bypassing monthly reader wired into the PRINT path so the GA4-dimensional + performance rows reach the PDF, two prior-month-injected CRON_SECRET cron routes (`ga4-dims-sync`, `perf-sync`) ordered before the report, vercel.json 5->7 crons, both source-CHECK migrations applied to prod (advisor zero-delta, 6-value CHECKs verified), and the three new secrets set + deployed. The live smoke (Stage C) was SKIPPED by operator decision — CRON_SECRET is Vercel-Sensitive/un-pullable and the operator declined the rotation a manual trigger would need — so 12-05c closes ACTIVATION-PENDING: the expansion is deployed and DB-ready and auto-activates on the July 1 monthly crons, with the base report live since 12-04. Closes Phase 12 + milestone v0.3.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: PDF renders the GA4 dimensional + performance sections (print path only) | **PARTIAL — code-complete + unit-verified; live worker-render DEFERRED** | `getMonthlySnapshot` added (SnapshotSource-typed, period='monthly', date=`${month}-01`, maybeSingle); print/route `defaultLoader` binds both readers into `assembleReportData`; print-route.test asserts both readers fire (sources contain `ga4_dimensions`+`performance`, month=2026-05) and the null-row omission case. `monthly-report/route.ts` binding confirmed UNCHANGED (grep). **NOT proven end-to-end through the Hetzner worker — that is exactly the Stage-C smoke that was skipped.** |
| AC-2: Two monthly cron routes, prior-month-injected, ordered before the report | **Pass (deployed + probed)** | Both routes 401 before work (timingSafeEqual), 503 on missing prereq env (ga4-dims: Google OAuth creds; perf: PAGESPEED_API_KEY), inject `month=priorMonth(now)`, runtime=nodejs, GET+POST. vercel.json = 7 crons: ga4-dims-sync `0 2 1 * *`, perf-sync `0 3 1 * *`, monthly-report moved `0 0 1`->`0 5 1`; 4 daily syncs untouched. Live probe post-deploy: all routes 401 unauth (alive + gated). Unit tests assert 401/401/503/200-prior-month. |
| AC-3: GTMetrix scoped to the pilot via env (Fluid-ceiling + credit safe) | **Pass** | perf-sync reads `GTMETRIX_SHOP_IDS` (comma-split, trimmed) -> `gtmetrixShopIds`; unset -> `gtmetrixShopLimit:1` fallback. PSI runs all url-bearing shops. `GTMETRIX_SHOP_IDS` set on prod = Wallace shop id. Fleet-scale (842-shop) perf batching recorded as a deferred follow-on (NOT silently covered). |
| AC-4: Combined gate-batch runbook authored; build-local green + ZERO prod (Tasks 1-2) + no new dep | **Pass** | 12-05c-GATE-BATCH.md authored (Stage 0 secrets, A migrations, B secrets+deploy, C live smoke, D merge+rotate, activation-pending fallback). Gates: tsc 0 / eslint 0 / vitest 584 / build green. package.json unchanged. Tasks 1-2 made ZERO prod contact; all prod actions were the Task-3 gate. |

## Verification Results

- `pnpm vitest run` — **584 passed** (+11 over 12-05b's 573: print-route regression + null-omission, ga4-dims-sync-route 401/401/503/200, perf-sync-route 401/401/503/200 + gtmetrixShopLimit fallback + GTMETRIX_SHOP_IDS comma-split)
- `pnpm tsc --noEmit` — clean
- `pnpm eslint` (changed files) — 0 errors
- `pnpm build` — green; ƒ ga4-dims-sync + ƒ perf-sync compiled (runtime nodejs)
- `vercel.json` — 7 crons; both ingests before monthly-report on the 1st
- Prod migrations — both applied to `gylkkzmcmbdftxieyabw`; advisor 124 -> 124 (zero delta, only the two CHECK swaps); both source CHECKs now 6-value (`semrush, google_ads, ga4, gsc, ga4_dimensions, performance`); `analytics_sync_runs_source_check` auto-name verified before the widen; four proof rows inserted (all accepted) then cleaned
- Prod deploy — `vercel --prod` from repo root -> `dpl_FEDz4AE6mWxrydVcJHQ9Gsb2h7kn` READY, aliased hub.psgweb.me; three secrets set (`PAGESPEED_API_KEY`, `GTMETRIX_API_KEY`, `GTMETRIX_SHOP_IDS`)
- Commits — `1f6345a` (12-05a + 12-05b expansion) + `e7a535b` (12-05c cron wiring + activation) on `feature/12-psg-report`

## Gate Batch Execution (Task 3)

| Stage | Status | Result |
|-------|--------|--------|
| 0 — lead-time secrets | ✅ | PAGESPEED_API_KEY + GTMETRIX_API_KEY supplied by operator; GTMETRIX_SHOP_IDS = Wallace shop id |
| A — apply both migrations under PROTOCOL | ✅ | advisor zero-delta; constraint name verified; 6-value CHECKs; 4 proof rows accepted + cleaned |
| B — set secrets + deploy | ✅ | 3 prod secrets set; dpl_FEDz4AE6mWxrydVcJHQ9Gsb2h7kn READY; 7 crons live; routes 401-gated; Wallace shops.url set (was NULL) |
| C — live smoke (build-blind parsers + real PDF) | **⏸ SKIPPED** | CRON_SECRET Vercel-Sensitive/un-pullable + not in local .env or home secret files; operator declined the rotation a manual trigger needs -> activation deferred to the July 1 crons |
| D — merge -> main + rotate secrets | (milestone close) | folded into the Phase-12 transition + post-close hygiene |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Activation-pending close | 1 | Stage C skipped — expansion deployed but not live-verified |
| Monitoring gap recorded | 1 | July 1 first-run of build-blind parsers is unmonitored |
| Prod data fix | 1 | Wallace shops.url set (enables perf-sync + SEMrush for Wallace) |

### 1. [Activation-pending] Stage C live smoke skipped — closed honestly on the live base report
- **Decision (operator):** skip the smoke, close 12-05c activation-pending.
- **Why:** CRON_SECRET is marked Sensitive in Vercel (write-only — un-pullable by CLI, API, or dashboard) and is not mirrored in local `.env.local` or the `~/.psg-*` secret files. The only path to a manual cron trigger now was to ROTATE CRON_SECRET (fresh value + `vercel env rm/add` + redeploy); the operator declined the extra rotation + redeploy.
- **Impact:** the GA4-dimensional ingest, the performance ingest, and their first live render into the PDF are deferred to the scheduled July 1 monthly crons (`0 2`/`0 3`/`0 5` on the 1st). The base report (12-01..12-04) is live and verified since 12-04, and the expansion degrades gracefully (no dims row -> 4 GA4 sections omit; no perf row -> Website-performance block omits), so the report still ships. This is the Phase-9 / gate-batch-documented activation-pending precedent.

### 2. [Monitoring gap — RECORDED, action required] July 1 is an unmonitored first-run of build-blind parsers
- **The risk:** unlike the Phase-9 activation-pending precedent (code *not deployed*, would not run until activated), 12-05c is *deployed and live* — the new crons fire July 1 regardless. The GA4 `metricAggregations` `totals[0]`/`(other)` parse, the PSI `loadingExperience` parse, and the GTMetrix `/reports/{id}` parse have NEVER run against a live response (written from RESEARCH). 12-04 found TWO prod bugs at this exact smoke gate.
- **The gap:** the existing scheduled cloud agent `trig_01G7MfA382AUXYTYXnc5Knvk` (2026-07-01 14:00Z) verifies reports SEND, not that the new GA4/perf sections render correctly. So a report could ship to a client July 1 with garbled or missing new sections and nobody would notice.
- **Required follow-up (carried to STATE Deferred Issues):** before July 1, either (a) widen `trig_01G7MfA382AUXYTYXnc5Knvk` to pull the Wallace July PDF and confirm the four GA4 dimensional sections + the Website-performance block render (flag garbled/missing), OR (b) do a manual Wallace-PDF section-correctness check right after the July 1 report cron. This is what makes the activation-pending close safe rather than silently broken.

### 3. [Prod data fix] Wallace shops.url set
- Wallace `shops.url` was NULL; perf-sync skips url-less shops. Set to `wallacecollisionrepair.com` (the GSC-verified domain). Side effect: also makes Wallace eligible for the SEMrush daily ingest.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Wire readers into the PRINT path only, not the narrative path | `buildPlaceholders` (prompt.ts) iterates only `linkedSources`, so the writer can never cite a dims/perf number; wiring the narrative path re-opens the 12-04 grounding-hold trap for zero product gain (the canon dims/perf sections are tabular, not narrated) | the eval gate cannot hold on an ungrounded dims/perf number; the PDF still gets the new sections |
| Close activation-pending rather than rotate CRON_SECRET | operator declined the rotation + redeploy a manual smoke would require | expansion auto-activates July 1; base report stays live |
| GTMetrix pilot-scoped via GTMETRIX_SHOP_IDS env | fleet (842 shops) exceeds even the Enterprise daily credit cap; in-loop poll ~80s/shop vs the 300s Fluid ceiling | only Wallace runs GTMetrix; fleet-scale batching deferred |

## Skill Audit

All required skills (SPECIAL-FLOWS.md) invoked ✓ — research-first satisfied (12-05-RESEARCH.md covers GA4 dims + PSI/CrUX/GTMetrix; 12-05c opened no new external-API surface). PROTOCOL-migration-safety.md applied at Stage A (advisor baseline + diff, zero delta). Advisor consulted at Stage C (recommended operator-runs-curls, load-bearing sync->report order) and at the close (flagged the July 1 unmonitored-parser gap -> recorded as deviation 2).

## Next Phase Readiness

**Done:**
- Both activation gaps closed in code (reader wired into the PDF path; two cron routes built + deployed)
- Both migrations applied to prod; the source CHECKs admit all six sources
- The expansion is deployed and will auto-activate on the July 1 monthly crons

**Carry-forward (Deferred Issues):**
- **July 1 section-correctness verification** (deviation 2) — widen `trig_01G7MfA382AUXYTYXnc5Knvk` or manually check the Wallace July PDF's new sections; the build-blind parsers get their first live run that day
- **Secret rotation** — rotate the chat-pasted secrets after close: Hetzner token, AI Gateway key, SendGrid key (12-04 carry) + `PAGESPEED_API_KEY` + `GTMETRIX_API_KEY` (chat-pasted this session)
- **Fleet-scale perf batching** — the ~842-shop PSI/GTMetrix fan-out (queueing + credit budgeting) is a post-v0.3 follow-on
- **Peec AI + Local Falcon ingestion** — the remaining canon-report sources, post-v0.3

**Blockers:** None. Phase 12 + milestone v0.3 close on the live base report with the expansion activation-pending honestly recorded.

---
*Phase: 12-psg-report, Plan: 05c*
*Completed: 2026-06-13 — closes Phase 12 + milestone v0.3 Customer Analytics*
