---
phase: 14-reviews-sentiment
plan: 03
subsystem: api
tags: [reviews, sentiment, llm, ai-sdk-v6, output-object, haiku, structured-output, classify-on-ingest, supabase, rls, prompt-injection]

# Dependency graph
requires:
  - phase: 14-reviews-sentiment (14-01)
    provides: review_items per-review rows (text, rating, updated_at) + the gbp-reviews-sync ingest cron to hook classify-on-ingest into
  - phase: 12 (12-02)
    provides: the AI SDK v6 generateText + Output.object structured-output seam (report/narrative.ts) + the shared CircuitBreaker/withRetry resilience + logLLMCall
provides:
  - review_sentiment sibling table (per-review polarity/confidence/themes/actionable_complaint + raw + governance + dirty-key)
  - sentiment.ts Haiku structured-output classifier (injection-hardened, node-testable, schema-gated)
  - classifyPendingSentiment orchestrator wired classify-on-ingest into the gbp-reviews-sync cron (first run = the one-shot backfill)
affects: [14-03b sentiment surface + human-review queue, Phase-14 gate batch (live gateway-Haiku smoke + prod activation)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sentiment classifier MIRRORS the Phase-12 structured-output seam (generateText + Output.object + zod, CircuitBreaker + withRetry, deps-injected generate + logCall) on Haiku — a SEPARATE reviews-domain module, not an extension of report/narrative.ts or responder.ts"
    - "INBOUND classification prompt-injection hardening = the untrusted-input clause COPIED (not imported) from the server-only prompts.ts, keeping sentiment.ts node-testable"
    - "Edited-review dirty-key: classified_updated_at vs review_items.updated_at (the 14-01 updateTime signal) re-classifies an edited review; mirrors the 14-02 published_version pattern"
    - "Classify-on-ingest: the orchestrator rides the existing gbp-reviews-sync cron (NO new cron, NO ledger, free-text logLLMCall purpose) and its first run is the one-shot backfill"

key-files:
  created:
    - supabase/migrations/20260617120000_review_sentiment.sql
    - src/lib/reviews/sentiment-prompt.ts
    - src/lib/reviews/sentiment.ts
    - src/lib/reviews/review-sentiment-sync.ts
  modified:
    - src/app/api/cron/gbp-reviews-sync/route.ts

key-decisions:
  - "Eval gate = the zod enum schema ONLY (NO numeric-groundedness cascade) — a mislabel is recoverable, per 14-RESEARCH"
  - "review_sentiment denormalizes shop_id → RLS clamps directly shop_id IN user_shop_ids() (the review_items idiom), simpler/indexable vs the nested review_responses subquery"
  - "NO publish/analytics_sync_runs ledger + NO source-CHECK widen — per-row columns + the free-text llm_call_log.purpose are the audit (zero migration)"
  - "NO sentiment surface in 14-03 (build-local, like 14-01/14-02) — report/dashboard surface + human-review queue deferred to 14-03b/gate batch"

patterns-established:
  - "A node-testable LLM module pairs a non-server-only prompt/schema file (sentiment-prompt.ts) with a deps-injected classifier (sentiment.ts); the server-only orchestrator wires logLLMCall"

# Metrics
duration: ~55min
started: 2026-06-17T08:55:00Z
completed: 2026-06-17T09:50:00Z
---

# Phase 14 Plan 03: GBP review LLM sentiment Summary

**Per-review sentiment now classifies into a new review_sentiment table via a Haiku structured-output classifier (AI SDK v6 generateText + Output.object, injection-hardened, schema-gated) that the gbp-reviews-sync cron runs after ingest — its first run backfilling pre-existing reviews. Build-local, ZERO prod, ZERO surface; closes the Phase-14 delta set (ingest → reply-publish → sentiment).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~55 min |
| Started | 2026-06-17T08:55:00Z |
| Completed | 2026-06-17T09:50:00Z |
| Tasks | 3 completed (DONE/PASS) |
| Files modified | 6 (4 source/migration created + 1 route modified + 3 test files) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: schema-validated, injection-resistant classifier via the gateway structured-output seam | Pass | `sentiment.ts`: `classifyReviewSentiment` → `generateText` + `Output.object({ schema: sentimentSchema })` on `anthropic/claude-haiku-4.5`, wrapped in the shared `sentimentBreaker` (CircuitBreaker) + `withRetry`; system prompt carries the untrusted-input clause; `deps.logCall` fires on success/error (mirrors narrative.ts). Node-testable (no `server-only`, no `prompts.ts` import). 14 tests incl. injection-resistance + golden-set seed + schema accept/reject. |
| AC-2: additive RLS-clamped sibling table; review_items pristine | Pass | `20260617120000_review_sentiment.sql`: 14 cols, UNIQUE(review_item_id), polarity CHECK, denormalized shop_id, classified_updated_at; RLS enabled + 4 `shop_id IN user_shop_ids()` policies (mirror review_items). docker psql verified: cols, constraints, RLS on, 4 policies, bogus polarity rejected (23514) / positive accepted, review_items 0 sentiment cols. NO source-CHECK widen; nothing to prod. |
| AC-3: orchestrator classifies pending/dirty rows idempotently, contained, edited-review dirty-key | Pass | `classifyPendingSentiment`: selects review_items (text not null) embed review_sentiment, JS `needsClassify` (absent OR prompt_version stale OR `updated_at > classified_updated_at`; null updated_at → classify once), batch-cap (limit 200/run, FETCH_CAP 1000), per-row contained try/catch (failed++), upsert onConflict(review_item_id) w/ version bump + classified_updated_at, `logLLMCall` purpose='review_sentiment_classify'. 8 tests (classify / skip-current / re-classify-edited / re-classify-prompt-bump / contained-failure / batch-cap / null-text / read-error). |
| AC-4: classify-on-ingest wired into the existing cron; no new cron/ledger/source-CHECK | Pass | `/api/cron/gbp-reviews-sync` calls `classifyPendingSentiment(service)` after `syncGbpReviews`, CONTAINED (a classify throw → `{ error }`, the ingest result still returns); first post-deploy run sweeps pre-existing rows (the one-shot backfill). vercel.json STILL 10 crons (no new cron); on-demand /api/reviews/ingest NOT wired (swept by the next cron); no `/api/cron/review-sentiment`; no ledger row; no source-CHECK widen. Cron-route tests extended (sentiment field + contained-failure). |
| AC-5: build-local, no surface, no new dependency, ZERO prod | Pass | No report block / dashboard panel (data inert until the 14-03b/gate-batch follow-up); package.json untouched (AI SDK + zod + resilience already ship); report/narrative.ts + responder.ts + safety.ts + prompts.ts + the 14-01 ingest core + review_items unchanged; live gateway-Haiku round-trip deferred to the Phase-14 gate batch; nothing applied to prod. |

Skill audit: All required flows invoked ✓ (SPECIAL-FLOWS research-first: 14-RESEARCH.md present, ultracode wf_4ac2ec22-54d; §LLM sentiment design settled the schema/model-id/hardening/storage/eval-gate/trigger; per-plan check — no new external API surface, the AI SDK v6 generateText+Output.object path already ships in report/narrative.ts).

## Accomplishments

- review_sentiment can hold one schema-validated classification per review, RLS-clamped, dirty-checked by both prompt_version and the edited-review `updated_at` key so an edited+re-ingested review re-classifies.
- The classifier is built + unit-proven against the mocked gateway structured-output seam: injection-hardened (the untrusted-input clause rides as data, never a command), schema-gated (off-taxonomy value rejected), resilient (shared CircuitBreaker + withRetry).
- Sentiment classification rides the existing gbp-reviews-sync cron (classify-on-ingest) with contained per-row failure and a batch cap that drains the backfill over runs — no new cron, no ledger, no migration beyond the table.
- Closes the Phase-14 build delta set: per-review v4 ingest (14-01) → reply publish-to-Google plumbing (14-02) → LLM sentiment (14-03). All build-local, ZERO prod.

## Task Commits

Committed as ONE phase commit at the Phase-14 transition (the Phase-13 per-plan convention: 14-01/14-02 were uncommitted phase-boundary work; the transition lands 14-01+14-02+14-03 together).

| Task | Type | Description |
|------|------|-------------|
| Task 1: migration | feat | review_sentiment sibling table + RLS (4 shop_id-clamped policies) + UNIQUE + polarity CHECK |
| Task 2: classifier | feat | sentiment-prompt.ts (schema + taxonomy + copied hardening) + sentiment.ts (Haiku Output.object, deps-injected) + 14 tests |
| Task 3: orchestrator + cron wire | feat | review-sentiment-sync.ts classifyPendingSentiment + classify-on-ingest into gbp-reviews-sync + 8 + extended-route tests |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260617120000_review_sentiment.sql` | Created | NEW review_sentiment table + RLS + UNIQUE + polarity CHECK + per-shop index |
| `src/lib/reviews/sentiment-prompt.ts` | Created | Non-server-only: sentimentSchema (verbatim) + taxonomy system prompt + copied untrusted-input clause |
| `src/lib/reviews/__tests__/sentiment-prompt.test.ts` | Created | 9 tests (schema accept/reject, prompt hardening + taxonomy, golden-set seed, version) |
| `src/lib/reviews/sentiment.ts` | Created | `classifyReviewSentiment` + `gatewayClassify` (Output.object) + exported `sentimentBreaker`; node-testable |
| `src/lib/reviews/__tests__/sentiment.test.ts` | Created | 5 tests (model+prompt wiring, injection-resistance, logCall success/error, model override) |
| `src/lib/reviews/review-sentiment-sync.ts` | Created | `classifyPendingSentiment` orchestrator (dirty-key select, contained per-row, upsert, logLLMCall) |
| `src/lib/reviews/__tests__/review-sentiment-sync.test.ts` | Created | 8 tests (classify, idempotent skip, edited/prompt-bump re-classify, contained failure, batch cap, null-text, read-error) |
| `src/app/api/cron/gbp-reviews-sync/route.ts` | Modified | Calls classifyPendingSentiment after ingest (contained); response gains a `sentiment` field |
| `src/app/api/cron/gbp-reviews-sync/__tests__/route.test.ts` | Modified | Mocks classifyPendingSentiment; asserts the sentiment field + contained-failure |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Eval gate = the zod enum schema only (NO groundedness cascade) | Sentiment emits labels, not published numbers; a mislabel is recoverable (14-RESEARCH) | The Output.object schema rejects off-taxonomy values; no F1/F2/F3 port from the report |
| Denormalize shop_id on review_sentiment | Direct `shop_id IN user_shop_ids()` clamp (review_items idiom) is simpler + per-shop indexable | RLS mirrors the live review_items policies, not the nested review_responses subquery |
| NO ledger / NO source-CHECK widen | A classification acts per-row; the per-row columns + free-text llm_call_log.purpose are the audit | Zero migration beyond the table; deliberate deviation from 14-01's ingest ledger |
| Classify rides the gbp-reviews-sync cron (no new cron); first run = backfill | 14-RESEARCH classify-on-ingest decision; the on-demand route's rows are swept by the next cron | One trigger, contained; no over-wiring of the /api/reviews/ingest path |
| Export sentimentBreaker | The module-singleton CircuitBreaker leaks accumulated failures across tests | Tests `reset()` it in beforeEach — order-independent suite |
| NO sentiment surface in 14-03 | Build-local rhythm (14-01/14-02); the data is inert until activation | Surface + human-review queue deferred to 14-03b / the gate batch |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 1 | `export sentimentBreaker` (test-isolation hook) — trivial, no scope creep |
| Deferred | 0 | (all deferrals were planned, not discovered) |

**Total impact:** Plan executed as written. The one addition (`export sentimentBreaker`) is a test-isolation affordance the plan implied (the module-singleton breaker mirrors narrative.ts) — exported so the orchestrator suite resets it between cases.

### Auto-fixed Issues

None — no defects surfaced during execution.

### Deferred Items

Named follow-up — **14-03b / Phase-14 gate batch** (recorded, not built in 14-03):
- The report/dashboard sentiment surface (panel + monthly report section).
- The human-review / low-confidence spot-check queue UI + a CI golden-set regression gate (a 4-fixture seed test ships now).
- The live gateway-Haiku round-trip (the slug resolves + Output.object validates against a real Haiku response) — the Phase-14 gate batch, sharing Phase-13 Gate A/B.
- Prompt caching of the taxonomy system prompt (fleet-scale cost optimization; named ceiling in `sentiment.ts`).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| The shared module-singleton CircuitBreaker would leak accumulated failures across the orchestrator's test cases | Exported `sentimentBreaker` and `reset()` it in the suite's `beforeEach` (the breaker counts one failure per `execute`, so a single failing case stays below the threshold-3 anyway, but reset makes the suite order-independent) |
| The cron route response shape changed (gained `sentiment`), breaking the existing route test's exact-equality assertion | Updated the route test: mocked `classifyPendingSentiment`, asserted the merged `sentiment` field + added a contained-failure case |

## Next Phase Readiness

**Ready:**
- The full sentiment pipeline (table + classifier + classify-on-ingest) is built + unit-proven; 14-03b can layer the surface + human-review queue on top, and the gate batch can run the live smoke.
- Phase 14 is the LAST phase of v0.3.5 — milestone v0.3.5 is now 2 of 2 phases built (both build-local / activation-pending on the shared Phase-13/14 Gate A/B).

**Concerns:**
- Live gateway behavior (the `anthropic/claude-haiku-4.5` slug resolves through the AI Gateway; `Output.object` validates a real Haiku response against the zod schema) is unvalidated until the Phase-14 gate batch — the same blind-built risk the research gate guards against, mitigated by the deps-injected mock tests + the deferred live smoke.
- Sentiment data is inert until the 14-03b surface ships — there is no customer-visible sentiment yet (by design).

**Blockers:**
- None for build. Live activation is gated on the shared Phase-13/14 Gate A (GBP API 300 QPM) + Gate B (business.manage verification) + the live smokes, per 14-RESEARCH.

---
*Phase: 14-reviews-sentiment, Plan: 03*
*Completed: 2026-06-17*
