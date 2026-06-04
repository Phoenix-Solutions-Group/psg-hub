---
phase: 07-tier-gating-shop-switcher
plan: 02
subsystem: auth
tags: [tier-gating, subscriptions, stripe-enum, rbac, service-role, refactor]

requires:
  - phase: 06-rbac-rls-spine
    provides: shop_users membership + dashboard gate (06-03) + service-client read pattern
provides:
  - Reusable ranked tier-gate helper (src/lib/tier/gate.ts) — TIER_RANK / tierMeets / getShopTier / shopHasTier / assertShopTier
  - assertAdsTier migrated to delegate (behavior-preserving); ads page tier check on the shared helper
  - Single source for the SHOP_ADS_TIER_OVERRIDE allowlist
affects: [07-03-shop-switcher, v0.3-analytics, v0.4-billing]

tech-stack:
  added: []
  patterns: [ranked-tier gate (essentials<growth<performance) resolved via service-client; assert-with-error-factory so callers map failures to their own error type]

key-files:
  created:
    - src/lib/tier/gate.ts
    - src/lib/tier/__tests__/gate.test.ts
  modified:
    - src/lib/google-ads/tier.ts
    - src/app/dashboard/ads/page.tsx

key-decisions:
  - "Keep SHOP_ADS_TIER_OVERRIDE env name (no operator-config break); semantics broaden to top-tier bypass for any gate"
  - "Gate standardizes on the service client; outcome-equal to the prior user-client read for membership-verified shops"
  - "Keep .maybeSingle() — duplicate-subscription (S3) hardening stays a v0.4 billing concern, not papered over at the read site"

patterns-established:
  - "Tier gating: shopHasTier(shopId, min) for UI/pages; assertShopTier(shopId, min, makeError?) for routes that map failures to a typed error"

duration: ~25min
started: 2026-06-03T11:58:00Z
completed: 2026-06-03T12:05:00Z
---

# Phase 7 Plan 02: Tier-gate helper Summary

**Extracted a reusable ranked tier gate (`essentials < growth < performance`) from the ads-only `assertAdsTier` into `src/lib/tier/gate.ts`, then migrated both existing ads consumers onto it with no change in gate outcome — the shared mechanism v0.3 analytics and later customer features will gate on.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~25 min |
| Tasks | 3 auto (no checkpoints) |
| Files | 2 created, 2 modified |
| Prod writes | 0 (code-only) |
| Tests | 211 pass (+17) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Ranked tier mechanism correct | Pass | TIER_RANK + tierMeets; null/unknown current never meets; rank matrix unit-tested |
| AC-2: Override bypass at any minimum | Pass | overridden shop passes at min=performance and lower, even with no/inactive sub; override reader centralized to gate.ts |
| AC-3: Subscription gating matches today | Pass | active + rank>=min passes; missing/inactive/lower-rank fails (boolean + throw paths tested) |
| AC-4: Two ads consumers outcome-equivalent | Pass | assertAdsTier delegates, throws `AdsApiError("tier_required","Performance tier required for Google Ads")` byte-identical, 5 call sites untouched; ads page renders `<TierGateCard/>` for non-tiered; existing google-ads/tier.test.ts green under delegate |
| AC-5: Gates green, scope held | Pass | typecheck clean · lint 0 err (1 pre-existing warn) · 211 tests · build green; no migration/dep/env; no new gated surface |

## Accomplishments

- Shared `src/lib/tier/gate.ts` exporting `TIER_RANK`, `tierMeets`, `getShopTier`, `shopHasTier`, `assertShopTier` — the gate mechanism the rest of v0.2/v0.3 reuses.
- Eliminated the duplicated `SHOP_ADS_TIER_OVERRIDE` reader (was copied in `tier.ts` + ads `page.tsx`); now one definition.
- `assertAdsTier` reduced to a thin delegate that preserves its two preflight error codes and the exact `tier_required` message, so the 5 ads routes need no change.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/tier/gate.ts` | Created | Ranked tier resolver + gate helpers + centralized override reader (service-client) |
| `src/lib/tier/__tests__/gate.test.ts` | Created | 17 tests: rank matrix, override bypass, status/missing cases, factory-error |
| `src/lib/google-ads/tier.ts` | Modified | `assertAdsTier` → preflight + delegate to `shopHasTier(...,"performance")`; removed local override + inline sub read |
| `src/app/dashboard/ads/page.tsx` | Modified | Inline gate → `shopHasTier(shopId,"performance")`; removed local override fn + user-client sub read; kept service read for shop name |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Keep `SHOP_ADS_TIER_OVERRIDE` env name | Renaming breaks operator config | Override now means "treat shop as top tier for ANY gate" (broadened scope, by design) |
| Standardize gate on the service client | Gating must not depend on a caller's RLS visibility | Ads page sub read moved user→service; outcome-equal for membership-verified shops (`subscriptions_select = shop_id IN user_shop_ids()`, membership verified upstream by 06-03) |
| Keep `.maybeSingle()` | Behavior-preserving; duplicate-row root cause (S3 Stripe INSERT-not-UPSERT) is owned by v0.4 billing | No read-site hardening; risk unchanged from today |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 0 | — |

**Total impact:** None — plan executed exactly as written.

### Deferred Items

None.

## Issues Encountered

None.

## Next Phase Readiness

**Ready:**
- 07-03 shop switcher and v0.3 analytics can gate features with `shopHasTier` / `assertShopTier` — no per-surface gate re-implementation.
- `getShopTier` is exported as a shared resolver (billing UI is a plausible near-term consumer).

**Concerns:**
- The ads `page.tsx` tier guard still has no automated render/unit test (gate logic is now unit-tested in `gate.ts`, but the page wiring is covered only by build + the inherited live check) — Playwright/render-test candidate in Phase 8 (carry-forward from 06-05).
- `.maybeSingle()` on `subscriptions` can throw if S3 produces duplicate rows — v0.4 billing owns the fix.

**Blockers:** None.

---
*Phase: 07-tier-gating-shop-switcher, Plan: 02*
*Completed: 2026-06-03*
