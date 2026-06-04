---
phase: 06-rbac-rls-spine
plan: 05
subsystem: auth
tags: [rls, shop_users, membership, llm_call_log, guard, supabase, nextjs]

requires:
  - phase: 06-02
    provides: RBAC + RLS spine tables + private resolvers
  - phase: 06-03
    provides: shop-access.ts (shop_users service-role read) + dashboard gate
  - phase: 06-04
    provides: reviews reconcile + the PostgREST alias pattern + review_responses governance
provides:
  - Uniform shop_users(user_id, role) membership model across all authz sites
  - llm_call_log table (unblocks reviews draft rate-limit path)
  - Guarded ads / agents / reviews-ingest surfaces (no phantom reads)
affects: [07-tier-gating, 07-onboarding, 08-launch-hardening, v0.3-google-ads]

tech-stack:
  added: []
  patterns: [PostgREST column aliasing to reconcile divergent live schema; guard-card for deferred surfaces]

key-files:
  created:
    - supabase/migrations/20260603120000_llm_call_log.sql
  modified:
    - src/app/dashboard/ads/page.tsx
    - src/app/dashboard/agents/page.tsx
    - src/app/dashboard/settings/page.tsx
    - src/app/api/reviews/ingest/route.ts
    - src/app/api/ads/google/* (5 routes)
    - src/app/api/content/[id]/{approve,reject}/route.ts
    - src/app/api/billing/portal/route.ts
    - src/app/api/webhooks/stripe/route.ts
    - src/components/dashboard/onboarding-wizard.tsx
    - src/app/api/ads/google/__tests__/routes.test.ts

key-decisions:
  - "Reads repoint mechanically (no client swap): shop_users SELECT policy via user_shop_ids() lets a user-session client read its own membership rows"
  - "Onboarding first-owner INSERT is RLS-blocked by design under user-session — deferred to Phase 7 service-role bootstrap route"
  - "Settings shop fields reconciled to live shops columns via alias (no schema change)"

patterns-established:
  - "Guard deferred feature surfaces with a coming-soon card/501 INSTEAD of deleting; revivable in their milestone"
  - "Alias divergent live columns in the PostgREST select rather than changing schema"

duration: ~135min
started: 2026-06-03T08:00:00Z
completed: 2026-06-03T10:30:00Z
---

# Phase 6 Plan 05: Spine close (membership repoint + llm_call_log + guards) Summary

**Made the shop_users(user_id, role) membership model uniform across all 13 remaining authz sites, stood up llm_call_log on prod (unblocks the reviews draft path), and guarded the three not-yet-backed feature surfaces (Google Ads, agents, reviews ingest) so no phantom table is queried at runtime — closing the RBAC + RLS spine.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~135 min |
| Tasks | 4 auto + 1 human-verify checkpoint |
| Files modified | 13 src + 1 test + 1 migration |
| Prod writes | 1 (llm_call_log migration) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Membership repoint complete + uniform | Pass | 13 sites on shop_users(user_id); zero `.from("shop_members")` in src; only legit `app_user_roles.profile_id` role filter remains in shop-access.ts (boundary) |
| AC-2: llm_call_log live → reviews draft works | Pass | Table live (12 cols exact-match, 2 indexes, RLS default-deny); insert→count(=1, no throw)→delete roundtrip proven; advisor diff = +1 INFO only |
| AC-3: Deferred surfaces guarded, no phantom reads | Pass | ads/agents/ingest: zero phantom `.from()`; ads keeps tier-gate+membership; ingest 501 pre-query |
| AC-4: Gates green, scope held | Pass | typecheck clean · lint 0 err (1 pre-existing warn) · 188 tests · build green; no feature logic built |

## Accomplishments

- Membership model now uniform on `shop_users(user_id, shop_id, role)` phase-wide; zero phantom `shop_members` reads remain in `src/`.
- `llm_call_log` LIVE on shared prod (gylkkzmcmbdftxieyabw) — the 06-04 phantom-table 500 on the reviews DRAFT path (assertWithinLimits throwing) is closed. Advisor diff: exactly +1 expected INFO, 0 new ERROR/WARN.
- Ads / agents / reviews-ingest guarded to clean "available later" states; feature components/routes preserved for revival in v0.3 / v1.6 / their milestone.
- Deployed to hub.psgweb.me; two checkpoint findings fixed and redeployed.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260603120000_llm_call_log.sql` | Created | llm_call_log table (RLS default-deny, 2 window indexes) |
| `src/app/dashboard/ads/page.tsx` | Modified | Repoint membership; guard card (removed google_ads_* loads + phantom shops col); fixed stale `/ads` redirect → `/dashboard/ads` |
| `src/app/dashboard/agents/page.tsx` | Modified | Replaced agent_runs load with guard empty-state |
| `src/app/dashboard/settings/page.tsx` | Modified | Repoint membership; alias real shops cols (url/telephone/address_locality/address_region) |
| `src/app/api/reviews/ingest/route.ts` | Modified | Repoint membership; 501 guard before phantom review_sources/reviews query |
| `src/app/api/ads/google/{authorize,campaigns,campaigns/sync,campaigns/[id],accounts/[id]/disconnect}/route.ts` | Modified | Repoint membership to shop_users(user_id) |
| `src/app/api/content/[id]/{approve,reject}/route.ts` | Modified | Repoint membership |
| `src/app/api/billing/portal/route.ts` | Modified | Repoint membership |
| `src/app/api/webhooks/stripe/route.ts` | Modified | Repoint membership (service-role) |
| `src/components/dashboard/onboarding-wizard.tsx` | Modified | Repoint membership columns + RLS-bootstrap note (deferred) |
| `src/app/api/ads/google/__tests__/routes.test.ts` | Modified | Mock table `shop_members`→`shop_users` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Reads repoint mechanically (keep user-session client) | shop_users SELECT policy `shop_id IN (user_shop_ids())` + helper returning caller's own memberships → user-session reads its own rows | 12 read sites work at runtime; no service-role swap needed |
| Onboarding INSERT deferred (not fixed) | with_check `user_is_shop_owner(shop_id)` is chicken-and-egg for a new shop under user-session; needs service-role bootstrap | Columns repointed for uniformity; functional bootstrap → Phase 7 |
| Settings shops fields aliased to live columns | Live `shops` lacks website_url/phone/city/state (has url/telephone/address_locality/address_region); 06-04 alias pattern, no schema change | Settings renders the shop instead of "No shop linked" |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (at checkpoint) | 2 | Essential — surfaced 404 + broken settings render |
| Scope reductions | 1 | Onboarding bootstrap deferred (RLS by design) |
| Deferred | 3 | Logged (onboarding bootstrap, mobile nav, home agent_runs) |

**Total impact:** Repoint + guard + 1 table as scoped; two pre-existing/divergence bugs caught and fixed at human-verify; no feature creep.

### Auto-fixed Issues

**1. [CODE] Ads page 404 on navigation**
- **Found during:** Task 5 (human-verify)
- **Issue:** ads page redirected to stale `/ads?shop_id=` (Phase-2 route-group→segment leftover); `/ads` route does not exist → 404
- **Fix:** redirect target → `/dashboard/ads?shop_id=`
- **Files:** src/app/dashboard/ads/page.tsx
- **Verification:** redeployed; operator re-verified no 404

**2. [SCHEMA divergence] Settings "No shop linked" for an owner**
- **Found during:** Task 5 (human-verify)
- **Issue:** live `shops` has no website_url/phone/city/state; embed selected phantom cols → PostgREST error → null → "No shop linked"
- **Fix:** alias real columns (`website_url:url, phone:telephone, city:address_locality, state:address_region`); no schema change
- **Files:** src/app/dashboard/settings/page.tsx
- **Verification:** Demo Body Shop renders (contact fields null → "Not set"); 188 tests; redeployed; operator re-verified

### Deferred Items

- Onboarding first-owner bootstrap → service-role server route (Phase 7 onboarding). Also: onboarding shops INSERT writes phantom shop columns (same Phase-7 reconcile).
- Mobile nav missing (sidebar `lg:flex` only) → Phase 8 launch hardening.
- `/dashboard` HOME stat card still reads phantom `agent_runs` (renders 0, swallowed) → same guard treatment later.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Advisor flagged worst-case "shop_users default-deny" → reads would break | Verified live pg_policies: shop_users HAS a SELECT policy via user_shop_ids(); user-session reads work. Reconciled, mechanical repoint confirmed safe |
| Reviews draft "no options" at verify | Correct empty state (review_items=0); llm_call_log unblock proven server-side; full in-browser draft needs seeded review + LLM key (out of plan surface) |

## Next Phase Readiness

**Ready:**
- Membership model uniform on shop_users phase-wide; spine (06-01..06-05) coherent and closeable.
- Reviews draft rate-limit path unblocked (llm_call_log live).
- Deferred surfaces guarded and cleanly revivable.

**Concerns:**
- Onboarding cannot create the first owner under user-session (RLS) — Phase 7 must build a service-role bootstrap route + reconcile onboarding's shops INSERT columns.
- Inherited code assumes shop columns that diverge from live `shops` (ads campaigns route still selects phantom cols, but is guarded/dormant until v0.3).
- Mobile nav absent (Phase 8).

**Blockers:** None.

---
*Phase: 06-rbac-rls-spine, Plan: 05*
*Completed: 2026-06-03*
