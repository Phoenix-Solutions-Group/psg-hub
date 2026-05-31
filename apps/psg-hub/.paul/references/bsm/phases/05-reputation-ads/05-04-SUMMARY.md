---
phase: 05-reputation-ads
plan: 04
subsystem: ads-ui
tags:
  - stripe-checkout
  - performance-tier
  - next-16
  - oauth-popup
  - post-message
  - polling-cleanup
  - accessibility
  - vitest

requires:
  - phase: 05-reputation-ads
    provides: 05-03 routes (authorize, callback, accounts, disconnect); billing_tier 'performance' enum value; shop columns
  - phase: 04-customer-facing-mvp
    provides: existing checkout route, Stripe webhook handler, pricing-card component, billing page, dashboard layout + sidebar, subscriptions table
provides:
  - Performance tier Stripe checkout path
  - Billing page updated with 3 tier cards + post-upgrade grace banner
  - /ads route w/ tier gate + multi-shop fallback + empty/table branches
  - Sidebar Ads link
  - link-account button w/ popup-blocker detection + snapshot-and-diff polling + useEffect cleanup + postMessage forward-compat
  - accounts-table w/ owner-gated Disconnect + inline error surface
  - view-state.ts pure helpers (selectAdsView + canLinkAccount + canDisconnect)
  - shouldShowUpgradeBanner pure helper
  - 13 new tests (93 total)
affects:
  - 05-05 (campaigns UI) — consumes the same ads page scaffold; plugs campaigns section below accounts table
  - Future tier-gated features — reuses assertAdsTier + SHOP_ADS_TIER_OVERRIDE pattern

tech-stack:
  added: []
  patterns:
    - "Post-upgrade grace state via client-side router.refresh() interval — mitigates async Stripe webhook latency without new endpoints"
    - "Popup-blocker safe OAuth UX: attempt popup → if null, render inline error + anchor fallback → keep user in flow"
    - "Snapshot-and-diff polling — capture existing state before opening popup so existing rows don't falsely signal success"
    - "Pure view-state function drives UI branching — testable without DOM"
    - "Multi-shop fallback: prefer owner-role membership, canonical /ads?shop_id=X URL"

key-files:
  created:
    - dashboard/src/app/(dashboard)/billing/upgrade-banner.tsx
    - dashboard/src/app/(dashboard)/ads/layout.tsx
    - dashboard/src/app/(dashboard)/ads/page.tsx
    - dashboard/src/app/(dashboard)/ads/tier-gate-card.tsx
    - dashboard/src/app/(dashboard)/ads/link-account-button.tsx
    - dashboard/src/app/(dashboard)/ads/accounts-table.tsx
    - dashboard/src/lib/ads/view-state.ts
    - dashboard/src/lib/ads/__tests__/view-state.test.ts
    - dashboard/src/app/(dashboard)/ads/__tests__/components.test.tsx
  modified:
    - dashboard/src/app/api/billing/checkout/route.ts
    - dashboard/src/app/(dashboard)/billing/page.tsx
    - dashboard/src/app/(dashboard)/layout.tsx
    - dashboard/.env.example
    - dashboard/vitest.config.ts

key-decisions:
  - "Post-upgrade grace implemented client-side via router.refresh() rather than a new /api/billing/subscription-status endpoint. Honors the 'no new API routes' boundary."
  - "Popup-blocker fallback shows inline 'open in new tab' anchor — simpler than a custom modal, universally supported."
  - "View-state branching extracted to a pure function (selectAdsView) — testable without jsdom + easier to reason about."
  - "TierGateCard uses <Link> styled as a button (not <button onClick={navigate}>) — lets browser handle middle-click, ctrl+click, and keyboard Enter naturally."
  - "React 19 purity rule pushed Date.now() into useEffect (startRef initialized inside the effect)."

