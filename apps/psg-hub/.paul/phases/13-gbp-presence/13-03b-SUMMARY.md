---
phase: 13-gbp-presence
plan: 03b
subsystem: api
tags: [gbp, google-business-profile, business-information-v1, my-business-v4, reviews, star-rating, presence, monthly-ingest, cron, report-pdf, analytics-dashboard]

# Dependency graph
requires:
  - phase: 13-03a
    provides: "the 'gbp_presence' source CHECK widen + GbpPresenceMetrics type + getLinkedAccount externalParentId read-side fix + the ReportData.gbpPresence? data block (buildGbpPresence / MonthlyGbpPresenceReader)"
  - phase: 13-01
    provides: "the gbp google_oauth_accounts link (bare locations/{id} + parent accounts/{id} via externalParentId) + getLinkedAccount/markAccountError + buildOAuth2Client"
  - phase: 13-02b
    provides: "the daily 'Local presence' dashboard <section> this plan extends with a current-state header"
  - phase: 12-05
    provides: "the monthly orchestrator + cron + report-block vertical pattern (ga4-dims-sync / perf-sync) cloned here"
provides:
  - "fetchGbpPresence — Business Information v1 locations.get -> the GbpPresenceMetrics presence state"
  - "fetchGbpReviewsAggregate — legacy v4 raw-HTTP lifetime star-rating aggregate (averageRating/totalReviewCount)"
  - "syncGbpPresence — monthly source='gbp_presence' orchestrator (rating-failure tolerant; row written even when v4 fails)"
  - "/api/cron/gbp-presence-sync (0 4 1) + the report PDF 'Reviews and listing' block + the dashboard per-shop presence header"
  - "getLatestMonthlySnapshot — the dashboard's latest-monthly reader"
