---
phase: 11-ga4-gsc
plan: 02
subsystem: api
tags: [ga4, analytics-data-api, runReport, ingest, cron, analytics-snapshots, oauth]

# Dependency graph
requires:
  - phase: 11-01
    provides: google_oauth_accounts ga4 rows (shared encrypted refresh token), buildOAuth2Client, GoogleApiError mapper, ga4-enumerate authClient idiom
  - phase: 10-google-ads
    provides: the ingest vertical pattern (orchestrator + CRON_SECRET cron + idempotent snapshot), AES-256-GCM crypto, the bytea \x<hex> round-trip, the additive analytics panel
provides:
  - GA4 daily ingest (linked ga4 account -> decrypt -> BetaAnalyticsDataClient -> trailing-window runReport -> analytics_snapshots source='ga4')
  - getLinkedAccount + markAccountError (shared google_oauth read/decrypt + error-flip; reused by GSC 11-03)
  - Ga4Metrics type, /api/cron/ga4-sync, the "Website traffic" dashboard panel
affects: [11-03 GSC ingest, 12 PSG report]

# Tech tracking
tech-stack:
  added: []   # 11-01 installed @google-analytics/data + admin + googleapis + google-auth-library
  patterns:
    - "ONE trailing-window runReport per property -> Map<dateISO, Ga4Metrics> fanned into N snapshot rows (GA4 quota economy; differs from the ads per-date loop)"
    - "Deterministic 1-row-per-shop eligibility (latest linked_at) — multi-property deferred (property-less snapshot key)"
    - "Header-indexed metric parse (not positional); YYYYMMDD->YYYY-MM-DD; string metricValues Number()'d"
    - "GA4_RESYNC_DAYS=3 (GA4 ~18-48h reprocessing) — NOT the ads 7"

key-files:
  created:
    - src/lib/google-oauth/ga4-client.ts
    - src/lib/google-oauth/ga4-metrics.ts
    - src/lib/google-oauth/ga4-sync.ts
    - src/app/api/cron/ga4-sync/route.ts
    - e2e/analytics-ga4.spec.ts
  modified:
    - src/lib/google-oauth/accounts.ts
    - src/lib/analytics/types.ts
    - vercel.json
    - src/app/dashboard/analytics/page.tsx
    - e2e/global.setup.ts

key-decisions:
  - "keyEvents (the 2024 rename) is the conversions metric — `conversions` is deprecated"
  - "ONE trailing-window runReport returning Map<date,Ga4Metrics>, not N per-date calls (RESEARCH quota)"
  - "Deterministic 1-row-per-shop; multi-property-per-shop DEFERRED (mirrors the Phase-10 ads snapshot-key decision)"
  - "GA4 cron creds = OAuth client id/secret + redirect (NO developer token, unlike ads); runtime=nodejs ADDED (gax not Edge-safe)"
  - "MSO aggregate drops engagement_rate (a summed ratio lies — same rule as cpl/authority_score)"

patterns-established:
  - "Shared google-oauth/accounts.ts read+decrypt+markError is the per-source ingest entry; GSC 11-03 reuses it"
  - "GA4 ingest lives in google-oauth/ga4-*.ts (consistent with 11-01's ga4-enumerate.ts), not a separate dir"

# Metrics
duration: ~1 session (APPLY 2026-06-09)
started: 2026-06-09T14:30:00Z
completed: 2026-06-09T14:55:00Z
---

# Phase 11 Plan 02: GA4 daily ingest Summary

