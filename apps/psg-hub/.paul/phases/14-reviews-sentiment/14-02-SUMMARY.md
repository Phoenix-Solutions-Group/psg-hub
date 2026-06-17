---
phase: 14-reviews-sentiment
plan: 02
subsystem: api
tags: [gbp, google-business-profile, reviews, v4-updateReply, reply-publish, cron, supabase, raw-http, oauth, consent, legal-gate]

# Dependency graph
requires:
  - phase: 14-reviews-sentiment (14-01)
    provides: review_items per-review GBP rows (external_review_id) + the gbp-reviews-sync orchestrator/cron pattern to clone
  - phase: 13-reviews-sentiment (13-03b)
    provides: gbp-reviews.ts raw-HTTP v4 seam (buildOAuth2Client(...).request, slash-join parent, mapGoogleApiError) to mirror
  - phase: 6 (06-04)
    provides: review_responses + the reply-draft + human-approval (status draft|approved|rejected) pipeline
provides:
  - review_responses per-reply publish lifecycle (publish_status / publish_error / publish_attempts / published_version / external_reply_updated_at)
  - gbp-reviews-reply.ts raw-HTTP v4 updateReply + deleteReply adapter (byte-limit-safe)
  - gbp-reviews-reply-sync orchestrator + an UNSCHEDULED /api/cron/gbp-reviews-reply (NOT in vercel.json)
  - a RECORDED consent/authorization decision gating live publish + a named follow-up (14-02b / Phase-14 gate batch)