patterns-established:
  - "Client poll + server-refresh for any eventually-consistent state (Stripe webhook, OAuth callback). 3-5s interval, hard timeout, useEffect cleanup."
  - "Role-gated controls: canX(role) helpers exported from view-state.ts; components call helpers rather than inlining comparisons."
  - "Canonical-URL redirect on ambiguous input (no shop_id → resolve + redirect). Avoids hidden state in server component."

duration: ~60min
started: 2026-04-19T18:20:00Z
completed: 2026-04-19T19:20:00Z
---

# Phase 5 Plan 04: Performance tier billing + Ads scaffold Summary

**Shop owners can now self-serve: upgrade to Performance via Stripe, return through the post-upgrade grace banner, land on /ads, and link their Google Ads account. Campaigns UI lands in 05-05. 9/9 post-audit ACs green, 93/93 tests pass, build + lint clean.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~60min |
| Started | 2026-04-19T18:20:00Z |
| Completed | 2026-04-19T19:20:00Z |
| Tasks | 5 of 5 completed |
| Files created | 9 |
| Files modified | 5 |
| Tests passing | 93 / 93 (13 new) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Performance tier in checkout w/ env guard | Pass | Env guard returns 500 w/ clear message; webhook verified to accept 'performance' |
| AC-2: Billing page 3 cards + anchor | Pass | Essentials/Growth/Performance all render; each wrapped w/ `id="<tier>"` for deep-link |
| AC-3: Sidebar Ads link + any-tier page loads | Pass | Link between Reviews and Agents; /ads renders for all states |
| AC-4: Tier-gate card | Pass | Non-Performance shows card; no accounts query fires; semantic Link button |
| AC-5: Link Google Ads (popup-safe) | Pass | Popup-blocker detection + anchor fallback; snapshot-and-diff polling; cleanup |
| AC-6: Accounts table + disconnect | Pass | Owner-only Disconnect; inline error; status badges |
| AC-7: Dashboard read patterns + multi-shop | Pass | Owner-preferred fallback; canonical URL redirect; tier short-circuits accounts query |
| AC-8: View-state helper tests | Pass | 6 selectAdsView scenarios + role-gating tests all pass |
| AC-9: Post-upgrade grace state | Pass | router.refresh every 5s up to 60s; banner transitions to timeout copy after window |

## Accomplishments

- Closed the self-serve upgrade → link path. PSG staff no longer need to manually set tier or walk shops through OAuth.
- Post-upgrade grace banner solves the Stripe-webhook-latency race that typically produces a confusing "still locked after paying" first impression.
- Popup-blocker fallback means first-time Safari users don't hit a dead button.
- Pure-function view-state extraction kept tests fast (no jsdom added).
- 13 new tests asserting specific edge cases (grace window boundaries, role permissions, tiered + zero-accounts state).

## Task Commits

Deferred to post-UNIFY commit. Planned:

