---
phase: 14-reviews-sentiment
plan: 04
subsystem: infra
tags: [gbp, google-business-profile, oauth, reviews, sentiment, prod-activation, migration, vercel-cron, supabase]

# Dependency graph
requires:
  - phase: 14-01
    provides: per-review v4 reviews.list ingest → review_items + the gbp-reviews-sync cron + migration 20260616163539
  - phase: 14-02
    provides: reply publish-to-Google plumbing + migration 20260616231817 (review_responses publish-state)
  - phase: 14-03
    provides: LLM sentiment (review_sentiment table + Haiku classifier + classify-on-ingest) + migration 20260617120000
  - phase: 13-04
    provides: the prior gate-batch template (PROTOCOL + deploy env + Gate A/B mechanics + the ../.vercel hazard)
provides:
  - Phase-14 reviews + sentiment vertical LIVE on prod (385 real Wallace reviews ingested)
  - 3 Phase-14 migrations applied to prod under PROTOCOL
  - gbp-reviews-sync cron deployed (10 crons live)
  - GBP OAuth re-pointed to the operator's separate n8n-workspace-apis client (gbpOAuthClientEnv)
affects: [complete-milestone-v0.3.5, 14-02b reply-publish activation, 14-03b sentiment surface, fleet rollout (locations backfill)]

# Tech tracking
tech-stack:
  added: []   # pure activation + a config/env deviation; NO new runtime dependency
  patterns: ["gbpOAuthClientEnv() — per-product OAuth client override falling back to the shared client"]

key-files:
  created:
    - .paul/phases/14-reviews-sentiment/14-04-GATE-BATCH.md
  modified:
    - src/lib/google-oauth/client.ts
    - src/lib/google-oauth/gbp-client.ts
    - src/lib/google-oauth/state.ts
    - "+ 10 more GBP-client-thread files (5 routes + 5 libs)"

key-decisions:
  - "GBP OAuth client = the operator's SEPARATE n8n-workspace-apis app, NOT the shared psg-google-ads client (13-01 was wrong) — surfaced as redirect_uri_mismatch at the live Wallace link"
  - "review_items needs an internal public.locations row per shop (NOT-NULL FK) that onboarding never creates — systemic fleet gap; Wallace backfilled"
  - "Phase 14 closed LIVE (not the predicted activation-pending) — Gate A/B had cleared since 13-04"

patterns-established:
  - "Per-product OAuth client env override (gbpOAuthClientEnv) with shared-client fallback — the seam if GA4/GSC/Ads ever need to split off the shared client too"

# Metrics
duration: operator-paced activation session
started: 2026-06-17
completed: 2026-06-17
---

# Phase 14 Plan 04: Phase-14 prod-activation gate batch Summary

**The Phase-14 reviews + sentiment vertical went LIVE on real Wallace data — 385 reviews ingested via the v4 per-review path, 3 migrations applied under PROTOCOL, the gbp-reviews-sync cron deployed (10 crons) — after a fix-forward deviation re-pointed GBP OAuth to the operator's separate n8n-workspace-apis client. Closed LIVE, beating the plan's expected activation-pending.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | operator-paced activation session |
| Started | 2026-06-17 |
| Completed | 2026-06-17 |
| Tasks | 2 (Task 1 auto DONE; Task 2 checkpoint:human-action EXECUTED) |
| Files modified | 13 source (GBP-client thread) + 1 runbook created + 3 prod migrations applied + 1 prod deploy |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Runbook authored as a delta over 13-04, ordered, executable | Pass | `14-04-GATE-BATCH.md` — Stage 0 Gate A/B re-check (incl. legacy GMB 300 QPM line) → Stage A 3 migrations under PROTOCOL → Stage B secrets → Stage C `vercel --prod` → Stage D D1/D2/D3 → Stage E close; out-of-scope 14-02b/14-03b named. |
| AC-2: 3 Phase-14 migrations apply under PROTOCOL with a clean advisor diff | Pass | 20260616163539 + 20260616231817 + 20260617120000 applied to gylkkzmcmbdftxieyabw. Advisor 124→124 security-clean + 1 benign perf INFO (unused_index, expected on fresh tables). analytics_sync_runs_source_check name confirmed; review_items/review_responses/review_sentiment structurally confirmed. |
| AC-3: gbp-reviews-sync cron deploys via vercel --prod, no new secret, reply cron absent | **Pass-with-deviation** | Cron deployed (10 crons, gbp-reviews-sync present, gbp-reviews-reply ABSENT, 401-gated). The **"no new secret" sub-clause FAILED** — the GBP-OAuth-client deviation added 3 new prod env vars (GOOGLE_GBP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI). See Deviations. |
| AC-4: Live activation OR honest activation-pending; sentiment asserted as ROWS | **Pass (exceeded)** | Closed **LIVE**, not activation-pending. D1: Wallace re-consented under business.manage → 385 reviews ingested (385 distinct external_review_id, StarRating 1-5 clean, full v4 path, dedup holds). D2: gateway-Haiku sentiment proven live (local smoke, ZERO prod write) — a review_sentiment ROW with valid polarity, asserted as a row not a cron 200. D3 (7-day token pass-gate) still pending (time-based). |