**A shop's linked GA4 property ingests daily website traffic (sessions, users, key events, engagement rate) via ONE trailing-window runReport per property into source-agnostic analytics_snapshots (source='ga4'), driven by a CRON_SECRET cron and surfaced as an additive "Website traffic" panel. Built LOCAL, ZERO prod contact, NO migration.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 session |
| Tasks | 3 / 3 completed |
| Files | 5 created, 5 modified |
| Tests added | +23 (vitest 421 -> 444) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: GA4 Data client from a linked account (shared read + decrypt + authClient) | Pass | getLinkedAccount deterministic 1-row-per-shop + `\x`hex bytea decode + decrypt; getGa4DataClient builds BetaAnalyticsDataClient via gax authClient; markAccountError flips status='error' |
| AC-2: fetchGa4DailyMetrics — one trailing-window runReport, date-map of daily totals | Pass | dimensions=[date], keyEvents-as-conversions, header-indexed, YYYYMMDD->YYYY-MM-DD, Number() strings, Map<date,Ga4Metrics>, returnPropertyQuota+sampling logged; 6 unit tests |
| AC-3: syncGa4Snapshots orchestrator + CRON_SECRET cron (idempotent, contained, source='ga4') | Pass | linked-ga4-only + dedupeByShop, GA4_RESYNC_DAYS=3, Map fanned to rows, per-shop containment + markAccountError, ledger source='ga4'; cron 401/503/200, runtime=nodejs, vercel.json 30 6; 14 tests |
| AC-4: Additive GA4 panel on /dashboard/analytics (organic + paid blocks untouched) | Pass | "Website traffic" section, per-shop + MSO aggregate (drops engagement_rate ratio), own unlinked state; e2e seeds + 3 specs (axe AA); organic/paid byte-untouched |
| AC-5: Boundaries held — GA4 ingest only, zero prod, no migration | Pass | grep-confirmed: no GSC, no new migration, no google-ads edit, no ads_api_call_log, no channel dim, no `conversions` metric; reuse ADS_ENCRYPTION_KEY |

## Accomplishments

