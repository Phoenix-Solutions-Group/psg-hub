---
phase: 08-launch-hardening
plan: 01
subsystem: ui
tags: [nextjs, shop-switcher, mobile-nav, vercel, git-deploy, rls-context]

requires:
  - phase: 07-tier-gating-shop-switcher
    provides: getActiveShopContext active-shop cookie context (src/lib/shop/context.ts) + <ShopSwitcher>
provides:
  - ads no-param default resolves to the active shop (07-03 cookie), explicit ?shop_id= membership-gated
  - mobile nav (<lg) exposing NAV links + <ShopSwitcher> (MobileNav/MobileNavPanel)
  - dashboard home with phantom Agent Runs card removed + 3 live active-shop content_items counts
  - git↔Vercel pipeline wired + proven (preview build); CLI prod now deploys from repo root
affects: [08-02-pii-rls, 08-04-quality-gates, future v0.3 analytics surfaces]

tech-stack:
  added: []
  patterns:
    - "Presentational/stateful split (MobileNavPanel pure) for node-env render-branch tests via react-dom/server (no jsdom/Testing-Library)"
    - "Git deploys: project rootDirectory is repo-root-relative (psg-hub/apps/psg-hub); CLI deploys from repo root"

key-files:
  created:
    - src/components/dashboard/mobile-nav.tsx
    - src/components/dashboard/__tests__/mobile-nav.test.tsx
    - src/app/dashboard/ads/__tests__/page.test.ts
  modified:
    - src/app/dashboard/ads/page.tsx
    - src/app/dashboard/layout.tsx
    - src/app/dashboard/page.tsx
    - vercel.json

key-decisions:
  - "Wire git↔Vercel (operator): connect psg-internal repo, rootDirectory=psg-hub/apps/psg-hub, framework nextjs; prod-on-main guarded off via vercel.json"
  - "Preview env unprovisionable (vars type=sensitive, undecryptable) → verify 08-01 on prod with rollback-ready instead of preview"
  - "Home 3 cards mapped to content_items pipeline (Content Items / pending_review / published); review 'pending' is content-pipeline, not customer reviews"

patterns-established:
  - "MobileNavPanel pure component renders via react-dom/server in node test env (zero new test dep)"

duration: ~95min
started: 2026-06-03T13:15:00Z
completed: 2026-06-03T14:10:00Z
---

# Phase 8 Plan 01: Carry-in surface fixes Summary

**Settled the three Phase-7 carry-in defects (ads active-shop alignment, mobile nav, de-phantomed home) and, as an operator-directed scope addition, wired + proved the git↔Vercel deploy pipeline; 08-01 is LIVE on hub.psgweb.me (dpl psg-qpczv9f0z).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~95 min |
| Tasks | 4 (3 auto + 1 human-verify) |
| Files modified | 7 (3 new, 4 modified) |
| Tests | 229 (was 221; +8) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Ads honors active shop | Pass | No-param default → getActiveShopContext; 5 ads unit tests. Live 2-shop switch accepted on unit tests (operator). |
| AC-2: Explicit shop_id wins + membership-gated | Pass | Explicit-param re-validation (lines 38-48) untouched; non-member → /dashboard. |
| AC-3: Mobile nav exposes NAV + switcher below lg | Pass | MobileNav lg:hidden; operator-verified live on hub.psgweb.me. |
| AC-4: No phantom Agent Runs metric | Pass | Card removed; 3 cards wired to active-shop content_items counts; no .from("agent_runs"). |

## Accomplishments

- Three carry-in surface defects fixed, code-only (no DB write, no migration, no new dep).
- git↔Vercel pipeline wired and proven end-to-end (branch push → Preview build Ready ~45s). Old submodule blocker is gone (psg-internal has no submodule).
- 08-01 deployed LIVE to hub.psgweb.me with prod env.

## Task Commits