affects: [13-04, 14-reviews-sentiment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second-call-tolerated ingest: the orchestrator writes the STOCK row even when the enrichment call (v4 reviews) fails; the failure NEVER flips the account, only the primary (presence) call does"
    - "Raw-HTTP Google seam via buildOAuth2Client(...).request for an API with no typed googleapis client (v4 reviews)"
    - "getLatestMonthlySnapshot (date desc, limit 1) for a monthly STOCK surface robust to the cron-timing/month-boundary blank a fixed-month read shows"

key-files:
  created:
    - src/lib/google-oauth/gbp-presence.ts
    - src/lib/google-oauth/gbp-reviews.ts
    - src/lib/google-oauth/gbp-presence-sync.ts
    - src/app/api/cron/gbp-presence-sync/route.ts
  modified:
    - vercel.json
    - src/lib/report/render.ts
    - src/app/reports/[slug]/print/route.ts
    - src/lib/analytics/snapshots.ts
    - src/app/dashboard/analytics/page.tsx
    - e2e/global.setup.ts
    - e2e/analytics-gbp.spec.ts

key-decisions:
  - "Report block titled 'Reviews and listing' (NOT 'Local presence') to avoid a two-same-titled-panel PDF collision with the daily gbp source block — AC-5 wording deviation, serves AC intent (advisor-flagged)"
  - "Orchestrator drops monthWindow entirely: presence is point-in-time STOCK and the rating is a lifetime aggregate — no window to pass (unlike ga4-dims-sync)"
  - "Both fetchers take (shopId, deps?) and resolve getLinkedAccount internally (two reads/shop) — keeps each fetcher self-contained + independently testable; matches the plan signature over the research's acct-passing sketch"
  - "Dashboard presence header is per-shop ONLY; the MSO/scopeAll path SKIPS the getLatestMonthlySnapshot query entirely (a cross-shop rating average is a lie — same principle as the aggregate-excluded ratio metrics)"

patterns-established:
  - "STOCK enrichment merged onto a primary STOCK row at one (shop,source,date,period) key, with the enrichment call defensively null + non-fatal"

# Metrics
duration: ~1 session
started: 2026-06-15
completed: 2026-06-15T00:00:00Z
---

# Phase 13 Plan 03b: GBP monthly presence + star-rating INGEST Summary

**A linked shop's monthly GBP presence state (Business Information v1 `locations.get`) + lifetime star-rating aggregate (legacy v4 `reviews.list` `averageRating`/`totalReviewCount`) now flow into ONE `analytics_snapshots` row (source='gbp_presence', period='monthly') via a CRON_SECRET-gated monthly cron (`0 4 1`, before the 05:00 report), the row is written even when the rating call fails, and it surfaces BOTH in the report PDF ("Reviews and listing" block) AND on the dashboard "Local presence" section (a per-shop current-state header) — all proven LOCAL on seeded fixtures + the e2e round-trip, ZERO prod.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 session |
| Completed | 2026-06-15 |
| Tasks | 3 of 3 (DONE/PASS) |
| Files | 4 created · 7 modified |
| Tests added | +34 vitest (659 total) · +1 e2e assertion (38/38) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: gbp-presence — Business Information v1 `locations.get`, `auth:` idiom, completeness=round(signals/7×100), no new dep | Pass | `fetchGbpPresence` + `mapLocationToPresence`; readMask introspection-confirmed; 404→bad_request; rating pair NOT set here |
| AC-2: gbp-reviews — v4 raw-HTTP aggregate via `buildOAuth2Client.request`, slash-join parent, defensive null | Pass | null account/parent → {null,null}; 200-absent → {null,null}; throw → mapGoogleApiError rethrown; pageSize:1; no double-prefix |
| AC-3: gbp-presence-sync — monthly orchestrator, source='gbp_presence', rating-failure tolerant | Pass | row written w/ null rating on reviews fail + account NOT flipped; presence auth_failed → markAccountError/contained/no-row; top-level → ledger error+rethrow |
| AC-4: cron + vercel.json — CRON_SECRET-gated, nodejs, monthly `0 4 1` | Pass | 401 (no/bad/empty), 503 gbp_not_configured, 200 month-injected (GET+POST); 9th cron slotted after perf, before report |
| AC-5: report render — bind reader + renderGbpPresenceBlock | Pass | reader bound in print route; block present-guarded after performanceBlock; null rating → "n/a" not "0.0". **Deviation:** h2 = "Reviews and listing" not the AC's literal "Local presence" (collision avoidance) |
| AC-6: dashboard presence header — per-shop, e2e | Pass | `getLatestMonthlySnapshot` + per-shop header (scopeAll skips the query); e2e OWNER shows 4.6 / 87 reviews / Open + axe AA 0 serious/critical |
| AC-7: Boundaries — ingest + two surfaces only; no migration/dep/per-review; zero prod | Pass | no migration (13-03a admits 'gbp_presence'); no new dep; no per-review bodies/replies/sentiment; ZERO prod contact |

## Accomplishments

- Closed the GBP presence vertical: schema (13-03a) → ingest (this plan) → two surfaces. A linked shop's listing state + lifetime review aggregate land in one idempotent monthly row and render in both the client PDF and the dashboard.
- Real-contract introspection of the Business Information v1 `locations.get` method + every mapped field path against the INSTALLED googleapis@173 type defs (the real-contract substitute; the live call is the 13-04 gate) — `locations.get` is the TOP-LEVEL resource, not `accounts.locations`.
- The defensive v4 raw-HTTP reviews seam (no typed client exists) with the row-written-even-on-rating-failure semantic, so a non-VoM/unverified location degrades to a null rating instead of dropping the presence snapshot.

## Task Commits

NOT yet committed — phase-boundary commit (same uncommitted accumulation as 13-01/13-02a/13-02b/13-03a; lands on the next push, NOT auto-deployed since `deploymentEnabled.main=false`).

| Task | Status | Description |
|------|--------|-------------|
| Task 1: gbp-presence + gbp-reviews + tests | DONE/PASS | Business Information location-state fetch + v4 raw-HTTP rating aggregate; 13 tests |
| Task 2: gbp-presence-sync + cron + vercel.json + tests | DONE/PASS | monthly orchestrator + CRON_SECRET cron + 9th cron; 15 tests |
| Task 3: report render + dashboard header + e2e | DONE/PASS | renderGbpPresenceBlock + reader binding + getLatestMonthlySnapshot + per-shop header; render+snapshots +6 tests; e2e presence header + axe |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/google-oauth/gbp-presence.ts` | Created | `fetchGbpPresence` — Business Information v1 `locations.get` (`auth:` idiom) → presence state + completeness_score |
| `src/lib/google-oauth/gbp-reviews.ts` | Created | `fetchGbpReviewsAggregate` — v4 raw-HTTP `averageRating`/`totalReviewCount` via `buildOAuth2Client(...).request` |
| `src/lib/google-oauth/gbp-presence-sync.ts` | Created | `syncGbpPresence` — monthly source='gbp_presence' orchestrator (rating-failure tolerant) |
| `src/app/api/cron/gbp-presence-sync/route.ts` | Created | CRON_SECRET-gated monthly trigger, nodejs, 503 gbp_not_configured, month=priorMonth |
| `vercel.json` | Modified | +9th cron `/api/cron/gbp-presence-sync` `0 4 1 * *` (after perf, before report) |
| `src/lib/report/render.ts` | Modified | `renderGbpPresenceBlock` (h2 "Reviews and listing") slotted after performanceBlock |
| `src/app/reports/[slug]/print/route.ts` | Modified | bind `readMonthlyGbpPresence` into assembleReportData |
| `src/lib/analytics/snapshots.ts` | Modified | `getLatestMonthlySnapshot` (monthly, date desc, limit 1) |
| `src/app/dashboard/analytics/page.tsx` | Modified | per-shop presence current-state header on the "Local presence" section (skips query when scopeAll) |
| `e2e/global.setup.ts` | Modified | `seedGbpPresence` (OWNER 4.6 / 87 / OPEN monthly row) |
| `e2e/analytics-gbp.spec.ts` | Modified | OWNER per-shop presence-header assertions + axe AA |
| `src/lib/google-oauth/__tests__/gbp-presence.test.ts` | Created | unit tests (map/completeness/defaults/readMask/404) |
| `src/lib/google-oauth/__tests__/gbp-reviews.test.ts` | Created | unit tests (snake_case/absent-null/null-parent/pageSize+slash-join/403-rethrow) |
| `src/lib/google-oauth/__tests__/gbp-presence-sync.test.ts` | Created | unit tests (row/rating-tolerant/contained-auth/dedupe/ledger) |
| `src/app/api/cron/gbp-presence-sync/__tests__/route.test.ts` | Created | unit tests (401×3/503/200-month-injected) |
| `src/lib/report/__tests__/render.test.ts` | Modified | +3 (present/null-rating/absent — separate `dataWithPresence` fixture) |
| `src/lib/analytics/__tests__/snapshots.test.ts` | Modified | +3 (getLatestMonthlySnapshot filters+order+limit / null / error) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Report h2 "Reviews and listing" (not "Local presence") | The daily gbp source block already titles a panel "Local presence" (SOURCE_META.gbp); two same-titled PDF panels is a UX wart | AC-5 wording deviation; serves the AC intent (advisor-flagged) |
| Orchestrator drops `monthWindow` | Presence is point-in-time STOCK + the rating is a lifetime aggregate — there is no window to pass to the fetch | Leaner clone of ga4-dims-sync; keeps reportMonth + rowDate |
| Both fetchers take `(shopId, deps?)`, resolve getLinkedAccount internally | Self-contained + independently testable; matches the plan over the research's acct-passing sketch | Two getLinkedAccount reads/shop in the orchestrator (acceptable; both cheap) |
| Dashboard header per-shop only; scopeAll SKIPS the query | A cross-shop rating average is a lie (same principle as the aggregate-excluded ratio metrics) | No header in the MSO aggregate; no wasted query |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Spec/wording deviations | 1 | AC-5 report h2 title; serves AC intent, no behavior change |
| Environment | 1 | Docker daemon down at first e2e attempt |
| Deferred | 5 | Live-smoke items → 13-04 (recorded) |

**Total impact:** No scope creep. One advisor-driven title change (DRIFT-justified). The e2e then ran fully green once Docker was up.

### Wording deviation
**1. AC-5 report block heading "Reviews and listing" instead of the literal "Local presence"**
- **Found during:** pre-write advisor pass (Task 3)
- **Issue:** the AC text said a "Local presence" `<section>`, but the daily gbp source block already renders an h2 "Local presence" — two identically-titled PDF panels for a shop with both rows
- **Fix:** the new block uses the distinct h2 "Reviews and listing" (the GBP badge still identifies the source); serves the AC's actual intent
- **Verification:** render.test asserts the block heading + `not.toContain("<h2>Local presence</h2>")`

### Environment
**2. Docker daemon down at first e2e attempt**
- The local Supabase stack (needed for the Playwright run) was offline; `open -a` could not start Docker Desktop from the CLI. Operator started Docker Desktop manually (the one non-CLI step), then `supabase db reset` + `pnpm test:e2e` ran green (38/38). No code impact.

### Deferred Items (→ 13-04 live smoke / gate batch)
- (a) `pageSize:1` actually returns the v4 aggregate (averageRating + totalReviewCount with reviews[] length 1).
- (b) the exact non-verified / non-VoM `reviews.list` response shape (non-2xx vs 200-with-absent).
- (c) **CONFIRM/BACKFILL `external_parent_id` on the Wallace pilot row** — if it predates 13-01 parent-capture, the prod rating is silently always-null and local tests cannot catch it (13-03-RESEARCH open-item 183).
- (d) enable the legacy "Google My Business API" in Cloud Console (Gate A covers reviews) + verify the quota line shows 300 QPM.
- The first LIVE `locations.get` + v4 aggregate call + deploy = the Phase-13 gate batch (13-04).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| render.test `not.toContain("0.0")` red — the styleBlock CSS `rgba(22,21,20,0.04)` contains the substring "0.0" | Scoped the assertion to the KPI value node (`not.toContain(">0.0<")` + `toContain('<div class="n">n/a</div>')`) |
| `oauth2.request` seam typing in gbp-reviews.test — the no-arg `vi.fn` inferred a 0-tuple param, so `request.mock.calls[0][0]` failed tsc | Typed the introspecting spy's param `(_opts: Parameters<GbpV4RequestFn>[0])` |
| Docker daemon down → e2e blocked | Operator started Docker Desktop; reset + e2e green |

## Skill Audit

**All required flows invoked ✓** (SPECIAL-FLOWS.md): research-first satisfied — `13-03-RESEARCH.md` (ultracode Workflow `wf_0906aaba-c3b`, the v4 aggregate) + `13-RESEARCH.md` §Presence/§Data-model (presence state + cron cadence) cover this plan; the real-contract verification mandate was met by introspecting the `mybusinessbusinessinformation` v1 `locations.get` method + field paths against the installed googleapis@173 type defs (same substitute used at 13-01/13-02b; the live call is the recorded 13-04 deferral).

## Next Phase Readiness

**Ready:**
- The GBP presence + rating ingest + both surfaces are built and locally gate-verified (tsc 0, eslint 0/0, vitest 659, build green no-dep, supabase reset, e2e 38/38).
- Phase 13 = 2 of 4(→5) plans + the 13-03 foundation + ingest done; the build-local work for the GBP vertical is complete. Only the prod activation gate batch (13-04) remains in Phase 13.

**Concerns:**
- The live Google contract for `locations.get` + the v4 reviews aggregate is verified against type defs only, not a live call — the 13-04 smoke must confirm (a)-(d) above. The Wallace `external_parent_id` backfill is the highest-risk silent-null item.

**Blockers:**
- None for the build. Phase-13 activation is gated on operator items (Gate A GBP API access, Gate B `business.manage` verification, revoke the chat-pasted GCP key) + the 13-04 gate batch.

---
*Phase: 13-gbp-presence, Plan: 03b*
*Completed: 2026-06-15*