## Accomplishments

- Phase-14 reviews vertical LIVE on prod: 385 real Wallace reviews ingested through the v4 per-review path; parser validated against real data (StarRating word→int mapping clean, dedup holds, full pagination path exercised).
- 3 Phase-14 migrations applied to prod under PROTOCOL with a security-clean advisor diff.
- gbp-reviews-sync cron deployed live (10 crons; the legal-gated reply cron correctly absent).
- Root-caused and fixed a latent OAuth-client misassumption inherited from 13-01 (redirect_uri_mismatch) without touching GA4/GSC/Ads.
- Sentiment classifier proven live against a real gateway-Haiku round-trip (de-risked the build-blind parser independently of Google).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `.paul/phases/14-reviews-sentiment/14-04-GATE-BATCH.md` | Created | The ordered prod-activation runbook (Task 1, AC-1) |
| `src/lib/google-oauth/client.ts` | Modified | `gbpOAuthClientEnv()` — reads GOOGLE_GBP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI, falls back to the shared client; threaded through buildAuthorizeUrl / exchangeCodeForTokens |
| `src/lib/google-oauth/gbp-client.ts` | Modified | GBP client id/secret threaded into the GBP runtime client |
| `src/lib/google-oauth/state.ts` | Modified | GBP-client-aware state/redirect wiring |
| `src/lib/google-oauth/gbp-enumerate.ts` | Modified | GBP-client thread |
| `src/lib/google-oauth/gbp-presence.ts` | Modified | GBP-client thread |
| `src/lib/google-oauth/gbp-review-items.ts` | Modified | GBP-client thread |
| `src/lib/google-oauth/gbp-reviews.ts` | Modified | GBP-client thread |
| `src/lib/google-oauth/gbp-reviews-reply.ts` | Modified | GBP-client thread |
| `src/app/api/analytics/google/gbp/authorize/route.ts` | Modified | Uses the GBP OAuth client for the consent redirect |
| `src/app/api/analytics/google/gbp/callback/route.ts` | Modified | Uses the GBP OAuth client for the token exchange |
| `src/app/api/cron/gbp-sync/route.ts` | Modified | GBP-client cron guard |
| `src/app/api/cron/gbp-presence-sync/route.ts` | Modified | GBP-client cron guard |
| `src/app/api/cron/gbp-reviews-sync/route.ts` | Modified | GBP-client cron guard |
| (prod) `gylkkzmcmbdftxieyabw` | Migrated | 3 Phase-14 migrations applied under PROTOCOL |
| (prod) `public.locations` | Data | Wallace primary location backfilled (NOT-NULL FK unblock) |
| (prod) Vercel `psg-hub` | Deployed | gbp-reviews-sync cron live (10 crons); 3 new GBP env vars set |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| GBP OAuth client = the operator's separate `n8n-workspace-apis` app, not the shared psg-google-ads client | 13-01 assumed GBP reused GOOGLE_OAUTH_CLIENT_ID; reality = the Business Profile API + its OAuth client live in the operator's n8n project. Surfaced at the live Wallace link as redirect_uri_mismatch. Operator chose (AskUserQuestion) to wire GBP to the n8n client. | GBP authenticates on the n8n client; Wallace linked LIVE. Supersedes 13-04's "no new secret." GA4/GSC/Ads untouched. |
| Backfill Wallace's `public.locations` row | review_items has a NOT-NULL FK to public.locations, but onboarding never creates one (only the Demo shop had a row fleet-wide). | Unblocked the Wallace ingest → 385 reviews. **Systemic: a locations backfill is a fleet prerequisite before rollout.** |
| Close Phase 14 LIVE | Gate A (GBP API 300 QPM) + Gate B (business.manage) had cleared since 13-04 filed them; Wallace re-consented successfully. | Better than the plan's expected activation-pending. Reviews + sentiment are live on prod. |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (fix-forward) | 2 | Both load-bearing for live activation; recorded, not scope creep |
| Scope additions | 0 | — |
| Deferred | 0 new | (14-02b / 14-03b were already named out-of-scope follow-ups in the plan) |