Branch `phase-8/08-01-carry-in` (pushed to origin/psg-internal):

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Tasks 1-3 + vercel.json guard | `f51de6c` | feat | ads active-shop, mobile nav, home counts, git guard |
| Mobile nav scrim fix | `d065f77` | fix | dismiss-scrim invisible (drop grey bg-black/30) |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/app/dashboard/ads/page.tsx` | Modified | No-param default → getActiveShopContext |
| `src/app/dashboard/layout.tsx` | Modified | Mount <MobileNav> in header (lg:hidden) |
| `src/app/dashboard/page.tsx` | Modified | Drop Agent Runs card; 3 live active-shop counts |
| `src/components/dashboard/mobile-nav.tsx` | Created | MobileNav (stateful) + MobileNavPanel (pure) |
| `src/components/dashboard/__tests__/mobile-nav.test.tsx` | Created | 3 render-branch tests (react-dom/server) |
| `src/app/dashboard/ads/__tests__/page.test.ts` | Created | 5 redirect-logic tests |
| `vercel.json` | Modified | git.deploymentEnabled.main=false guard |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Wire git↔Vercel (psg-internal) | Operator request; old `data` link was dead (LINK empty) so STATE's "connected to data" was stale | rootDirectory now psg-hub/apps/psg-hub; CLI prod deploys from repo root going forward |
| Verify on prod, not preview | Preview env empty; the 14 vars are type=sensitive (undecryptable) so could not be copied to Preview without manual re-paste | 08-01 shipped to prod with rollback-ready; previews remain env-less until secrets re-entered or a preview backend is stood up |
| Keep prod-on-main auto-deploy OFF | Operator chose preview-first; reverses nothing (Phase-3 CLI-only stance preserved) | vercel.json guard (effective once branch merges to main); until then do NOT push main |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Test-approach change | 1 | No new dep; matches codebase node-test convention |
| Aesthetic fix at human-verify | 1 | Code-only polish |
| Scope addition (operator) | 1 (large) | git↔Vercel wiring + prod deploy — infra, beyond original code-only plan |

### Test-approach change
- PLAN Task 2 assumed jsdom + Testing-Library (per PROJECT.md tech stack). Reality: vitest env=`node`, jsdom + @testing-library absent, no component-render test exists in the repo. Adding them would breach the no-new-dep boundary. Resolved: split a pure `MobileNavPanel` and tested its render branches with `react-dom/server` (already present via react-dom). **PROJECT.md "jsdom + Testing Library" note is inaccurate for psg-hub.**

### Aesthetic fix (at human-verify)
- Operator saw a full-screen grey dismiss-scrim (`bg-black/30`). Changed to an invisible click-catcher (`fixed inset-0 z-40`) — keeps tap-outside-to-close, removes the grey. Committed `d065f77`, redeployed.

### Scope addition — git↔Vercel wiring (operator-directed)
- Discovered the Vercel project's git link was empty (not `data` as STATE recorded). Connected `Phoenix-Solutions-Group/psg-internal`, set rootDirectory `psg-hub/apps/psg-hub` + framework nextjs via API. Proved a branch push triggers a Preview build (Ready). This reverses the practical effect of the Phase-3 "CLI-only" posture for previews while keeping prod-on-main off.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| hub.psgweb.me transient `MIDDLEWARE_INVOCATION_FAILED` | Propagation blip while rootDirectory/framework settings changed on the live project; recovered on its own (12/12 routes healthy after). |
| Preview build 500 (`MIDDLEWARE_INVOCATION_FAILED`) | Preview env empty (Supabase middleware throws on undefined keys). Vars are type=sensitive → uncopyable. Chose prod deploy for verification. |
| CLI prod deploy path | rootDirectory is now repo-root-relative → re-linked .vercel at repo root `/dev/psg/internal`; `vercel --prod` from there. |

## Next Phase Readiness

**Ready:**
- Surface settled for the 08-02 PII/RLS review to audit a stable state.
- git pipeline available; CLI prod deploy from repo root documented.

**Concerns:**
- Previews are env-less until the 14 sensitive vars are re-entered into the Preview scope (or a separate preview Supabase). Track for the quality-gates plan (Playwright will want a runnable preview/env).
- vercel.json main guard only protects prod-on-main after the branch merges to main; until then, do not push main.
- 08-01 deployed to prod ahead of UNIFY/merge — branch `phase-8/08-01-carry-in` is the source of truth; merge to main when convenient.

**Blockers:** None.

---
*Phase: 08-launch-hardening, Plan: 01*
*Completed: 2026-06-03*
