---
phase: 15-billing-foundation
plan: 01
subsystem: payments
tags: [stripe, webhook, idempotency, basil, rls, supabase, resilience, circuit-breaker]

requires:
  - phase: 03-integrations
    provides: resilience.ts (withRetry + CircuitBreaker), the email/sms event-idempotency precedent
  - phase: 07-tier-gating-shop-switcher
    provides: src/lib/tier/gate.ts (reads subscriptions.tier — the reconcile target)
provides:
  - stripe_webhook_events idempotency/audit table (default-deny RLS)
  - hardened webhooks/stripe/route.ts (idempotency gate + S3 upsert + Basil fix + resilience)
  - retrieveSubscription + defaultStripeBreaker in src/lib/stripe.ts
  - subscription tier reconciled to a 3-value single source of truth
affects: [15-02 (extends this webhook switch + reuses the idempotency gate), 16-subscription-self-serve, 18-launch-readiness]

tech-stack:
  added: []
  patterns:
    - "Webhook idempotency: ON CONFLICT DO NOTHING record + processed_at-gated skip (retry-safe)"
    - "Outbound Stripe calls via module-level defaultStripeBreaker.execute(() => withRetry(...))"

key-files:
  created:
    - supabase/migrations/20260618000000_stripe_webhook_events.sql
    - supabase/migrations/20260618000500_reconcile_subscription_tier.sql
    - src/app/api/webhooks/stripe/__tests__/route.test.ts
  modified:
    - src/app/api/webhooks/stripe/route.ts
    - src/lib/stripe.ts

key-decisions:
  - "Idempotency skip gates on processed_at, not the literal empty-RETURNING — retry-safe against mid-processing failure"
  - "Subscription upsert onConflict=shop_id (not stripe_subscription_id) — shop_id UNIQUE + 1 shop:1 sub MoR model"
  - "subscription.updated re-fetches the canonical subscription (out-of-order safe) rather than trusting the embedded snapshot"

patterns-established:
  - "Migrations authored-not-applied; prod apply is the Phase-15 gate batch under PROTOCOL"
  - "billing/* stays out of the v0.2 per-file coverage include set (mirrors google-ads/mail/sms)"

duration: ~35min
started: 2026-06-18T13:50:00Z
completed: 2026-06-18T14:25:00Z
---

# Phase 15 Plan 01: Billing foundation — webhook spine Summary

**Hardened the inherited Stripe webhook into an idempotent, Basil-correct, resilience-wrapped spine and reconciled the subscription tier to a single 3-value source of truth — build-local, ZERO prod contact, no new runtime dependency.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min |
| Started | 2026-06-18T13:50:00Z |
| Completed | 2026-06-18T14:25:00Z |
| Tasks | 3 completed |
| Files modified | 5 (3 created, 2 modified) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Event idempotency gate | Pass | `stripe_webhook_events` (event_id PK, RLS-on default-deny) + ON CONFLICT DO NOTHING record; duplicate-and-processed → 200, zero side effects. Test: "skips an already-processed duplicate event". Refinement: skip gated on `processed_at` so a recorded-but-failed event reprocesses on retry (test: "reprocesses an event recorded but not yet processed"). |
| AC-2: S3 subscription upsert | Pass | `.insert()` → `.upsert(onConflict:shop_id)` + error check; a write error surfaces as 500 (not swallowed). Tests: "upserts the subscription on checkout.session.completed", "surfaces a subscription write error as 500". |
| AC-3: Basil current_period_end | Pass | Reads `fresh.items.data[0].current_period_end` from a re-fetched subscription; typecheck confirms the field is item-level (the old sub-level read was the latent bug). Test: "reads the Basil item-level current_period_end". |
| AC-4: Resilience + tier reconcile | Pass | `retrieveSubscription` wraps `subscriptions.retrieve` in `withRetry` + `defaultStripeBreaker`. psql: `shops.subscription_tier` dropped; `subscriptions_tier_check` = 3 values; `multi_location` rejected. |

## Verification Results

