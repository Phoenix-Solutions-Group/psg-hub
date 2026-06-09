---
phase: 11-ga4-gsc
plan: 03
subsystem: analytics
tags: [gsc, search-console, googleapis, searchanalytics, oauth, cron, ingest, snapshots]

requires:
  - phase: 11-01
    provides: shared Google OAuth foundation — google_oauth_accounts (source CHECK admits gsc), buildOAuth2Client + GoogleApiError/mapGoogleApiError, gsc-enumerate googleapis OAuth2 idiom
  - phase: 11-02
    provides: shared getLinkedAccount(shop,source) + markAccountError (source-parameterized), the windowBounds/dedupeByShop/ledger orchestrator shape, the additive-panel discipline
  - phase: 09-01
    provides: source-agnostic analytics_snapshots + analytics_sync_runs, upsertSnapshots, aggregateByDate/latestSnapshot/trailingWindow, chart cards
provides:
  - GSC daily search-performance ingest (clicks/impressions/ctr/position) into analytics_snapshots source='gsc'
  - getGscClient (google.searchconsole via googleapis auth) + fetchGscDailyMetrics (searchanalytics.query -> Map<date,GscMetrics>)
  - syncGscSnapshots orchestrator + /api/cron/gsc-sync (CRON_SECRET, runtime=nodejs) + vercel.json 45 6
  - additive "Search performance" panel on /dashboard/analytics (aggregate drops ctr + position)
  - GscMetrics type
affects: [12-psg-report, phase-11-gate-batch]

tech-stack:
  added: []
  patterns:
    - "GSC = googleapis (REST) transport: google.searchconsole({version:'v1', auth}) — the `auth` field, NOT the gax `authClient` (that is the GA4 path). Mirrors 11-01 gsc-enumerate."
    - "GSC response parser is its OWN shape (NOT a ga4-metrics clone): rows {keys:[YYYY-MM-DD], clicks, impressions, ctr, position} — no metricHeaders, date already ISO (no reformat), numeric values."
    - "Wider trailing window for laggy sources: GSC_RESYNC_DAYS default 7 (vs GA4's 3) + idempotent upsert is self-correcting; no latest-date probe code."
    - "Aggregate drops ALL ratio/average metrics: ctr AND position both excluded (a summed ratio lies) — same rule as authority_score/cpl/engagement_rate."

key-files:
  created:
    - src/lib/google-oauth/gsc-client.ts
    - src/lib/google-oauth/gsc-metrics.ts
    - src/lib/google-oauth/gsc-sync.ts
    - src/app/api/cron/gsc-sync/route.ts
    - e2e/analytics-gsc.spec.ts
  modified:
    - src/lib/analytics/types.ts
    - src/app/dashboard/analytics/page.tsx
    - vercel.json
    - e2e/global.setup.ts

key-decisions:
  - "Reuse the shared getLinkedAccount/markAccountError (accounts.ts UNTOUCHED) — they were source-parameterized in 11-02 for exactly this."
  - "Clone windowBounds/dedupeByShop/ledger into gsc-sync rather than import from ga4-sync — keeps gsc-sync off the gax import chain and leaves ga4-sync byte-untouched."
  - "Pin type='web' + dataState='final' explicitly — mixing 'all'/'final' across runs without an upsert-on-final strategy corrupts stored data (RESEARCH)."
  - "GSC_RESYNC_DAYS default 7 (wider than GA4's 3) for the ~2-3 day GSC lag; no per-site latest-date probe (wide window + idempotent upsert self-corrects)."
  - "Defensive encodeURIComponent on siteUrl (RESEARCH #4 — googleapis auto-encoding is version-dependent); the live verification is the gate batch."

patterns-established:
  - "Third source plugged into the source-agnostic snapshot model with ZERO migration and ZERO new dependency — the v0.3 analytics surface scales by source as designed."

duration: ~35min
started: 2026-06-09T15:18:00Z
completed: 2026-06-09T15:32:00Z
---

