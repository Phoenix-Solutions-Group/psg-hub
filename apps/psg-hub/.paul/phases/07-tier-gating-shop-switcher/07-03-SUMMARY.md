---
phase: 07-tier-gating-shop-switcher
plan: 03
subsystem: auth
tags: [shop-switcher, mso, multi-tenant, cookie, active-shop, rls, service-role]

requires:
  - phase: 06-rbac-rls-spine
    provides: shop_users membership + RLS clamp (user_shop_ids) + dashboard gate (06-03)
  - phase: 07-tier-gating-shop-switcher
    provides: onboardable shops (07-01 service-role /api/onboarding)
provides:
  - Active-shop cookie context (src/lib/shop/context.ts) — getUserShops / pure resolveActiveShop / getActiveShopContext + ACTIVE_SHOP_COOKIE
  - Membership-validated POST /api/shop/switch (cookie setter)
  - <ShopSwitcher> in the app shell (0 hidden / 1 label / 2+ dropdown)
  - settings / reviews / content scoped to the active shop
affects: [v0.3-analytics, phase-8-launch-hardening, ads-alignment-carry-forward]

tech-stack:
  added: []
  patterns: [active-shop cookie that SELECTS among authorized shops (never authorizes); resolver re-validates the cookie against current membership on every read; switch via API route, not server action]

key-files:
  created:
    - src/lib/shop/context.ts
    - src/lib/shop/__tests__/context.test.ts
    - src/app/api/shop/switch/route.ts
    - src/app/api/shop/switch/__tests__/route.test.ts
    - src/components/dashboard/shop-switcher.tsx
  modified:
    - src/app/dashboard/layout.tsx
    - src/app/dashboard/settings/page.tsx
    - src/app/dashboard/reviews/page.tsx
    - src/app/dashboard/content/page.tsx

key-decisions:
  - "Cookie selects among already-authorized shops; never authorizes — resolveActiveShop re-validates vs current membership every read; RLS + .eq(shop_id) backstop"
  - "Switch is an API route (POST /api/shop/switch), matching the codebase convention (no server actions); cookie httpOnly/Secure/SameSite=Lax"
  - "Switcher governs page/navigation context only; API authz routes keep explicit shop_id params"
  - "Ads alignment deferred (its ?shop_id= + owner-first + tier gate too big for the phase close)"

patterns-established:
  - "getActiveShopContext(userId) is the single shop-scope source for customer pages; pass activeShopId into .eq(shop_id) filters"
  - "Client switcher receives shops + activeShopId as props and never reads the cookie"

duration: ~75min
started: 2026-06-03T12:10:00Z
completed: 2026-06-03T12:45:00Z
---

# Phase 7 Plan 03: Shop switcher Summary

**Added a unified active-shop context (a membership-validated `psg_active_shop` cookie) and an MSO shop switcher in the app shell, and pointed Settings/Reviews/Content at the active shop — so a multi-shop user focuses the dashboard on one shop instead of seeing an arbitrary `.limit(1)` shop or every shop mixed. The cookie only SELECTS among already-authorized shops; RLS + membership remain the authority.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~75 min |
| Tasks | 3 auto + 1 human-verify |
| Files | 5 created, 4 modified |
| Tests | 221 pass (+10: 6 context, 4 route) |
| Prod writes (code) | 0 |
| Prod writes (test data) | 1 temp membership added + removed (operator-directed) |
| Deploy | dpl psg-aloatt9m2 → psg-o44ue3bia (after the reviews fix), hub.psgweb.me |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: cookie re-validated vs membership | Pass | pure resolveActiveShop: cookie wins only if a current member shop; else owner-first; else first; else null. Stale-cookie fallback unit-tested |
| AC-2: switch route validates membership | Pass | 401 / 400 / 403 (non-member, no Set-Cookie) / 200 + httpOnly+Secure+SameSite=Lax+Path=/ cookie. 4 route tests |
| AC-3: switcher renders by count | Pass | 0→null, 1→static label, 2+→dropdown; client gets props, never reads cookie. Verified live (single-shop label + 2-shop dropdown) |
| AC-4: pages render the active shop | Pass | settings drops .limit(1) → active shop; reviews + content .eq("shop_id", activeShopId); switching changes all three (live-verified) |
| AC-5: gates green, scope held | Pass | typecheck clean · lint 0 err (1 pre-existing warn) · 221 tests · build green; no migration/dep; gate + ads + authz routes untouched |

