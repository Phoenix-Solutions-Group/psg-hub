---
phase: 06-rbac-rls-spine
plan: 04
subsystem: reviews
tags: [supabase, rls, postgrest, review_items, review_responses, shop_users, governance]

requires:
  - phase: 06-02
    provides: RBAC tables + private resolvers on prod (default-deny)
  - phase: 06-03
    provides: shop-access helper + customer-id gate pattern
provides:
  - reviews surface (read + AI-response governance) reconciled to live deployed schema
  - review_responses governance migration (extend) live on shared prod
  - first customer feature operating on real schema (empty until ingest lands)
affects: [06-05 ads surface, 07 tier gating + shop switcher, 08 launch hardening]

tech-stack:
  added: []
  patterns:
    - "PostgREST read-aliasing (body:draft_text, review_id:review_item_id, body:text) to bridge code names to deployed columns with minimal churn"
    - "EXTEND-under-S1: add governance columns to a deployed shared table via migrations-as-code; verify advisor 0-new + synthetic write-path roundtrip"
    - "Membership-clamped RLS (user_shop_ids()) trusted as defense-in-depth; user-session client kept for reads"

key-files:
  created:
    - supabase/migrations/20260602170000_review_responses_governance.sql
  modified:
    - src/app/dashboard/reviews/page.tsx
    - src/app/api/reviews/list/route.ts
    - src/app/api/reviews/[id]/draft-response/route.ts
    - src/app/api/reviews/[id]/approve-response/route.ts
    - src/app/api/reviews/[id]/__tests__/routes.test.ts

key-decisions:
  - "06-04 Task 1: EXTEND review_responses (vs strip/hybrid) + app-side rename review_id->review_item_id"
  - "Reads stay on user-session client; review_items/review_responses RLS already membership-clamped (no new policy)"
  - "ingest + review_sources OUT of scope -> 06-05 (net-new DDL, ads class)"

patterns-established:
  - "Ground plan authoring on live schema via MCP, not inherited ROADMAP assumptions"
  - "Verify with a real write-path roundtrip when render/tests swallow errors (CARL rule 2)"

duration: ~75min
started: 2026-06-02T22:40:00Z
completed: 2026-06-03T00:05:00Z
---

# Phase 6 Plan 04: Reviews surface reconcile Summary

**Reconciled the psg-hub reviews surface (read + AI-response governance) from inherited phantom-schema assumptions onto the live deployed schema — repointed reviews->review_items / shop_members->shop_users / review_id->review_item_id, EXTENDed review_responses with 11 governance columns on shared prod, deployed live, and proved the draft->approve write path against real schema.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~75 min |
| Tasks | 5 (1 decision, 3 auto, 1 human-verify) |
| Files modified | 5 + 1 migration |
| Tests | 188 passed |
| Deploy | dpl_BjgwCaH5JrQHccE8ZYkXhuneMEsg (hub.psgweb.me) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: membership + role gating from shop_users | Pass | page + both routes read shop_users(user_id); shop_users.role CHECK = owner/manager/viewer (exact app gating) |
| AC-2: customer reviews from review_items + empty-state | Pass | page + list query review_items (alias text->body, reviewed_at->posted_at); /dashboard/reviews live renders, no 500 |
| AC-3: response path matches chosen schema (EXTEND) | Pass | draft/approve keyed review_item_id, draft_text; full governance retained; typecheck clean |
| AC-4: migration safe + clean (EXTEND) | Pass | migrations-as-code; 11 cols + UNIQUE(review_item_id) live; 0 rows; advisor 0-new ERROR/WARN |
| AC-5: gates green, scope held | Pass | typecheck clean; lint 0 err (1 pre-existing); 188 tests; prod build green; only reviews surface + 1 migration touched |

## Accomplishments

