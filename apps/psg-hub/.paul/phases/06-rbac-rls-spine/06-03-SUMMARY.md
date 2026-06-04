---
phase: 06-rbac-rls-spine
plan: 03
subsystem: auth
tags: [rbac, nextjs, middleware, dashboard, supabase, service-role, gate]

# Dependency graph
requires:
  - phase: 06-rbac-rls-spine (06-02)
    provides: app_user_roles + shop_users (RLS-on default-deny), role model
provides:
  - getDashboardAccess() server-side role+shop resolver (service-role)
  - customer-id gate in the dashboard layout (staff bypass / member pass / no-shop notice)
  - decideDashboardAccess() pure decision (reused by 06-04/06-05 + Phase 7)
affects: [06-04-reviews-reconcile, 06-05-ads-surface, 07-tier-gating-shop-switcher]

# Tech tracking
tech-stack:
  added: []
  patterns: [server-side requireShop gate in the route-group layout (NOT middleware), service-role role+shop lookup, pure-decision-function for testable gating]

key-files:
  created:
    - apps/psg-hub/src/lib/auth/shop-access.ts
    - apps/psg-hub/src/components/dashboard/no-shop-notice.tsx
    - apps/psg-hub/src/lib/auth/__tests__/shop-access.test.ts
  modified: [apps/psg-hub/src/app/dashboard/layout.tsx]

key-decisions:
  - "Gate lives in dashboard/layout.tsx (server component), not middleware — avoids per-request service-role lookup on the broad matcher"
  - "Resolver uses service-role (app_user_roles/shop_users are default-deny; private.* resolvers aren't PostgREST-exposed)"
  - "Seed DEFERRED — no real customer auth user exists; real-customer membership → 06-04/Phase 7"

patterns-established:
  - "decideDashboardAccess({role,shopIds}) pure function = single source of gate truth, unit-tested"
  - "Staff (psg_internal/psg_superadmin) are shop-independent; customers require a shop_users membership"

# Metrics
duration: ~30min
started: 2026-06-02T17:35:00Z
completed: 2026-06-02T18:05:00Z
---

# Phase 6 Plan 03: Customer-ID Gate (Spine Enforcement) Summary

**Added a server-side customer-id gate to the dashboard layout — staff bypass, customers require a shop_users membership, no-shop users get a branded notice — backed by a service-role role+shop resolver and a pure, unit-tested decision function. Code-only, zero prod write; the membership seed was deferred because no real customer auth user exists yet.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~30 min |
| Started | 2026-06-02T17:35:00Z |
| Completed | 2026-06-02T18:05:00Z |
| Tasks | 4 (3 auto + 1 checkpoint) |
| Files modified | 4 (3 created, 1 modified) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Shared role+shop resolver | Pass | `getDashboardAccess(userId)` → `{role, shopIds}` via `createServiceClient()` (RLS-bypass); server-only; reads app_user_roles + shop_users directly (private.* not PostgREST-exposed). |
| AC-2: Customer-id gate in dashboard layout | Pass | layout.tsx: staff bypass / customer+shop pass / customer-none+no-shop → `<NoShopNotice/>` / unauth → /login. typecheck clean, lint 0 errors, 188 tests (+6 branch tests). Live-verified vs all 3 real users. |
| AC-3: One real shop_users membership seeded | **Deferred (operator)** | No real customer auth user exists (pool = Nick/Tina psg_superadmin + Claire null external; only Nick has a shop row). Operator chose to defer; gate proven without it. Real-customer seed → 06-04/Phase 7. No migration written; zero prod write. |

## Verification Results

- `pnpm typecheck` clean; `pnpm lint` 0 errors (1 pre-existing middleware warning); `pnpm test` 188 passed (20 files, +6).
- Live gate outcome (read-only, mirrors decideDashboardAccess): claire@static-solutions.com (null, 0 shops) → no-shop notice; nick@ (psg_superadmin, 1) → pass (staff); tina@ (psg_superadmin, 0) → pass (staff).

## Accomplishments

- Phase-6 spine is now ENFORCED in code: the dashboard gates on role + membership, with a no-redirect-loop no-shop interstitial.
- Single source of gate truth (`decideDashboardAccess`) — pure, unit-tested, reusable by 06-04/06-05 + Phase 7's shop switcher.
- Discovered + surfaced the real auth-pool state (no customer users yet) instead of seeding synthetic data.

## Task Commits

Not committed — operator commits at/after UNIFY (branch `chore/phase-3-integrations`).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/auth/shop-access.ts` | Created | getDashboardAccess (service-role) + decideDashboardAccess (pure) |
| `src/components/dashboard/no-shop-notice.tsx` | Created | No-shop interstitial (branded, sign-out) |
| `src/lib/auth/__tests__/shop-access.test.ts` | Created | 6 branch tests for the gate decision |
| `src/app/dashboard/layout.tsx` | Modified | Wire the gate after the auth check |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Gate in dashboard layout, not middleware | Broad middleware matcher → per-request service-role lookup + key in edge; the server-component layout is the right place | Lookup runs only on dashboard render |
| Service-role resolver (not RLS self-read policy) | app_user_roles is default-deny; adding a self-read policy was out of scope; service-role is server-only | No new RLS policy; default-deny preserved |
| Defer the membership seed | No real customer auth user exists to seed meaningfully | AC-3 deferred to 06-04/Phase 7; 06-03 stays zero-write |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 1 | AC-3 seed deferred (operator) — zero prod write |

**Total impact:** One AC deferred by operator decision; the gate (the plan's core) fully delivered + verified.

### Deferred Items

- **AC-3 shop_users seed** → 06-04 / Phase 7 (when a real customer is onboarded). No synthetic prod data added.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| No real customer auth user to seed | Surfaced at the checkpoint; operator deferred the seed; gate verified via existing users |

## Next Phase Readiness

**Ready:**
- Gate + resolver in place → 06-04 (reviews) can rely on `getDashboardAccess`/membership; Phase 7 shop-switcher consumes `shopIds`.

**Concerns:**
- **Gate not live until a prod deploy.** Code + tests + live-data verification are complete, but enforcement on hub.psgweb.me requires an operator `vercel --prod` (option-C posture). Until then the dashboard is auth-gated only (pre-06-03 behavior).
- **No customer users exist yet** — the customer-with-shop pass path is unexercised by a real user; 06-04 should seed/onboard one to fully exercise it.
- **Remaining `shop_members` (phantom) references** in ~14 files (ads/settings/agents/billing/content/onboarding/stripe) still error — addressed per-surface in 06-04 (reviews) / 06-05 (ads) and later.

**Blockers:** None.

---
*Phase: 06-rbac-rls-spine, Plan: 03*
*Completed: 2026-06-02*