- Shipped the GA4 daily-ingest vertical as a clean sibling of the shipped 10-02 google-ads vertical, reusing the orchestrator/cron/snapshot core and the 11-01 OAuth foundation while adding only the GA4 Data API surface.
- Encoded every GA4 Data API contract trap in code (keyEvents-not-conversions, two date formats, string metricValues, GA4_RESYNC_DAYS=3, header-indexed parse, sampling/quota logging) — the failure modes RESEARCH flagged as silent.
- Closed the advisor-flagged latent data bug before it shipped: deterministic 1-row-per-shop eligibility so a double-linked shop can never clobber the property-less (shop,source,date,period) snapshot key (multi-property deferred, mirroring the Phase-10 ads decision).
- Added a shared `getLinkedAccount` + `markAccountError` in google-oauth/accounts.ts that GSC 11-03 reuses directly.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/google-oauth/accounts.ts` | Modified | + getLinkedAccount (deterministic 1-row-per-shop read + `\x`hex decode + decrypt) + markAccountError (generic status='error' flip); persistLinkedAccount untouched |
| `src/lib/google-oauth/ga4-client.ts` | Created | getGa4DataClient -> BetaAnalyticsDataClient via gax authClient (the 11-01 idiom), injectable getLinkedAccount seam |
| `src/lib/google-oauth/ga4-metrics.ts` | Created | fetchGa4DailyMetrics -> one runReport (dimensions=[date], keyEvents), header-indexed parse, date reformat, Number() coercion, Map<date,Ga4Metrics>; CircuitBreaker+withRetry; quota/sampling logged; deps.runReport seam |
| `src/lib/google-oauth/ga4-sync.ts` | Created | syncGa4Snapshots — linked-ga4-only + dedupeByShop, windowBounds (GA4_RESYNC_DAYS=3), Map->rows, contained per-shop catch + markAccountError, ledger source='ga4' |
| `src/app/api/cron/ga4-sync/route.ts` | Created | CRON_SECRET timingSafeEqual gate, GA4 creds 503 (no dev token), runtime=nodejs, GET+POST |
| `src/lib/analytics/types.ts` | Modified | + Ga4Metrics type (engagement_rate doc'd aggregate-excluded) |
| `vercel.json` | Modified | + ga4-sync cron `30 6 * * *` (now 3 crons) |
| `src/app/dashboard/analytics/page.tsx` | Modified | + additive "Website traffic" GA4 panel (per-shop + MSO aggregate dropping engagement_rate) below organic+paid (both byte-untouched) |
| `e2e/global.setup.ts` | Modified | + seedGa4Snapshots (OWNER 30d/500 · A 14d/500 · B 14d/800; MEGA none) |
| `e2e/analytics-ga4.spec.ts` | Created | 3 specs: per-shop KPIs+SVG · MSO aggregate sessions sum + no engagement-rate · unlinked state; axe AA each |
| `src/lib/google-oauth/__tests__/{ga4-metrics,ga4-sync,accounts}.test.ts` | Created | 19 unit tests |
| `src/app/api/cron/ga4-sync/__tests__/route.test.ts` | Created | 6 cron gate tests |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| ONE trailing-window runReport -> Map<date,Ga4Metrics> (not N per-date calls) | GA4 quota is non-linear; one window call is far cheaper (RESEARCH) | Structurally differs from the ads per-date loop; orchestrator fans the Map into rows |
| Deterministic 1-row-per-shop; multi-property DEFERRED | The property-less snapshot key would let a 2nd ga4 property clobber rows (advisor catch) | Mirrors the Phase-10 ads decision; a true multi-property model is future scope |
| GA4_RESYNC_DAYS=3 (not the ads 7) | GA4 reprocesses ~18-48h; a short trailing window backfills the settling days | New optional env; idempotent upsert keeps re-pull safe |
| Cron creds = OAuth id/secret + redirect (NO dev token); runtime=nodejs | GA4 has no developer token; the gax/grpc client is not Edge-safe | Cron 503 gate differs from ads; runtime added (ads template omitted it) |
| MSO aggregate drops engagement_rate | A summed ratio lies (same rule as cpl/authority_score) | GA4_AGGREGATE_KPIS excludes it; sessions/users/key_events sum honestly |

## Verification Results

- `tsc` — 0 errors
- `vitest run` — 444/444 (+23: ga4-metrics 6 · accounts 5 · ga4-sync 8 · cron route 6, less consolidation)
- `eslint` — 0 errors on all new/modified files
- `pnpm build` — ✓ (`ƒ /api/cron/ga4-sync` runtime=nodejs; serverExternalPackages already covers gax)
- `playwright test` — 27/27 (+3 GA4; full regression incl. analytics/paid/lcp/google-ads/google-analytics-link/shop-switch)
- Boundary greps — no GSC code, no new migration, no google-ads edit, no ads_api_call_log, no channel dimension, no `conversions` metric

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | (see below) | LIVE activation -> shared Phase-11 gate batch |

**None material.** All design forks (single trailing-window runReport returning a date-map; deterministic 1-row-per-shop) were recorded plan-time decisions, advisor-confirmed, not in-flight deviations.

### Deferred Items (Phase-11 operator gate batch)

- Real `runReport` against a live GA4 property
- The gax `authClient` runtime smoke (compile-confirmed only — RESEARCH UNVERIFIED #1)
- GA4 Admin + Data API enablement in the Cloud project
- Consent-screen sensitive-scope publish (Testing mode kills the refresh token at 7 days)
- Prod migration ×2 (the 11-01 google_oauth_* tables) under PROTOCOL-migration-safety.md
- Deploy

**⭐ Wallace GA4 access became available (operator, 2026-06-09)** — the live smoke/activation is now UNBLOCKED. Operator decision (2026-06-09): finish 11-02, build 11-03 GSC, then activate GA4 + GSC together in ONE combined Phase-11 gate batch (mirrors the Phase-9+10 combined batch). Done-state for 11-02 = built + locally gate-checked, NOT live.

## Skill Audit (Phase 11)

| Expected (SPECIAL-FLOWS required) | Invoked | Notes |
|-----------------------------------|---------|-------|
| Research-first / per-plan research check | ✓ | RESEARCH.md (ultracode Workflow `wf_b732175b-025`) GA4 Data API runReport section covers this plan's surface |

All required skills invoked ✓.

## Issues Encountered

None blocking. A transient `.next` rmdir ENOTEMPTY on the first build was cleared by `rm -rf .next` + rebuild (filesystem, not code).

## Next Phase Readiness

**Ready:**
- The GA4 ingest, the shared getLinkedAccount/markAccountError, and the additive-panel pattern are the exact template 11-03 (GSC ingest) reuses — GSC swaps the Google client (sites.list/searchanalytics.query) and widens the resync window.
- Wallace GA4 access is in hand for the combined Phase-11 gate batch.

**Concerns:**
- The gax `authClient` injection and GA4 Admin/Data API enablement are compile-/research-confirmed only — the first live link must smoke them (now unblocked via Wallace).
- Consent screen must reach In-Production before scheduled ingest (7-day Testing-mode token death).

**Blockers for 11-03:** None for LOCAL build. LIVE activation is the shared Phase-11 operator gate batch.

---
*Phase: 11-ga4-gsc, Plan: 02*
*Completed: 2026-06-09*