## Accomplishments

- Shipped a real MSO switcher end-to-end: cookie context + validated switch route + shell control + per-page scoping, LIVE on hub.psgweb.me.
- Established `getActiveShopContext(userId)` as the single shop-scope source for customer pages.
- Closed the "settings shows an arbitrary shop / reviews+content mix all shops" inconsistency.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/shop/context.ts` | Created | Active-shop cookie context + pure membership-revalidating resolver |
| `src/lib/shop/__tests__/context.test.ts` | Created | 6 tests for resolveActiveShop incl. stale-cookie fallback |
| `src/app/api/shop/switch/route.ts` | Created | Membership-validated cookie setter (401/400/403/200) |
| `src/app/api/shop/switch/__tests__/route.test.ts` | Created | 4 route tests incl. non-member 403 (no cookie) + 200 cookie attrs |
| `src/components/dashboard/shop-switcher.tsx` | Created | Client switcher (0 hidden / 1 label / 2+ dropdown), props-only |
| `src/app/dashboard/layout.tsx` | Modified | Switcher wired into the shell after the untouched 06-03 gate |
| `src/app/dashboard/settings/page.tsx` | Modified | Active shop via .eq("id", activeShopId); dropped .limit(1) |
| `src/app/dashboard/reviews/page.tsx` | Modified | review_items + table-shops scoped to the active shop (spec fix) |
| `src/app/dashboard/content/page.tsx` | Modified | content_items scoped to the active shop |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Cookie selects, never authorizes | Security: a stale/forged cookie must not leak a non-member shop | resolveActiveShop re-validates every read; RLS + .eq(shop_id) backstop |
| Switch via API route, not server action | Codebase convention (no server actions) | POST /api/shop/switch sets the cookie; client posts + router.refresh() |
| Switcher scopes pages only; authz routes keep explicit shop_id | API routes should take explicit params, not ambient cookie | Smaller, safer blast radius; authz unchanged |
| Defer ads alignment | Ads carries owner-first + ?shop_id= redirect + 07-02 tier gate | Carry-forward; phase close stays tight |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Spec fixes | 1 | Reviews in-page shop filter scoped to active shop |
| Deferred | 1 (planned) | Ads alignment (named carry-forward) |

**Total impact:** One essential spec fix surfaced at human-verify; no scope creep.

### Spec Fix (at human-verify)

**1. Reviews in-page "All shops" filter not scoped to the switcher**
- **Found during:** Task 4 (human-verify) — operator saw Reviews still offering an "All shops" dropdown listing all 8 shops.
- **Root cause:** `ReviewsTable` renders its own in-page shop filter fed by an unscoped `shops` list (nick = psg_superadmin reads all shops). The plan scoped the `review_items` DATA query but missed the component's filter. Classified SPEC (plan incomplete for the reviews surface).
- **Fix:** reviews/page.tsx passes ONLY the active shop to ReviewsTable (its filter hides at <=1 shop) and derives roles from `getActiveShopContext().shops`, dropping the redundant all-shops query AND the separate memberships read.
- **Verification:** typecheck/lint/221 tests/build green; redeployed psg-o44ue3bia; operator re-verified. ContentTable checked — no in-page filter (clean).

### Deferred Items

- Ads alignment (planned defer): point ads' no-param default at the active-shop context (explicit-param-if-member wins). Carry-forward to a follow-up / Phase 8.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| No multi-shop user existed to verify the live switch | Operator-directed temp 2nd membership (Tracy's viewer) on nick@ via MCP; verified switch + leak check; temp membership deleted after (back to 2 users × 1 shop) |
| Reviews still surfaced an all-shops filter | Spec fix above |

## Next Phase Readiness

**Ready:**
- Phase 8 (launch hardening) can build on a stable shop-scoped customer surface.
- `getActiveShopContext` is the reuse point for v0.3 analytics shop scoping.

**Concerns:**
- Ads still uses its own `?shop_id=` resolution (alignment deferred) — minor inconsistency, named carry-forward.
- No Playwright/E2E on the switch flow (route + resolver unit-tested; gate→switch→page covered by live human-verify) → Phase 8 candidate.
- Mobile nav still `lg:flex`-only (Phase 8 carry-in); the switcher renders only in the desktop shell.

**Blockers:** None.

---
*Phase: 07-tier-gating-shop-switcher, Plan: 03 (LAST in phase)*
*Completed: 2026-06-03*
