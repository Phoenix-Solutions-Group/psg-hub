---
phase: 10-google-ads
plan: 02
subsystem: analytics
tags: [google-ads, gaql, ingest, cron, recharts, resilience, circuit-breaker, analytics-snapshots]

requires:
  - phase: 10-google-ads (10-01)
    provides: the 4 google_ads_* tables + RLS + the bytea `\x<hex>` write/read fix in client.ts/callback
  - phase: 09-analytics-foundation-semrush (09-03)
    provides: the ingest template (client → orchestrator → ledger → idempotent upsert), analytics_snapshots model, the cron gate, the surface
provides:
  - fetchAccountDailyMetrics — account-level daily GAQL (FROM customer, BETWEEN, micros→spend, cpl-in-code)
  - GoogleAdsMetrics jsonb shape
  - syncGoogleAdsSnapshots — per-shop-contained Google Ads ingest orchestrator
  - mapGoogleAdsError structured GoogleAdsFailure classification (per-shop auth_failed skip)
  - CRON_SECRET-gated /api/cron/google-ads-sync + vercel.json daily 06:15 UTC
  - paid (Google Ads) panel on /dashboard/analytics with its own unlinked state
affects: [10-google-ads (10-03 gate batch), 11-ga4-gsc, 12-psg-report]

tech-stack:
  added: []
  patterns:
    - "Account-level daily GAQL: FROM customer (one totals row) + segments.date BETWEEN; never `= 'd'`, never a segment in SELECT"
    - "Resilience on every external call: module-level CircuitBreaker + withRetry (transient-only) INSIDE the rate-limit guard"
    - "Second source reuses the 09-03 ingest template verbatim (eligibility → per-item fetch → ledger → idempotent upsert)"
    - "MSO aggregate surfaces summable metrics only; ratios (cpl, like authority_score) are per-shop only"

key-files:
  created:
    - src/lib/google-ads/metrics.ts
    - src/lib/google-ads/sync.ts
    - src/app/api/cron/google-ads-sync/route.ts
    - e2e/analytics-paid.spec.ts
  modified:
    - src/lib/google-ads/client.ts
    - src/lib/analytics/types.ts
    - src/app/dashboard/analytics/page.tsx
    - vercel.json
    - e2e/global.setup.ts

key-decisions:
  - "date=yesterday + ADS_RESYNC_DAYS(7) trailing window, NOT the ROADMAP's stated date=today (RESEARCH #2: today is partial — undercounts conversions / overstates CPL)"
  - "NO migration — analytics_snapshots + analytics_sync_runs source CHECKs already admit 'google_ads' (09-01 source-agnostic design)"
  - "markAccountAuthFailed lives in the orchestrator (AC-2), not the fetch — fetch stays a pure typed-throw read"
  - "Campaign MUTATION stays out (v1.2 / D52/D66 Python-on-Sandbox)"

patterns-established:
  - "GoogleAdsFailure classification by errors[0].error_code oneof key (auth/quota/query → typed AdsApiError)"
  - "Paid panel additive below organic; each source owns its empty/unlinked state"

duration: ~80min
started: 2026-06-08T10:50:00Z
completed: 2026-06-08T11:12:00Z
---

# Phase 10 Plan 02: Google Ads daily ingest + paid panel — Summary

**A built, locally-gated Google Ads daily ingest mirroring the 09-03 SEMrush vertical — account-level GAQL totals → idempotent analytics_snapshots → a paid panel on /dashboard/analytics — with ZERO prod contact and NO new migration; first-live-run verification is an explicit 10-03 gate item.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~80 min |
| Started | 2026-06-08T10:50:00Z |
| Completed | 2026-06-08T11:12:00Z |
| Tasks | 3 completed (all DONE/PASS) |
| Files modified | 11 (5 created, 5 modified, +1 vercel.json) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Account-level daily metrics query (contract-anchored) | Pass | `FROM customer` + `segments.date BETWEEN 'd' AND 'd'`; micros→spend; cpl null-on-0; zero-rows→all-zero; fixtures cite google-ads-api@23 parserRest shape (snake_case, INT64→Number); resilience-wrapped. 15/15 unit (metrics 9 + map-error 6). |
| AC-2: Per-shop-contained orchestrator (mirrors 09-03) | Pass | linked-only eligibility; per-shop auth_failed → markAccountAuthFailed + continue; non-auth contained without flip; ledger source='google_ads' open/close; ledger-fail non-blocking. 7/7 unit. |
| AC-3: CRON_SECRET-gated trigger, zero unauthorized spend | Pass | 401 before any read (incl. unset secret); 503 when Google creds absent; 200 with counts; vercel.json 2nd cron. 5/5 unit. |
| AC-4: Paid panel (own state, summable aggregates only) | Pass | "Paid advertising" section below untouched organic; per-shop KPIs incl. CPL; own "No Google Ads account linked" state; MSO aggregate EXCLUDES cpl (proven: spend 326=113+213, no CPL card). 3 NEW e2e + axe AA clean. |
| AC-5: Live-contract verification deferred to 10-03 | Pass | Recorded here + in PLAN/STATE. NOT verified by this plan: single-row cardinality, non-zero parse, account-tz bucketing, dev-token tier (Explorer+), OAuth consent-screen publish. Done-state = built + locally-gated, not live-verified. |

