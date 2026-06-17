---
phase: 14-reviews-sentiment
plan: 01
subsystem: api
tags: [gbp, google-business-profile, reviews, v4-reviews-api, ingest, cron, supabase, raw-http, oauth]

# Dependency graph
requires:
  - phase: 13-reviews-sentiment (13-01)
    provides: gbp google_oauth_accounts rows + external_parent_id capture + getLinkedAccount read-side
  - phase: 13-reviews-sentiment (13-03b)
    provides: gbp-reviews.ts raw-HTTP v4 seam (aggregate) + gbp-presence-sync orchestrator skeleton
  - phase: 6 (06-04)
    provides: review_items / review_responses + the reply-draft + human-approval pipeline
provides:
  - per-review GBP v4 ingest into review_items (idempotent, keyed shop_id+external_review_id)
  - gbp-reviews-sync orchestrator (batch + single-shop) + /api/cron/gbp-reviews-sync (10th cron)
  - reviews/ingest route rewired from 501 stub to a working single-shop ingest
affects: [14-02 reply-publish-to-Google, 14-03 LLM sentiment, Phase-14 gate batch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-review v4 raw-HTTP pagination (pageSize:50 + orderBy updateTime desc + nextPageToken loop) mirroring the pageSize:1 aggregate seam"
    - "Shared per-shop ingest core (ingestShopReviews) reused by both the batch cron and the single-shop on-demand route"
    - "Membership gate (user client) decides access; service client does the RLS-bypass upsert"

key-files:
  created:
    - supabase/migrations/20260616163539_review_items_gbp_reviews.sql
    - src/lib/google-oauth/gbp-review-items.ts
    - src/lib/google-oauth/gbp-reviews-sync.ts
    - src/app/api/cron/gbp-reviews-sync/route.ts
  modified:
    - src/app/api/reviews/ingest/route.ts
    - vercel.json

key-decisions:
  - "AC-2 throw-and-contain: 200-with-reviews-absent -> [] (skipped, not flipped); genuine non-2xx rethrows + is contained (auth_failed flips per AC-3). Swallowing a live-token 401/403 would mask a dead link."
  - "Widen ONLY analytics_sync_runs source CHECK, not analytics_snapshots — reviews land in review_items, no snapshot row is written."
  - "Resolve + drop the source CHECK by its LIVE name (pg_constraint) rather than assume the auto-name."
  - "Resolve the internal PRIMARY location_id per shop (review_items.location_id NOT NULL); a no-location shop is a data-gap -> skipped + counted, NOT flipped."

patterns-established:
  - "v4 reviews per-review fetch is a SEPARATE module (gbp-review-items.ts) from the pageSize:1 aggregate (gbp-reviews.ts) — decoupled per 14-RESEARCH #11"

# Metrics
duration: ~100min
started: 2026-06-16T15:35:00Z
completed: 2026-06-16T17:17:38Z
---

# Phase 14 Plan 01: GBP reviews per-review ingest Summary

**Per-review Google Business Profile reviews (legacy v4 accounts.locations.reviews.list) now ingest idempotently into review_items via a batch cron + an on-demand route sharing one orchestrator; the 501 ingest stub is gone. Build-local, ZERO prod.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~100 min |
| Started | 2026-06-16T15:35:00Z |
| Completed | 2026-06-16T17:17:38Z |
| Tasks | 3 completed (DONE/PASS) |
| Files modified | 8 (6 source/migration + 2 modified; incl. 4 test files) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Per-review v4 fetch maps the Review schema into review_items shape | Pass | `gbp-review-items.ts`: name→external_review_id, StarRating word→int (ONE..FIVE=1..5, UNSPECIFIED/unknown→null), comment→text, reviewer.isAnonymous→null author, createTime→reviewed_at, updateTime→updated_at; nextPageToken loop. 11 unit tests. |
| AC-2: Unverified / empty location degrades, never trips the breaker | **Pass (DRIFT — see Deviations)** | The realistic unverified/non-VoM case = a 200 with `reviews` absent → `[]` → zero rows → counted skipped → NOT flipped. The AC's literal "non-2xx reject" branch diverges: a non-auth non-2xx → failed (not skipped); an auth_failed → flips (per AC-3). Throw-and-contain is deliberate. Resolver pinned to the deferred non-verified-LIST-shape smoke. |
| AC-3: Orchestrator ingests idempotently with contained per-shop failure | Pass | `syncGbpReviews`: dedupeByShop, per-shop try/catch, auth_failed → markAccountError, one `analytics_sync_runs` ledger row source='gbp_reviews'; upsert onConflict (shop_id, external_review_id). Re-run-nets-zero is the onConflict guarantee (real-DB dedup deferred to smoke; mocked locally). 11 unit tests. |
| AC-4: The 501 ingest stub is replaced by a working single-shop ingest + cron | Pass | `reviews/ingest` returns { inserted, skipped, errors } under the existing membership gate (service client does the upsert); `/api/cron/gbp-reviews-sync` CRON_SECRET-gated (timingSafeEqual), runtime=nodejs, 503 when creds absent. 6 cron + 4 ingest route tests. |
| AC-5: Additive migration + CHECK widen, locally verified, ZERO prod | Pass | `supabase db reset` exit 0; docker psql confirmed external_review_id + updated_at + UNIQUE(shop_id,external_review_id); 'gbp_reviews' ledger insert accepted, bogus rejected (23514); the auto-named source CHECK dropped by LIVE name (resolved to standard `analytics_sync_runs_source_check`); nothing applied to prod. |

Skill audit: All required flows invoked ✓ (Research-first: 14-RESEARCH.md present, ultracode wf_4ac2ec22-54d; per-plan check confirmed, no new external surface beyond the settled v4 reviews.list READ contract).

## Accomplishments

- review_items can now hold idempotent per-review GBP rows keyed (shop_id, external_review_id); a re-run upserts (onConflict) rather than duplicating.
- A linked shop's reviews ingest via the daily cron AND via the on-demand /api/reviews/ingest route, sharing one per-shop core (ingestShopReviews).
- The 501 stub is replaced with a real ingest under the membership gate; the reply-draft + sentiment pipeline (14-02/14-03) now has data to act on.
- Per-shop failures contained; auth_failed flips the account; no-internal-location shops skipped + counted (flagged for the gate-batch backfill).

## Task Commits

Not committed — phase-boundary (matches the Phase-13 per-plan convention; the Phase-14 commit lands with the phase transition or the gate batch).

| Task | Type | Description |
|------|------|-------------|
| Task 1: Migration | feat | review_items dedupe key + updated_at + UNIQUE; analytics_sync_runs source CHECK += 'gbp_reviews' (live-name resolve) |
| Task 2: gbp-review-items.ts | feat | Paginated per-review v4 fetch + Review→review_items mapping + 11 tests |
| Task 3: orchestrator + cron + ingest rewire | feat | gbp-reviews-sync (batch + single-shop) + 10th cron + reviews/ingest rewire + vercel.json + 21 tests |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260616163539_review_items_gbp_reviews.sql` | Created | review_items += external_review_id + updated_at + UNIQUE(shop_id,external_review_id); analytics_sync_runs source CHECK widened += 'gbp_reviews' |
| `src/lib/google-oauth/gbp-review-items.ts` | Created | Paginated raw-HTTP v4 per-review fetch + Review→review_items map |
| `src/lib/google-oauth/__tests__/gbp-review-items.test.ts` | Created | 11 unit tests (mapping, pagination, defensive paths) |
| `src/lib/google-oauth/gbp-reviews-sync.ts` | Created | Batch `syncGbpReviews` + single-shop `syncGbpReviewsForShop` + shared `ingestShopReviews` |
| `src/lib/google-oauth/__tests__/gbp-reviews-sync.test.ts` | Created | 11 unit tests (idempotent upsert, containment, skip-no-location, dedupe, ledger) |
| `src/app/api/cron/gbp-reviews-sync/route.ts` | Created | 10th cron — CRON_SECRET-gated, nodejs, 503 not-configured |
| `src/app/api/cron/gbp-reviews-sync/__tests__/route.test.ts` | Created | 6 cron gate + happy-path tests |
| `src/app/api/reviews/ingest/route.ts` | Modified | 501 stub → service-client single-shop ingest under the membership gate |
| `src/app/api/reviews/ingest/__tests__/route.test.ts` | Created | 4 route tests (401/400/403/200) |
| `vercel.json` | Modified | 10th cron entry `/api/cron/gbp-reviews-sync` at `0 8 * * *` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| AC-2 throw-and-contain (200-empty→[]; non-2xx rethrows + contained) | Swallowing a live-token 401/403 to [] would silently mask a dead link forever — worse than flipping | A genuine auth failure flips the account (needs re-link); resolver pinned to the gate-batch non-verified-LIST-shape smoke |
| Widen ONLY analytics_sync_runs, not analytics_snapshots | Reviews land in review_items; no snapshot row is written | One additive CHECK widen, no snapshot source pollution |
| Drop the source CHECK by LIVE name (pg_constraint) | The 20260605 inline CHECK was auto-named; assuming the name no-ops silently if it differs | AC-5 verified, not assumed; spared the unrelated status_check |
| Resolve internal PRIMARY location_id per shop | review_items.location_id is NOT NULL | A no-location shop is a data-gap → skipped + counted, NOT flipped (gate-batch backfill flag) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Spec-reconciliation (DRIFT, recorded) | 1 | AC-2 literal text vs throw-and-contain; resolver deferred to gate-batch smoke |

**Total impact:** No scope creep. One honest DRIFT on AC-2's literal prose, advisor-reviewed, resolved by deliberate design.

### DRIFT — AC-2 literal text vs throw-and-contain

- **Found during:** QUALIFY of Task 2/3 against AC-2 word-by-word.
- **AC literal:** "a non-2xx reject ... returns an empty array ... counted skipped ... NOT flipped."
- **Implementation:** the *realistic* unverified/non-VoM case is a 200 with `reviews` absent → `[]` → skipped, not flipped (matches AC). A *genuine* non-2xx rethrows via mapGoogleApiError and is contained per-shop: a non-auth code → failed (not skipped); an auth_failed (401/403) → flips (per AC-3).
- **Why:** swallowing a live-token 401/403 to `[]` would mask a permanently dead link. A spurious "needs re-link" prompt is recoverable; a silently dead link is not.
- **Validation gap:** whether an unverified/non-VoM location actually emits 401/403 (→ my code flips, a possible false re-link) vs a 200-empty (→ skipped, correct) is UNVALIDATED locally — it is exactly the deferred non-verified-LIST-shape live smoke.
- **No code change** — labeled honestly for the UNIFY/gate-batch sign-off.

### Deferred Items — Phase-14 gate batch smoke checklist (shares Phase-13 Gate A/B)

1. StarRating live word-enum values (real response shape).
2. Non-verified-location LIST shape (= the AC-2 DRIFT resolver: 200-empty vs 401/403).
3. Idempotent re-run nets zero new rows against the REAL review_items (the AC-3 onConflict dedup; mocked locally, constraint proven via `\d`).
4. 300 QPM headroom.
5. Token-authorizes-read (business.manage on the live token).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Initial tsc tuple-index error on a typed `vi.fn` request mock + a new eslint unused-param warning | Switched the FIRST-GET test to `vi.fn().mockResolvedValue(...)` (call args typed `any`) and the markErrorMock to a bare `vi.fn()` (default type absorbs the spread); tsc 0 / eslint 0/0 |
| psql not on host PATH | Used docker-exec psql against `supabase_db_psg-hub` (the established 13-0x pattern) |

## Next Phase Readiness

**Ready:**
- review_items now carries the dedupe key + the ingest path; 14-02 (reply-publish) and 14-03 (LLM sentiment) have per-review data to act on.
- The orchestrator + cron pattern is in place to extend.

**Concerns:**
- Live behavior of the v4 reviews.list (StarRating values, unverified-location shape, real-DB onConflict dedup) is unvalidated until the Phase-14 gate batch — same blind-built risk the research gate guards against, mitigated by defensive coding + the deferred smoke list.

**Blockers:**
- None for build. Prod activation is gated on the shared Phase-13 Gate A (GBP API 300 QPM) + Gate B (business.manage sensitive-vs-restricted), per 14-RESEARCH.

---
*Phase: 14-reviews-sentiment, Plan: 01*
*Completed: 2026-06-16*