- `pnpm typecheck` → 0 errors (the Basil item-level field path typechecks on the SDK type)
- `pnpm lint` → 0 errors (7 pre-existing warnings in unrelated files)
- `pnpm test` → 96 files / **755 tests pass** (+7 new webhook tests)
- `pnpm build` → ✓ (no new runtime dependency)
- `supabase db reset` (LOCAL) → both new migrations apply clean
- psql structural verify:
  - `stripe_webhook_events`: relrowsecurity=t, PK `stripe_webhook_events_pkey`
  - `shops.subscription_tier`: absent (col_present=0)
  - `subscriptions_tier_check`: `CHECK (tier = ANY (ARRAY['essentials','growth','performance']))`
  - `multi_location` INSERT rejected by the tier CHECK; `growth` passed the tier CHECK (reached the FK stage)

## Accomplishments

- Stripe webhook is now idempotent against at-least-once redelivery AND retry-safe against mid-processing failure (no silent drop of subscription state on a money path).
- Closed the S3 duplicate-key-swallow defect (route.ts:56) and the latent Basil `current_period_end` defect (route.ts:71) in one pass.
- Single tier source of truth: `subscriptions.tier` (3 values); removed the vestigial `shops.subscription_tier` and the `multi_location` DB/TS mismatch.

## Task Commits

Not committed. Per the project's build-local → phase-close convention (Phases 9-14), the Phase-15 `.paul` + code changes commit at the phase transition, after the remaining Phase-15 build-local plans (15-02, 15-03) close. No git ops run in this plan.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260618000000_stripe_webhook_events.sql` | Created | Inbound webhook idempotency + audit table (default-deny RLS) |
| `supabase/migrations/20260618000500_reconcile_subscription_tier.sql` | Created | Drop vestigial `shops.subscription_tier`; tighten tier CHECK to 3 values |
| `src/app/api/webhooks/stripe/route.ts` | Modified | Idempotency gate + S3 upsert + Basil fix + resilience-wrapped retrieve; service-client helper |
| `src/lib/stripe.ts` | Modified | `defaultStripeBreaker` + `retrieveSubscription` helper |
| `src/app/api/webhooks/stripe/__tests__/route.test.ts` | Created | 7 tests (suite did not previously exist) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Idempotency skip gates on `processed_at`, not empty-RETURNING alone | supabase-js autocommits each call; record-then-fail would leave the event marked-seen but unprocessed, and Stripe's retry would dedupe it away (silent data loss) | Robust webhook; 15-02's new handlers inherit the same gate |
| Subscription upsert `onConflict: shop_id` (refines research §1.2's `stripe_subscription_id`) | `shop_id` is UNIQUE and the MoR model is one shop ↔ one subscription, so the shop's single row must update in place | A re-subscribe / tier change updates rather than raising duplicate-key |
| `subscription.updated` re-fetches via `retrieveSubscription` | Events arrive out-of-order; the embedded snapshot is stale-prone (research §3); also satisfies the AC-4 outbound-resilience requirement | One extra API call per subscription.updated, wrapped in retry + breaker |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 1 | Minimal — added `runtime`/`dynamic` route exports + switched the inline service client to `createServiceClient()` |
| Deferred | 0 | — |

**Total impact:** Two research-refinements (processed_at gate, onConflict=shop_id) made the spine more correct than the literal research prescription; both recorded above. No scope creep.

### Scope additions

**1. Route hygiene aligned to research §3 + codebase convention**
- **Found during:** Task 2
- **Change:** Added `export const runtime = "nodejs"` + `dynamic = "force-dynamic"` (research §3 raw-body guidance) and replaced the inline `createClient(url, key)` with the shared `createServiceClient()` helper.
- **Files:** `src/app/api/webhooks/stripe/route.ts`
- **Verification:** typecheck + build + tests green.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `psql` not on PATH; `supabase status` DB-URL parse failed | Ran structural verify via `docker exec supabase_db_psg-hub psql` |

## Next Phase Readiness

**Ready:**
- 15-02 can extend the same webhook switch and reuse the `processed_at` idempotency gate + `stripe.ts` resilience helpers (its `depends_on: ["15-01"]` is now satisfied).
- 15-03 (PII-at-rest infra) is independent (Wave 1) and can apply in parallel.

**Concerns:**
- The tier-reconcile migration tightens a CHECK; the Phase-15 gate batch MUST pre-check `subscriptions WHERE tier='multi_location'` = 0 on prod before applying (noted in the migration header). The migration does not auto-mutate data.
- `shops.stripe_customer_id` is `NOT NULL` in the live schema — relevant to 15-02's invoice→shop resolution; flag for that plan.

**Blockers:** None.

---
*Phase: 15-billing-foundation, Plan: 01*
*Completed: 2026-06-18*