# Phase 11 Plan 03: GSC Daily-Ingest Vertical Summary

**A linked Google Search Console site's daily search performance (clicks, impressions, CTR, average position) now ingests idempotently into analytics_snapshots (source='gsc') via one trailing-window searchanalytics.query per site behind a CRON_SECRET-gated cron, and renders as an additive "Search performance" panel on /dashboard/analytics — built LOCAL, gate-checked, ZERO prod contact. This completes the Phase-11 BUILD (3/3 sources).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min |
| Tasks | 3 completed (all DONE/PASS) |
| Files created | 7 (3 lib + 1 route + 1 e2e + 2 test) |
| Files modified | 4 (types.ts, page.tsx, vercel.json, global.setup.ts) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: GSC client from a linked account (googleapis `auth`, NOT gax) | Pass | getGscClient → shared getLinkedAccount(shop,'gsc') → google.searchconsole({version:'v1',auth}); buildOAuth2Client NOT used; mirrors gsc-enumerate |
| AC-2: fetchGscDailyMetrics — one trailing-window query, own parser | Pass | ONE searchanalytics.query (dims=['date'], type='web', dataState='final'); FRESH parser keys[0]-as-ISO (no reformat), numeric coerce; CircuitBreaker+withRetry; gsc-metrics.test 6/6 incl. the keys[0]-no-reformat + Gaxios-403→auth_failed cases |
| AC-3: syncGscSnapshots orchestrator + CRON_SECRET cron (WIDE window) | Pass | source='gsc', GSC_RESYNC_DAYS=7, dedupeByShop one-row-per-shop, contained per-shop catch + markAccountError, ledger; cron Bearer gate + 503 shared-creds + runtime=nodejs; vercel.json 4 crons; gsc-sync 7 + route 6 tests |
| AC-4: Additive "Search performance" panel (other blocks untouched) | Pass | clicks LineChart + impressions BarChart + own unlinked state; aggregate DROPS BOTH ctr+position; organic/paid/GA4 byte-untouched; analytics-gsc.spec 3/3 (258 per-shop · 652 aggregate · no ctr/position · MEGA unlinked; axe AA) |
| AC-5: Boundaries held — GSC ingest only, zero prod, no migration | Pass | no new dep, no migration (CHECK admits gsc), no Ads/GA4/11-01/accounts edit, no ads_api_call_log, no page/query dim, no dataState:'all'; runReport path behind deps seam |

## Accomplishments