## Verification Results

- `tsc --noEmit`: clean (exit 0)
- `eslint` (touched src): 0 errors (1 cosmetic test-mock unused-param warning)
- `vitest run`: **350/350** (+28 vs 322: metrics 9 + map-error 6 + sync 7 + cron 5)
- `next build`: ✓ — `ƒ /api/cron/google-ads-sync` + `ƒ /api/cron/semrush-sync` present
- `playwright test`: **19/19** — 3 NEW paid-panel (per-shop+CPL+SVG, MSO sum 326 + no-CPL-card, MEGA unlinked); analytics/lcp/google-ads(10-01)/shop-switch/auth/customer regression-free
- grep: no `segments.date =` in code (only NOT-TO-DO comments); no `cost_per_conversion` read
- `vercel.json`: valid JSON, 2 cron entries

## Accomplishments

- Second analytics source live end-to-end (local): the 09-03 ingest template proved genuinely source-agnostic — orchestrator + cron + ledger reused verbatim, only the source-specific fetch is new.
- Closed the inherited resilience gap: the Google Ads call path now has CircuitBreaker + withRetry (transient-only) inside the rate-limit guard, matching the SEMrush path and the PROJECT.md mandate.
- Fixed the RESEARCH-flagged `mapGoogleAdsError` HIGH defect against the REAL library type — structured `GoogleAdsFailure` now classifies to `auth_failed`/`rate_limited`/`bad_request`, which is what makes the per-shop auth_failed skip actually fire.
- Paid panel surfaces spend/clicks/conversions/CPL with an honest MSO aggregate (CPL excluded) and its own unlinked state (the common path).

## Task Commits