**Total impact:** Two fix-forward deviations were required to reach LIVE — both surfaced at the live smoke (the 12-04/13-04 precedent the plan's boundaries explicitly allow as "a defect surfaced at the Stage D live smoke is a DEVIATION to fix-then-record, not pre-planned scope"). The plan boundaries said "DO NOT CHANGE the Phase-14 application code"; deviation #1 is a code change, justified under that same fix-then-record clause.

### Auto-fixed Issues

**1. [OAuth] GBP `redirect_uri_mismatch` at the live Wallace link**
- **Found during:** Task 2, Stage D1 (the live Wallace re-consent)
- **Issue:** 13-01 assumed GBP reuses the shared GA4/GSC/Ads OAuth client (GOOGLE_OAUTH_CLIENT_ID). The Business Profile API + its OAuth client actually live in the operator's separate `n8n-workspace-apis` GCP project; the consent redirect failed with redirect_uri_mismatch.
- **Fix:** Added `gbpOAuthClientEnv()` (reads GOOGLE_GBP_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI, falls back to the shared client) and threaded the GBP client id/secret through buildAuthorizeUrl / exchangeCodeForTokens + the 6 GBP runtime libs + the 3 GBP cron guards (13 files total). GA4/GSC/Ads untouched. 3 new prod env vars set.
- **Files:** the 13 GBP-client-thread files above.
- **Verification:** tsc 0 / eslint 0 / vitest 739 / build green; redeployed; Wallace linked LIVE; 385 reviews ingested through the re-pointed client.
- **Note:** Supersedes 13-04's recorded "NO new secret" — GOOGLE_GBP_OAUTH_REDIRECT_URI had never been set. Falsifies AC-3's "no new secret" sub-clause.

**2. [Schema/data] review_items NOT-NULL FK to a `public.locations` row onboarding never creates**
- **Found during:** Task 2, Stage D1 (the first Wallace ingest attempt)
- **Issue:** review_items.location_id is NOT NULL → FK public.locations; onboarding never inserts a locations row. Only the Demo shop had one fleet-wide, so the Wallace ingest was FK-blocked.
- **Fix:** Backfilled Wallace's primary location (name 'Wallace Collision', slug 'wallace-collision', is_primary=true).
- **Files:** prod data (public.locations).
- **Verification:** Wallace ingest succeeded → 385 reviews live.
- **Systemic:** every other shop will skip review ingest until a `locations` backfill — a fleet step before rollout (logged below).

### Deferred Items

Already named as out-of-scope follow-ups in the plan (not new):
- **14-02b** — reply-publish live activation: per-shop end-client authorization + per-reply consent schema, the approve-gate handling, the UI publish button, `/api/cron/gbp-reviews-reply` in vercel.json, v4 WRITE smokes. Gated on legal sign-off.
- **14-03b** — sentiment surface: report block + dashboard panel + low-confidence human-review queue + a CI golden-set gate.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| redirect_uri_mismatch on the Wallace consent | Re-pointed GBP OAuth to the n8n-workspace-apis client (deviation #1) |
| Wallace ingest FK-blocked on public.locations | Backfilled Wallace's primary location row (deviation #2) |

## Next Phase Readiness

**Ready:**
- Phase 14 is LIVE on prod; v0.3.5 is the LAST phase of the milestone → ready for `/paul:complete-milestone v0.3.5`.
- Both phases (13 + 14) are activated; the milestone build is complete.

**Concerns / open tails (carry to milestone close):**
- 🔐 **Rotate the chat-exposed GBP client secret** (GOOGLE_GBP_OAUTH_CLIENT_SECRET was pasted in chat) + the older chat-pasted keys still owed from v0.3 (12-04/12-05c list).
- **Sentiment backfill** auto-runs on the gbp-reviews-sync cron (08:00 UTC) — 385 reviews classify over ~2 runs; confirm review_sentiment rows populate.
- **D3 empirical 7-day token pass-gate** — time-based; confirm the GBP refresh token survives 7 days post-consent (the Phase-10 revocation failure mode).
- **Systemic `locations` fleet backfill** — required before review ingest works for any shop beyond Wallace + Demo.
- **14-02b legal sign-off** + **14-03b sentiment surface** sequencing before fleet/feature rollout (operator's call at milestone close).

**Blockers:**
- None for milestone close. (The tails above are follow-ups, not blockers.)

---
*Phase: 14-reviews-sentiment, Plan: 04*
*Completed: 2026-06-17*