affects: [14-02b consent+authorization+UI+activation, 14-03 LLM sentiment, Phase-14 gate batch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row publish lifecycle ON the row (publish_status/error/attempts) as the audit trail — NO sync ledger (deliberate deviation from 14-01's analytics_sync_runs ledger)"
    - "published_version dirty-check: re-publish when an edited+re-approved row's version exceeds published_version (updateReply is an upsert → safe re-post)"
    - "Consent-NEUTRAL plumbing only — NO deploy-live, user-reachable publish trigger ships; the sole invokers are unit tests + an unscheduled CRON_SECRET-only cron"

key-files:
  created:
    - supabase/migrations/20260616231817_review_responses_publish_state.sql
    - src/lib/google-oauth/gbp-reviews-reply.ts
    - src/lib/google-oauth/gbp-reviews-reply-sync.ts
    - src/app/api/cron/gbp-reviews-reply/route.ts
  modified: []

key-decisions:
  - "T4 consent model = operator-click-under-recorded-per-shop-authorization (vs end-client-only) — REQUIRES EXPLICIT LEGAL SIGN-OFF; RECORDED only, NO consent schema built in 14-02"
  - "NO publish ledger — the per-row publish_status/publish_error/publish_attempts ARE the audit (deviation from 14-01's ingest ledger)"
  - "DROPPED the membership-gated manual publish route + UI button — on prod googleCredsPresent() is true, so an owner/manager route = a PSG-operator-reachable live publish trigger = the exact policy hole"
  - "DROPPED the pre-write hasVoiceOfMerchant short-circuit — computed at 13-01 (gbp-enumerate.ts:153) but NEVER persisted; the updateReply WRITE rejects unverified anyway → map to publish_failed (no flip)"

patterns-established:
  - "Reply-publish is a SEPARATE module (gbp-reviews-reply.ts / -sync.ts) from the read-side ingest (gbp-review-items.ts) and the aggregate (gbp-reviews.ts)"
  - "A load-bearing LEGAL/PRODUCT gap is surfaced as a checkpoint:decision, recorded to STATE Decisions with a named activation follow-up, and the plan ships ZERO live publish regardless"

# Metrics
duration: ~70min
started: 2026-06-16T17:20:00Z
completed: 2026-06-16T18:30:00Z
---

# Phase 14 Plan 02: GBP reply publish-to-Google Summary

**The GBP reply publish vertical (legacy v4 updateReply/deleteReply) is built build-local: a review_responses publish-state migration, a byte-limit-safe raw-HTTP reply adapter, and a publish orchestrator + an UNSCHEDULED CRON_SECRET-only cron — with NO deploy-live, user-reachable publish trigger, and the load-bearing consent/authorization model RECORDED as a decision that gates live activation. ZERO prod, ZERO live publish.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~70 min |
| Started | 2026-06-16T17:20:00Z |
| Completed | 2026-06-16T18:30:00Z |
| Tasks | 4 completed (3 auto DONE/PASS + 1 checkpoint:decision RESOLVED) |
| Files modified | 6 created (3 source + 1 migration + 3 test files; counted 7 incl. tests) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: reply adapter PUTs updateReply correctly + enforces the byte limit PSG-side | Pass | `gbp-reviews-reply.ts`: `publishReply` PUTs `v4/{reviewName}/reply` body `{ comment }` ONLY (no output-only fields), reads back `reviewReplyState`, rejects `Buffer.byteLength(comment,'utf8') > 4096` BEFORE any request (never string `.length`); `deleteReply` issues DELETE empty-body (rollback). reviewName is already the full `accounts/{aid}/locations/{lid}/reviews/{rid}` path → NO account re-prefix (tested no `accounts//`). 8 unit tests. |
| AC-2: unverified-location WRITE degrades to publish_failed, never trips the breaker / flips the account | **Pass (DRIFT — see Deviations)** | The orchestrator maps an unverified WRITE rejection to `publish_status='publish_failed'`, `publish_error`, `publish_attempts++`, account NOT flipped, batch continues; NO pre-write hasVoiceOfMerchant short-circuit (signal not persisted — recorded deferral). DRIFT: no-flip holds IFF the rejection surfaces as a `bad_request` (400 FAILED_PRECONDITION); if it surfaces as 403 it flips (a possible false re-link) — the gate-batch live-smoke resolves it (mirrors the 14-01 AC-2 DRIFT). |
| AC-3: orchestrator publishes approved, dirty rows idempotently with contained per-row failure | Pass | `syncGbpReviewReplies`: selects `status='approved'` + `publish_status<>'publishing'` (+ `review_items!inner(shop_id,external_review_id)`), JS dirty-filters `published_version<version` (col<col is not a PostgREST filter), per-row contained try/catch, optimistic version guard on the success update, on success sets `published_at`/`published_version=version`/`publish_status='published'`/`external_reply_updated_at` and reflects `reviewReplyState` (PENDING→`publishing`, REJECTED→`publish_failed`, else→`published`); a re-run nets zero; an edited-after-publish row (version>published_version) re-publishes; auth_failed → `markAccountError`. 11 unit tests. |
| AC-4: no deploy-live, user-reachable publish trigger ships; the cron is unscheduled | Pass | The ONLY invokers of the publish core are the unit tests (injected deps) + GET/POST `/api/cron/gbp-reviews-reply` (CRON_SECRET timingSafeEqual, runtime='nodejs', 503 when google creds absent). The cron is NOT in vercel.json (verified STILL 10 crons). grep clean: NO `/api/reviews/[id]/publish-reply` route, NO UI publish button. 6 cron tests. |
| AC-5: additive migration, locally verified, ZERO prod, approve path untouched | Pass | `20260616231817_review_responses_publish_state.sql`: ADD COLUMN IF NOT EXISTS `publish_status` (named CHECK pending\|publishing\|published\|publish_failed, default 'pending') + `publish_error` + `publish_attempts int default 0` + `published_version int` + `external_reply_updated_at timestamptz`; `supabase db reset` exit 0; docker psql confirmed the 5 columns + CHECK (accept 'published' / reject 'bogus' [23514]); status state machine + approve-response route + 14-01 ingest files unchanged; NO analytics_sync_runs widen; nothing applied to prod. |

Skill audit: All required flows invoked ✓ (SPECIAL-FLOWS research-first: 14-RESEARCH.md present, ultracode wf_4ac2ec22-54d, §updateReply WRITE contract + §Policy + §Reply-publish architecture cover this plan's WRITE surface; per-plan check confirmed — no new external surface beyond the settled v4 updateReply WRITE contract; the v4 WRITE live-smokes deferred to the Phase-14 gate batch).

## Accomplishments

- review_responses now tracks the per-reply publish lifecycle, dirty-checked by `version` so an edited+re-approved reply re-posts (and a clean re-run nets zero new publishes).
- The reply adapter + publish orchestrator are built and unit-proven against the mocked v4 WRITE seam: byte-limit-safe PSG-side, contained per-row failure, unverified→publish_failed with no account flip, PENDING reviewReplyState reflected (never reported as published).
- NO deploy-live, user-reachable publish trigger ships: the sole invokers are the unit tests and an UNSCHEDULED CRON_SECRET-only cron (absent from vercel.json) — closing the exact policy hole a membership-gated route would have opened.
- The load-bearing consent/authorization model is RECORDED as a decision (operator-click-under-recorded-per-shop-authorization, legal-sign-off-required) with a named activation follow-up (14-02b / Phase-14 gate batch); live publish is gated.

## Task Commits

Not committed — phase-boundary (matches the Phase-13/14-01 per-plan convention; the Phase-14 commit lands with the phase transition or the gate batch).

| Task | Type | Description |
|------|------|-------------|
| Task 1: Migration | feat | review_responses += publish_status[CHECK]/publish_error/publish_attempts/published_version/external_reply_updated_at (status machine + approve-response UNTOUCHED; NO analytics_sync_runs widen) |
| Task 2: gbp-reviews-reply.ts | feat | raw-HTTP v4 updateReply (body {comment} only) + deleteReply rollback + 4096-BYTE Buffer.byteLength guard + reviewReplyState reflect + 8 tests |
| Task 3: orchestrator + UNSCHEDULED cron | feat | gbp-reviews-reply-sync (approved+dirty select, optimistic version, contained per-row, auth_failed→markAccountError, unverified→no-flip) + /api/cron/gbp-reviews-reply (NOT in vercel.json) + 11 + 6 tests |
| Task 4: checkpoint:decision | docs | consent+authorization model RESOLVED → STATE Decisions + named follow-up 14-02b/gate batch; NO consent schema built |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260616231817_review_responses_publish_state.sql` | Created | review_responses += 5 publish-lifecycle columns + named publish_status CHECK (additive/idempotent) |
| `src/lib/google-oauth/gbp-reviews-reply.ts` | Created | raw-HTTP v4 `publishReply` (updateReply) + `deleteReply` (rollback); PSG-side 4096-byte guard |
| `src/lib/google-oauth/__tests__/gbp-reviews-reply.test.ts` | Created | 8 unit tests (PUT body/URL, no double-prefix, byte guard, PENDING reflect, 403 map, DELETE) |
| `src/lib/google-oauth/gbp-reviews-reply-sync.ts` | Created | `syncGbpReviewReplies` publish orchestrator (no ledger; per-row publish_status is the audit) |
| `src/lib/google-oauth/__tests__/gbp-reviews-reply-sync.test.ts` | Created | 11 unit tests (publish, re-run-zero, re-publish-on-version-bump, unverified-no-flip, auth-flip, skip-Places-only, PENDING-not-published, optimistic-skip) |
| `src/app/api/cron/gbp-reviews-reply/route.ts` | Created | UNSCHEDULED cron — CRON_SECRET timingSafeEqual, nodejs, 503 not-configured |
| `src/app/api/cron/gbp-reviews-reply/__tests__/route.test.ts` | Created | 6 cron gate + happy-path tests (401 bad/absent secret, 503 creds absent, 200 result) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| T4 consent model = operator-click-under-recorded-per-shop-authorization (vs end-client-only) | Fits PSG's agency operating model while capturing the on-behalf-of authorization the policy requires | **REQUIRES EXPLICIT LEGAL SIGN-OFF** (the per-reply consent is the operator's, leaning on the per-shop authorization + transparency); RECORDED only, NO consent schema in 14-02. Gates live publish. → STATE Decisions (2026-06-16) + named follow-up 14-02b/gate batch |
| NO publish ledger (per-row publish_status is the audit) | A publish acts on a single review_responses row; the lifecycle columns ON the row capture it | Deliberate deviation from 14-01's analytics_sync_runs ingest ledger; no ledger source CHECK widen |
| DROPPED the membership-gated manual publish route + UI button | On prod `googleCredsPresent()` is true → an owner/manager route would be a deploy-live PSG-operator-reachable publish trigger = the exact policy hole | Sole invokers in 14-02 = unit tests + the unscheduled CRON_SECRET-only cron; all user-reachable triggers deferred to the consent-gated 14-02b |
| DROPPED the pre-write hasVoiceOfMerchant short-circuit | grep-confirmed it is computed at 13-01 (gbp-enumerate.ts:153) but NEVER persisted (not in GbpPresenceMetrics, not on google_oauth_accounts) | The updateReply WRITE rejects unverified anyway → map to publish_failed (no flip); persisting the signal for the optimization deferred |
| ADDED a published_version dirty-check column | `published_at IS NULL` alone never re-posts an edited+re-approved reply; updateReply upsert makes re-posting safe | Re-publish when version exceeds published_version; clean re-run nets zero |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Spec-reconciliation (DRIFT, recorded) | 1 | AC-2 unverified-WRITE 400-vs-403 mapping; resolver = the deferred gate-batch live-smoke |

**Total impact:** No scope creep. One honest DRIFT on AC-2 (the unverified-WRITE error code), advisor-anticipated, resolved by the gate-batch live-smoke — the same shape as the 14-01 AC-2 DRIFT.

### DRIFT — AC-2 unverified-location WRITE: no-flip is conditional on the error code

- **Found during:** QUALIFY of Task 3 against AC-2.
- **AC intent:** an unverified-location WRITE rejection → `publish_status='publish_failed'`, account NOT flipped.
- **Implementation:** the orchestrator maps `bad_request` (400 FAILED_PRECONDITION) → publish_failed with NO flip (matches AC). But an `auth_failed` (401/403) → flips via `markAccountError` (per AC-3).
- **Validation gap:** whether an unverified/non-VoM location's WRITE actually rejects as 400 (→ no flip, correct) vs 403 (→ flip = a possible false "needs re-link") is UNVALIDATED locally — it is exactly the deferred v4 WRITE live-smoke (unverified-WRITE status).
- **No code change** — labeled honestly for the gate-batch sign-off, mirroring the 14-01 AC-2 DRIFT resolver.

### Deferred Items — Phase-14 gate batch v4 WRITE live-smoke checklist (shares Phase-13 Gate A/B)

1. Replay-same-comment → 200 not 409 (updateReply upsert idempotency).
2. >4096-BYTE comment → 400 not silent truncation.
3. Unverified-location WRITE status/body (= the AC-2 DRIFT resolver: 400 vs 403).
4. Fresh `reviewReplyState` values on a real WRITE.
5. deleteReply 204-vs-200 + delete-missing 404.
6. Existing gbp refresh token authorizes a WRITE (not just a read).

### Deferred Items — the consent-gated activation follow-up (14-02b / Phase-14 gate batch)

- The per-shop end-client authorization record + per-reply consent capture schema.
- The approve-gate handling (record the authorization; operator click permitted under it).
- The UI publish button.
- Live activation: add `/api/cron/gbp-reviews-reply` to vercel.json + the gate-batch live-smokes.
- **EXPLICIT LEGAL SIGN-OFF** before any live publish.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `published_version < version` is a column-vs-column comparison, not expressible as a PostgREST filter | Selected the candidate rows (status='approved' AND publish_status<>'publishing') then JS dirty-filtered `published_version<version` in the orchestrator |
| Local psql cannot assert the CHECK with the FK to review_items present | Asserted accept/reject ([23514]) inside an FK-disabled, rolled-back txn (the established 13-0x docker-psql pattern) |

## Next Phase Readiness

**Ready:**
- The full reply-publish plumbing (migration + adapter + orchestrator + unscheduled cron) is built and unit-proven; 14-02b can layer the consent/authorization schema + UI + activation on top.
- 14-03 (LLM sentiment) is unblocked — it consumes the same review_items/review_responses; this plan touched neither the read-side ingest nor the draft pipeline.

**Concerns:**
- Live behavior of the v4 updateReply WRITE (idempotency, byte-limit rejection code, unverified-WRITE status, reviewReplyState values, token-authorizes-WRITE) is unvalidated until the Phase-14 gate batch — the same blind-built risk the research gate guards against, mitigated by defensive coding + the deferred WRITE smoke list.
- Live publish is BLOCKED behind the recorded consent decision + explicit legal sign-off; do not add the cron to vercel.json or build any user-reachable trigger before 14-02b lands.

**Blockers:**
- None for build. Live activation is gated on: the recorded consent/authorization decision + legal sign-off (14-02b), plus the shared Phase-13 Gate A (GBP API 300 QPM) + Gate B (business.manage sensitive-vs-restricted), per 14-RESEARCH.

---
*Phase: 14-reviews-sentiment, Plan: 02*
*Completed: 2026-06-16*