| Scope | Type | Description |
|-------|------|-------------|
| dashboard/src/app/api/billing/checkout | feat | Performance tier + env guard |
| dashboard/src/app/(dashboard)/billing | feat | 3 tier cards + upgrade-banner |
| dashboard/src/app/(dashboard)/ads | feat | /ads scaffold + tier-gate + accounts UI |
| dashboard/src/lib/ads | feat | view-state helpers |
| dashboard/src/**tests** | test | view-state + grace-banner tests |
| dashboard | chore | vitest config + .env.example + sidebar link |
| .paul | docs | 05-04 PLAN + AUDIT + SUMMARY |

## Files Created/Modified

See frontmatter `key-files`. 9 created, 5 modified. Migration: none. New API routes: none.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Grace banner via router.refresh (not new status endpoint) | Keeps 'no new API routes' boundary | Trade small client overhead for simpler surface |
| Popup-blocker fallback shows anchor rather than custom modal | Universal, zero-dep | MVP-appropriate; custom modal can replace post-05-05 |
| Multi-shop fallback prefers owner membership | Owner is the link-account authority | Reduces confusion for multi-role users |
| Date.now() inside useEffect | React 19 purity rule enforcement | Avoids eslint 'react-hooks/purity' error |
| id="<tier>" wrapper on each pricing card | Enables /dashboard/billing#performance deep-link | Plain anchor, no routing change |
| vitest include extended to .tsx | One test imports from .tsx (pure-function path) | No testing-library/react added |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | React 19 purity rule on Date.now() — moved into useEffect |
| Scope additions | 1 | vitest.config.ts updated to include .tsx (plan implied this; explicit in execution) |
| Scope clarifications | 0 | — |
| Deferred | 4 | All carried from AUDIT: custom modal, analytics, multi-shop picker UI, toast library |

**Total impact:** Minimal. Purity fix was the only genuine correction; all other plan items executed as written.

### Auto-fixed Issues

**1. React 19 purity rule on Date.now()**
- `react-hooks/purity` lint error: initializing useRef with `Date.now()` at render time is impure.
- Fix: change `useRef<number>(Date.now())` → `useRef<number | null>(null)`, move `startRef.current = Date.now()` into the useEffect body.
- Verified: `npm run lint` clean, tests still pass.

### Deferred Items

Carried from AUDIT.md:
- Custom confirmation modal for disconnect (replaces window.confirm) — post-05-05 polish
- Conversion / analytics tracking — Phase 6
- Multi-shop picker UI in sidebar — future plan
- Toast / notification library — post-MVP

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| React 19 purity rule broke `useRef<number>(Date.now())` pattern | Moved Date.now() inside useEffect; startRef.current set on mount |
| vitest didn't pick up `.tsx` test files initially | Extended `include` glob to `.test.{ts,tsx}` |

## Skill Audit (05-04)

Per SPECIAL-FLOWS.md required skills for this plan:

| Expected | Invoked | Notes |
|----------|---------|-------|
| /uncodixfy | ✓ | TierGateCard + banners plain style; no glassmorphism, no pills, no decorative copy |
| /frontend-design | ✓ | Reused existing Table/Button/Badge primitives; sidebar + layout extensions match existing pattern |
| /humanizer | ✓ | Copy active voice (Upgrade, Link Google Ads, Disconnect); no em dashes, no cliches |
| /brand | ✓ | PSG tokens via existing oklch vars; primary color reserved for Link button + Approve-style CTA |

Status: **All 4 required skills invoked ✓**. Carry-over from session.

## Next Phase Readiness

**Ready:**
- 05-05 (campaigns UI): can plug a `<CampaignsSection>` below `<AccountsTable>` in /ads/page.tsx. Account selection state + tier check already in place.
- Any future tier-gated feature: reuse `assertAdsTier` pattern OR extend `view-state.ts` with a broader feature-flag helper.
- Post-upgrade grace banner pattern can be reused for any Stripe-backed flow w/ webhook latency.

**Concerns:**
- Runtime verify requires STRIPE_PERFORMANCE_PRICE_ID provisioned in Stripe dashboard (recurring $999/mo price). Not a code blocker but a launch blocker.
- Stripe webhook handler uses INSERT (not UPSERT) for subscription rows. If a user cancels and re-subscribes, a second row is created with the same `stripe_subscription_id`. Existing phase 4 behavior; flagged for ops.
- Multi-shop user who has memberships in shops with different tier states may find the default shop selection surprising. "Owner membership preferred" is documented but not surfaced in UI.

**Blockers for runtime verify:**
- STRIPE_PERFORMANCE_PRICE_ID (Stripe price for $999/mo recurring)
- At least one shop w/ active Performance subscription OR on SHOP_ADS_TIER_OVERRIDE allowlist
- All 05-03 blockers still apply (Google OAuth app, developer token, MCC, encryption keys)

---
*Phase: 05-reputation-ads, Plan: 04*
*Completed: 2026-04-19*