- Shipped the third and final Phase-11 source (GSC), completing the build of the unified SEMrush + Google Ads + GA4 + GSC analytics surface — every source on the same source-agnostic snapshot model, added with zero schema change and zero new dependency.
- Handled the GSC API's distinct contract correctly where a blind mirror of GA4 would have shipped a bug: the searchanalytics.query response is parsed by its own shape (`keys[0]` already ISO, no metricHeaders, numeric values), proven by a dedicated test.
- Held a clean reuse boundary: getLinkedAccount/markAccountError reused untouched, windowBounds/dedupeByShop cloned, ga4-sync and accounts.ts byte-unchanged.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/google-oauth/gsc-client.ts` | Created | getGscClient — google.searchconsole from the shared linked-account read (googleapis `auth`) |
| `src/lib/google-oauth/gsc-metrics.ts` | Created | fetchGscDailyMetrics — one searchanalytics.query → Map<date,GscMetrics>, own parser, resilience-wrapped |
| `src/lib/google-oauth/gsc-sync.ts` | Created | syncGscSnapshots — source='gsc' orchestrator, GSC_RESYNC_DAYS=7, contained, ledger |
| `src/app/api/cron/gsc-sync/route.ts` | Created | CRON_SECRET-gated GET+POST cron, shared creds 503, runtime=nodejs |
| `src/lib/google-oauth/__tests__/gsc-metrics.test.ts` | Created | 6 — parser/request-body/coerce/empty/malformed-skip/error+retry |
| `src/lib/google-oauth/__tests__/gsc-sync.test.ts` | Created | 7 — window/eligibility/dedupe/auth-contained/no-flip/read-error/ledger |
| `src/app/api/cron/gsc-sync/__tests__/route.test.ts` | Created | 6 — 401×3/503/200×2 |
| `e2e/analytics-gsc.spec.ts` | Created | 3 — per-shop KPIs+SVG / aggregate sum no-ratio / unlinked; axe AA |
| `src/lib/analytics/types.ts` | Modified | + GscMetrics {clicks,impressions,ctr,position} |
| `src/app/dashboard/analytics/page.tsx` | Modified | + additive "Search performance" section (aggregate drops ctr+position) |
| `vercel.json` | Modified | + gsc-sync cron 45 6 (now 4 crons) |
| `e2e/global.setup.ts` | Modified | + seedGscSnapshots (OWNER 30d / A 14d / B 14d; MEGA none) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| GSC response parser written fresh (not a ga4-metrics clone) | searchanalytics.query response is a different shape — no metricHeaders, keys[0] already ISO, numeric values | Avoided a date-corruption + parse bug a blind mirror would have shipped |
| Clone windowBounds/dedupeByShop into gsc-sync | Keeps gsc-sync off the gax import chain; ga4-sync stays byte-untouched | Slight duplication, zero coupling risk |
| GSC_RESYNC_DAYS default 7 + no probe code | GSC lags ~2-3 days; a wide window + idempotent upsert self-corrects | Recent empty days yield no rows; no fragile latest-date logic |
| Pin type='web' + dataState='final' | Mixing 'all'/'final' across runs corrupts stored data (RESEARCH) | Deterministic, finalized stored numbers |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Spec-vs-reality reconcile | 1 | No logic impact |

**Total impact:** One spec-vs-reality reconcile, no scope creep.

### Reconcile

**1. e2e seeds gsc snapshots only (no google_oauth_accounts gsc row)**
- **Found during:** Task 3 (panel + e2e)
- **Issue:** The plan's Task-3 said "seed one linked gsc account for the linked-state assertion." The shipped 11-02 GA4 spec does NOT seed an accounts row — the panel renders from analytics_snapshots and the unlinked state keys on `gscRows.length === 0`.
- **Fix:** Mirrored 11-02 reality — seeded gsc snapshots only. The panel + unlinked-state assertions pass without an accounts row.
- **Verification:** analytics-gsc.spec 3/3 green (per-shop render, aggregate, MEGA unlinked).

## Issues Encountered

"None."

## Next Phase Readiness

**Ready:**
- Phase-11 BUILD is 3/3 (11-01 foundation · 11-02 GA4 · 11-03 GSC) — all locally gate-checked.
- The unified analytics surface now renders all four sources (organic SEMrush + paid Google Ads + GA4 traffic + GSC search), the data foundation Phase 12 (PSG report narrative + PDF) consumes.

**Concerns:**
- NOT LIVE. The first real searchanalytics.query, the siteUrl url-encoding probe (RESEARCH #4), the empirical GSC data-lag/max-date confirmation (RESEARCH #3), GSC API enablement, consent publish, the prod migration of the two 11-01 tables under PROTOCOL, and the deploy are all deferred to the shared Phase-11 GA4+GSC operator gate batch.
- Phase 11 is NOT yet committed (the 11-01/11-02/11-03 trees are local; the Phase-11 commit was planned for the transition).

**Blockers:**
- None technical. One open ROUTING DECISION for the operator: the shared GA4+GSC gate batch (2 migrations + consent publish + live GA4 runReport + live GSC query + the url-encoding/lag probes + deploy + commit) can be (a) authored as its own gate-batch plan like Phase-10's 10-03, or (b) folded into Phase-12 planning. Until that runs, Phase 11 is BUILD-complete but activation-pending.

---
*Phase: 11-ga4-gsc, Plan: 03*
*Completed: 2026-06-09*