- review_responses EXTENDed on shared prod (shop_id, tone_preset, model_id, prompt_version, version, safety_flags, safety_overridden(+by), created_by, approved_by, approved_at) + UNIQUE(review_item_id); advisor 0-new.
- Reviews read + write paths repointed to the real deployed tables; phantom shop_members/profile_id and the content-suggestion `reviews` table fully removed from the reviews surface.
- Deployed live via CLI `vercel --prod` from the re-linked inner psg-hub/ — build 45s, submodule-free (M3 blocker proven dead in practice).
- Write path proven against real schema (synthetic review_item -> draft upsert with exact app payload -> approve version-match update -> CASCADE cleanup -> 0 rows).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260602170000_review_responses_governance.sql` | Created | ADD 11 governance cols + UNIQUE(review_item_id); no RLS/policy change |
| `src/app/dashboard/reviews/page.tsx` | Modified | reviews->review_items (aliases, url=null), shop_members->shop_users, responses keyed review_item_id |
| `src/app/api/reviews/list/route.ts` | Modified | reviews->review_items (aliases; drop external_id/url) |
| `src/app/api/reviews/[id]/draft-response/route.ts` | Modified | parent review->review_items; shop_users; upsert review_item_id/draft_text/onConflict |
| `src/app/api/reviews/[id]/approve-response/route.ts` | Modified | review_items; shop_users; review_responses keyed review_item_id; patch draft_text |
| `src/app/api/reviews/[id]/__tests__/routes.test.ts` | Modified | mock table names reviews->review_items, shop_members->shop_users |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| EXTEND review_responses (not strip) | Live table lacked the app's shipped governance model; 0 rows = zero data risk; mechanical code reconcile | Migration adds 11 cols; governance (version concurrency, safety override, approval attribution) preserved |
| App-side rename review_id->review_item_id | Match live FK; table is review_items | Code change only, no DB rename |
| Reads on user-session client (no new policy) | review_items/review_responses already membership-clamped via user_shop_ids() | Defense-in-depth RLS; default-deny posture intact (path-A) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope reductions | 1 | Fewer files than files_modified list |
| Deferred | 0 (pre-scoped) | ingest/review_sources already scoped to 06-05 |

**Total impact:** No scope creep; one reduction.

### Scope reduction
- **types.ts / responder.ts / response-modal.tsx NOT modified.** PostgREST read-aliasing (body:draft_text, review_id:review_item_id, body:text) kept their TS surface stable, so the planned edits to those 3 files were unnecessary. Listed in PLAN files_modified; not touched.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Render + mocked tests can't fail loud (error-swallow `?? []`; mocks ignore select strings) — flagged by advisor | Ran autonomous synthetic write-path roundtrip on real schema (insert review_items NOT-NULL location ok -> draft upsert exact payload accepted -> approve version-match -> CASCADE cleanup -> 0 rows). Proof, not reasoning (CARL rule 2). |
| Vercel `.vercel` link stripped in the psg-internal absorb | Re-linked inner psg-hub/ to project psg-hub non-interactively before deploy |

## Next Phase Readiness

**Ready:**
- Reviews surface operates on real schema; pattern set for 06-05 (ads) reconcile.
- shop_users membership + RLS clamps proven as the customer-data spine.

**Concerns:**
- Residual (low): supabase-js PostgREST alias parsing (body:draft_text etc.) not exercised by raw SQL — covered by operator in-browser approval; first real data lands at ingest (06-05).
- review_items.location_id is NOT NULL — the (deferred) ingest path must supply a valid location_id.
- Reviews "Sync now" button calls /api/reviews/ingest which still hits phantom review_sources — non-functional until 06-05.
- prod runs 06-04 code + the live migration while still UNCOMMITTED to git — commit at phase transition (06-05 close) per the deferred-commit pattern; repo cannot reproduce prod state until then.

**Blockers:** None for 06-05.

---
*Phase: 06-rbac-rls-spine, Plan: 04*
*Completed: 2026-06-02*
