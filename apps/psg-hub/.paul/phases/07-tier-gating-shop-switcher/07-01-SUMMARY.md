---
phase: 07-tier-gating-shop-switcher
plan: 01
subsystem: auth
tags: [onboarding, shop_users, clients, service-role, rls-bootstrap, self-serve]

requires:
  - phase: 06-rbac-rls-spine
    provides: shop_users membership model + RLS spine + dashboard gate (06-03)
provides:
  - Self-serve onboarding — service-role POST /api/onboarding bootstraps client + shop + first-owner + customer role
  - Dashboard gate routes no-shop non-staff to the onboarding wizard (was a dead-end notice)
affects: [07-03-shop-switcher, 07-02-tier-gating, v0.4-billing]

tech-stack:
  added: []
  patterns: [service-role bootstrap route with compensating cleanup ladder; gate renders self-serve onboarding for no-shop users]

key-files:
  created:
    - src/app/api/onboarding/route.ts
    - src/components/dashboard/onboarding-screen.tsx
    - src/app/api/onboarding/__tests__/route.test.ts
  modified:
    - src/components/dashboard/onboarding-wizard.tsx
    - src/app/dashboard/layout.tsx

key-decisions:
  - "Self-serve onboarding: gate renders the wizard for no-shop non-staff (vs PSG-assigned NoShopNotice)"
  - "Onboarding creates a clients row first (shops.client_id is NOT NULL FK -> clients)"
  - "First-owner bootstrap runs via service-role (RLS with_check blocks it under user-session)"

patterns-established:
  - "Bootstrap routes do privileged writes via service-role with a compensating-delete ladder on partial failure"

duration: ~70min
started: 2026-06-03T11:00:00Z
completed: 2026-06-03T11:45:00Z
---

# Phase 7 Plan 01: Onboarding bootstrap Summary

**Made psg-hub self-serve onboardable: a no-shop user now lands on the onboarding wizard (the dashboard gate routes them there) and a service-role `POST /api/onboarding` bootstraps client → shop → first-owner `shop_users` → customer role — closing the Phase-6 chicken-and-egg where the first owner could not be created from the browser.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~70 min |
| Tasks | 3 auto + 1 human-verify |
| Files | 3 created, 2 modified |
| Prod writes | 1 real onboarding (Tracy's Body Shop, operator account) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Service-role route creates full owner bootstrap | Pass | client → shop(real cols + client_id) → shop_users owner → app_user_roles customer; verified live (operator onboarded a shop) |
| AC-2: Auth + validation + atomicity | Pass | 401 unauth, 400 empty name, user_id from session only, compensating cleanup (unit-tested both failure points) |
| AC-3: Wizard rewired, no browser privileged writes | Pass | wizard POSTs the route; zero browser shops/shop_users inserts; no-shop user reaches the wizard and lands on a working dashboard |
| AC-4: Gates green, scope held | Pass | typecheck clean · lint 0 err · 194 tests · build green; no tier/switcher logic, no DDL |

## Accomplishments

- Self-serve onboarding works end-to-end on prod (operator onboarded Tracy's Body Shop from a previously no-shop account).
- The Phase-6 carry-in is closed: the spine is now onboardable without manual SQL.
- Reconciled two live-schema realities the inherited wizard ignored: `shops` real columns (no website_url/phone/city/state) and the NOT NULL `shops.client_id` FK → `clients`.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/app/api/onboarding/route.ts` | Created | Service-role bootstrap: client → shop → owner → customer role, compensating cleanup |
| `src/components/dashboard/onboarding-screen.tsx` | Created | Focused self-serve onboarding screen (wizard + sign-out) rendered by the gate |
| `src/app/api/onboarding/__tests__/route.test.ts` | Created | 6 cases incl. both compensating-delete paths |
| `src/components/dashboard/onboarding-wizard.tsx` | Modified | POST the route; removed dead browser inserts + unused imports |
| `src/app/dashboard/layout.tsx` | Modified | No-shop non-staff → OnboardingScreen (was NoShopNotice) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Self-serve onboarding entry (gate → wizard) | Wizard was unreachable under the gate; inherited code contradicted itself (NoShopNotice PSG-assigned vs self-serve wizard); operator chose self-serve | No-shop users self-onboard; NoShopNotice orphaned |
| Create a `clients` row during onboarding | `shops.client_id` is NOT NULL FK → clients; self-serve has no client yet | 1 client per first onboarding (client↔shop) |
| Service-role for the privileged writes | `shop_users` INSERT with_check blocks first-owner under user-session | Bootstrap possible; auth still validated via session |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Operator decision (scope-add) | 1 | Self-serve gate routing (DEVIATION 1) — wizard made reachable |
| Auto-fixed (schema divergence) | 1 | clients-first ladder (DEVIATION 2) — unblocked the 500 |

**1. Self-serve onboarding entry (DEVIATION 1):** Found pre-checkpoint that `/dashboard/onboarding` was gated unreachable for no-shop users. Operator chose self-serve; gate now renders `OnboardingScreen`. Added `onboarding-screen.tsx` + edited `layout.tsx` (no-shop branch). NoShopNotice left orphaned (revivable if a PSG-assigned model returns).

**2. shops.client_id NOT NULL (DEVIATION 2):** First live attempt 500'd (`null value in column "client_id"`). Live `shops.client_id` is NOT NULL, FK → `clients.id`. Fixed by creating a `clients` row first. Re-tested + redeployed.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Wizard unreachable under gate | Operator chose self-serve; gate renders OnboardingScreen |
| `client_id` NOT NULL 500 at human-verify | Route creates `clients` row first (clients requires only `name`) |

## Next Phase Readiness

**Ready:**
- Shops can now be created self-serve → 07-03 shop switcher has shops to switch between.
- 07-02 tier-gate helper unaffected (independent).

**Concerns:**
- `clients` is created per onboarding with minimal fields (name/website_url/created_by); richer client setup (market/zip/competitors) deferred to its own flow.
- Onboarding has no automated E2E (route is unit-tested; the gate→wizard→dashboard flow is covered by the live human-verify only) → Playwright candidate in Phase 8.
- v0.4 billing carry-forward still stands (shops has no stripe_customer_id).

**Blockers:** None.

---
*Phase: 07-tier-gating-shop-switcher, Plan: 01*
*Completed: 2026-06-03*