Not committed — per plan, this is LOCAL build-only; the Phase-10 commit lands at the phase transition (after 10-03). Working tree holds all changes for the 10-03 gate batch.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/google-ads/metrics.ts` | Created | `fetchAccountDailyMetrics` — account-level daily GAQL + resilience |
| `src/lib/google-ads/sync.ts` | Created | `syncGoogleAdsSnapshots` orchestrator + `targetDates` |
| `src/app/api/cron/google-ads-sync/route.ts` | Created | CRON_SECRET-gated GET/POST trigger |
| `src/lib/google-ads/__tests__/metrics.test.ts` | Created | GAQL contract + metric mapping + resilience (9) |
| `src/lib/google-ads/__tests__/map-error.test.ts` | Created | REAL GoogleAdsFailure classification (6) |
| `src/lib/google-ads/__tests__/sync.test.ts` | Created | orchestrator containment + ledger + dates (7) |
| `src/app/api/cron/google-ads-sync/__tests__/route.test.ts` | Created | gate 401/503/200 (5) |
| `e2e/analytics-paid.spec.ts` | Created | paid panel e2e (3) |
| `src/lib/google-ads/client.ts` | Modified | `mapGoogleAdsError` structured GoogleAdsFailure branch |
| `src/lib/analytics/types.ts` | Modified | `GoogleAdsMetrics` jsonb shape |
| `src/app/dashboard/analytics/page.tsx` | Modified | paid panel + PAID_KPIS/PAID_AGGREGATE_KPIS (cpl excluded) |
| `vercel.json` | Modified | 2nd daily cron 06:15 UTC |
| `e2e/global.setup.ts` | Modified | `seedGoogleAdsSnapshots` (OWNER + MULTI; MEGA none) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| date=yesterday + ADS_RESYNC_DAYS(7) trailing window | RESEARCH #2: today is a partial day (undercounts conversions / overstates CPL); idempotent upsert makes re-fetch safe for conversion-lag backfill | Deviation from ROADMAP's stated date=today; UTC-derived label ≤1-day skew vs account-tz bucket (immaterial over 30d). 10-03/11 inherit |
| NO migration | snapshots + sync_runs source CHECKs already admit 'google_ads' (09-01 source-agnostic) | Phase-10 prod migration at 10-03 is the 10-01 tables only |
| markAccountAuthFailed in the orchestrator, not the fetch | keeps fetchAccountDailyMetrics a pure typed-throw read; orchestrator owns per-shop status side effects | matches the AC-2 contract |
| Resilience wrap added (operator option 2 at plan approval) | inherited google-ads path had no retry/breaker vs the PROJECT.md mandate | gap closed; module-level breaker mirrors SEMrush |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Recorded design deviations | 1 | date=yesterday vs ROADMAP date=today (research-driven, planned-in) |
| Test-selector fixes | 2 | Code correct; test assertions adjusted |

**Total impact:** No source-logic deviations. The one design deviation (ingest window) was decided at plan time from RESEARCH and is recorded in PLAN + STATE + here. The resilience wrap was an operator-approved plan amendment before APPLY, not an in-flight deviation.

### Auto-fixed Issues

None (no inherited-code bugs surfaced this plan — the 10-01 bytea fix already held; mapGoogleAdsError was a planned fix, not a discovered one).

### Test-selector fixes (code correct, tests adjusted)

**1. GAQL "no segment in SELECT" assertion over-matched**
- Found during: Task 1 qualify
- Issue: `/SELECT[^]*segments\./` greedily spanned into the WHERE clause (which legitimately has `segments.date`)
- Fix: scoped the assertion to the SELECT…FROM substring
- Files: metrics.test.ts

**2. KPI-label selectors collided with chart captions**
- Found during: Task 3 e2e
- Issue: `getByText("Spend (USD)")` also matched the chart caption "Daily Google Ads spend (USD)…" → strict-mode violation
- Fix: exact-match the KPI labels
- Files: analytics-paid.spec.ts

### Deferred Items

- **10-03 first-live-run contract verification (AC-5):** single-row cardinality, non-zero parse, account-tz date bucketing, dev-token tier (Explorer+), OAuth consent-screen publish status — cannot be settled from docs/source; require live creds.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| metrics.ts calls withAdsRateLimit/logAdsCall (real createServiceClient) directly | unit test mocks `../client`; the REAL mapGoogleAdsError classification is covered separately in map-error.test.ts against the unmocked impl |
| tsc spread-arg error on the markAccountAuthFailed mock | typed the mock to accept `(..._a: unknown[])` |

## Skill audit

`.paul/SPECIAL-FLOWS.md` research-first gate: **✓ satisfied.** Phase-10 `RESEARCH.md` (ultracode `wf_a78f4fd7-d6b`) is 10-02-specific (account-level GAQL, micros/CPL, the `segments.date = 'd'` refutation, the mapGoogleAdsError defect) — confirmed covering this plan before authoring; no new external-API surface opened beyond it.

## Next Phase Readiness

**Ready:**
- The Google Ads ingest + paid panel are built and locally gate-checked; everything the 10-03 gate batch needs is in the working tree.
- The source-agnostic ingest template is now proven twice (SEMrush + Google Ads) — Phase 11 (GA4/GSC) inherits it directly.

**Concerns:**
- AC-5 deferral: the GAQL contract is doc/source-anchored, not live-verified. The first real query at 10-03 must confirm single-row cardinality + non-zero parse (the 09-03 "real numbers, not cron-200" discipline).
- date=yesterday derivation is UTC-based, not account-tz; if a pilot account's tz materially shifts the day boundary, the trailing re-sync covers it, but watch the first live run.

**Blockers:**
- None for code. 10-03 is operator-gated: Google OAuth app creds + dev-token tier (Explorer+, ~2 biz-day human review) + OAuth consent screen In Production (else the adwords scope revokes refresh tokens after 7 days) + prod migration of the 10-01 tables + a pilot-shop link.

---
*Phase: 10-google-ads, Plan: 02*
*Completed: 2026-06-08*
