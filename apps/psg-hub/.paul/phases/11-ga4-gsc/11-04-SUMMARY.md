---
phase: 11-ga4-gsc
plan: 04
subsystem: infra
tags: [ga4, gsc, oauth, vercel, supabase, migration, cron, activation]

# Dependency graph
requires:
  - phase: 11-01
    provides: shared Google OAuth foundation (2 migrations, link surface, accounts.ts)
  - phase: 11-02
    provides: GA4 daily ingest + "Website traffic" panel
  - phase: 11-03
    provides: GSC daily ingest + "Search performance" panel
provides:
  - Phase 11 LIVE on prod with real GA4 + GSC numbers for a pilot shop
  - the two 11-01 tables migrated to prod under PROTOCOL with clean advisor diffs
  - GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI prod secret
  - the analytics page header/empty-state now multi-source aware (df4266d)
affects: [12-psg-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Activation gate batch as its own plan (mirrors 10-03): Stage 0 lead-time -> A migrations under PROTOCOL -> B secret -> C deploy -> D pilot link + real-number verify -> E close"
    - "Per-source page sections each own their empty state (organic/paid/GA4/GSC); header status = max synced_at across ALL sources"

key-files:
  created:
    - .paul/phases/11-ga4-gsc/11-04-GATE-BATCH.md
  modified:
    - src/lib/google-oauth/gsc-metrics.ts
    - src/app/dashboard/analytics/page.tsx
    - apps/psg-hub/e2e/analytics.spec.ts

key-decisions:
  - "CRON_SECRET rotated (sensitive/un-pullable) to unblock cron trigger; shared secret, all crons fine post-redeploy"
  - "Surface defect (semrush-only header/empty-state) fixed before close, not deferred — it is the client-facing AC-4 surface"

patterns-established:
  - "Real-numbers close gate: AC passes on the rendered surface, not on cron-200 or DB rows alone"

# Metrics
duration: multi-session (plan 2026-06-09 -> live close 2026-06-10)
started: 2026-06-09
completed: 2026-06-10
---

# Phase 11 Plan 04: GA4 + GSC Prod Activation (GATE-BATCH) Summary

**Phase 11 is LIVE on prod: a pilot shop (Wallace Collision) links one Google account via combined consent, and `/dashboard/analytics` renders real GA4 "Website traffic" and GSC "Search performance" numbers. The two 11-01 OAuth tables migrated under PROTOCOL with clean advisor diffs; a latent GSC siteUrl double-encode defect and a semrush-only header/empty-state surface defect were both caught and fixed before close.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | Multi-session (plan 06-09 -> live close 06-10) |
| Tasks | 3 completed (2 auto, 1 operator gate batch executed Claude-driven) |
| Migrations applied (prod) | 2 (under PROTOCOL, clean diffs) |
| Files modified | 3 (gsc-metrics.ts, page.tsx, analytics.spec.ts) + runbook authored |
| Prod deploys | 3 (dpl_H4T1GE activation, dpl_827jt2g cron-rotation, dpl_8gKciVNx surface fix) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Runbook authored, ordered, executable | PASS | 11-04-GATE-BATCH.md — 6 stages (0/A/B/C/D/E), real-number pass-gates, verified-env table, .vercel HAZARD pinned |
| AC-2: GSC siteUrl double-encode fixed before ship | PASS | `encodeURIComponent(siteUrl)` removed (googleapis@173 RFC-6570-encodes {siteUrl} itself); siteUrl RAW; tsc 0, gsc 6/6. Live-confirmed: RAW sc-domain: returns rows, no 404/403 |
| AC-3: Phase-11 trees committed on feature branch (no push by Claude) | PASS (w/ deviation) | feature/11-ga4-gsc off main; cf4591f. Deviation: 11-01/11-02 already in 798a41a on origin/main, so cf4591f carries only the 11-03/11-04 remainder, not one "11-01+02+03" commit. Branch still holds the full Phase-11 build for Stage C |
| AC-4: Operator executes; loop closes on REAL NUMBERS | PASS (full, not partial) | Both crons synced (ga4:3 / gsc:6 / failed:0); real numbers verified at DB and on the rendered surface |

## Accomplishments

- **Phase 11 LIVE, full not partial.** Wallace had both a GA4 property AND a verified GSC site, so no GA4-live/GSC-pending honest-partial was needed.
- **Real numbers on the live surface** (operator visually confirmed): GA4 sessions 23 / users 18 / engagement 0.913 (Jun 9); GSC clicks 4 / impressions 372 / CTR 0.011 / avg position 13.363 (Jun 8, ~2-day lag). DB rows: GA4 06-07..09 sessions 5/28/23, users 5/24/18; GSC 06-03..08 impressions 184-502/day, clicks 0-4, position 9-16.
- **Two prod migrations under PROTOCOL, clean diffs:** google_oauth_accounts (RLS + 1 SELECT policy, +0/-0); google_oauth_pending_states (RLS on / 0 policy = +1 rls_enabled_no_policy INFO + 2 benign perf INFO on the new transient table; zero ERROR/WARN).
- **Three RESEARCH live-checks confirmed:** #1 gax authClient runtime auth ✓, #4 RAW sc-domain: siteUrl returns rows ✓, #3 GSC ~2-day lag (max date 06-08) ✓.
- **Surface defect caught at the visual AC-4 check and fixed** (see Deviations): the page header and "No analytics data yet" card were wired solely to the semrush source, contradicting the live GA4/GSC panels for a shop with no semrush data.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: Author runbook | (in cf4591f) | docs | 11-04-GATE-BATCH.md operator runbook |
| Task 2: GSC encode fix + branch + commit | `cf4591f` | feat | gsc-metrics siteUrl raw + 11-03/11-04 trees on feature/11-ga4-gsc |
| Task 3: Operator gate batch | (prod side-effects) | n/a | 2 migrations, secret, deploy, pilot link, both crons, real-number verify |
| Surface fix (scope add at AC-4) | `df4266d` | fix | header + empty-state reflect all sources, not semrush-only |

11-01/11-02 trees: `798a41a` (origin/main, pre-existing). GA4 OAuth foundation + GSC ingest: `798a41a` + `cf4591f`.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `.paul/phases/11-ga4-gsc/11-04-GATE-BATCH.md` | Created | Ordered prod-activation runbook |
| `src/lib/google-oauth/gsc-metrics.ts` | Modified | Removed double-encode; siteUrl passed RAW |
| `src/app/dashboard/analytics/page.tsx` | Modified | Header syncedAt across all sources; empty card retitled "No organic search data yet"; em-dash fix |
| `apps/psg-hub/e2e/analytics.spec.ts` | Modified | Empty-state assertion updated to new title |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Rotate CRON_SECRET | Sensitive/write-only Vercel var returned empty on pull, blocking the cron trigger | Cross-phase: semrush + google-ads crons read the same secret; all fine after the redeploy. If anything outside Vercel held the old value, update it |
| Fix the surface defect before close, not defer | The semrush-only header/empty-card is the exact client-facing surface AC-4 closes on; shipping "No analytics data yet" above live numbers is not an acceptable LIVE state | df4266d + redeploy; close is clean |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Surface defect — essential, client-facing |
| Operator deviations | 1 | CRON_SECRET rotation — recorded, benign |
| Topology deviations | 1 | AC-3 commit shape — no history rewrite |
| Deferred | 3 | Logged below |

### Auto-fixed Issues

**1. [UI] Page header + empty-state wired semrush-only**
- **Found during:** AC-4 visual surface check (operator screenshot showed "Awaiting first sync" / "No analytics data yet" stacked above live GA4/GSC panels)
- **Issue:** `syncedAt` and the `rows.length === 0` empty card derive only from `source = "semrush"` (page.tsx). A shop with GA4/GSC linked but no semrush data shows a global-sounding empty state contradicting populated panels below.
- **Fix:** `syncedAt` now takes max `synced_at` across semrush + google_ads + ga4 + gsc; the semrush empty card retitled "No organic search data yet" (scoped like its GA4/GSC siblings); an em dash in the copy removed.
- **Files:** src/app/dashboard/analytics/page.tsx, e2e/analytics.spec.ts
- **Verification:** tsc 0, eslint 0, vitest 463/463, operator confirmed header flipped to "Last synced" on hub.psgweb.me after redeploy
- **Commit:** df4266d

### Operator / topology deviations

- **CRON_SECRET rotated** (operator-authorized): the var is sensitive/un-pullable; rotated via `vercel env rm` + `add` + redeploy to unblock the cron trigger. Cross-phase shared secret; benign post-redeploy.
- **AC-3 commit shape:** 11-01/11-02 were already committed and pushed in `798a41a` on origin/main before this plan, so `cf4591f` carries only the 11-03/11-04 remainder rather than one "11-01+02+03" commit. No history rewrite; the branch still holds the full Phase-11 build for Stage C.

### Deferred Items

- **OAuth re-link error** ("Something went wrong" on a second link attempt): the FIRST link succeeded end-to-end (Vercel logs: /authorize 200 -> /callback 200 -> /select 200 -> 2 rows). The re-run's failing callback fell after the captured log window; root cause NOT confirmed (hypothesis: re-consent returned no refresh_token). Did NOT affect the live link. Flagged for a later phase.
- **Connect-more-sources button always shows when linked:** page.tsx renders the connect card unconditionally for owner role; it does not check linked state, so it reads "not connected" when you are. Fix: hide or relabel ("Manage connections") once google_oauth_accounts has rows for the shop.
- **GA4 key_events = 0:** a real read (Wallace has no GA4 key-events configured), not a defect. Recorded as a known zero.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| CRON_SECRET pull returned empty (sensitive var) -> cron "unauthorized" | Rotated the secret + redeploy; crons then triggered (ga4:3 / gsc:6) |
| Header/empty-card contradicted live panels | Auto-fixed df4266d (multi-source header/empty-state) + redeploy |

## Skill Audit (Phase 11)

| Expected | Invoked | Notes |
|----------|---------|-------|
| Research-first / per-plan research check | ✓ | RESEARCH.md (ultracode wf_b732175b-025) + 11-01/02/03 summaries cover the live GA4+GSC contracts; migration gate = the 06-01 PROTOCOL |

All required flows invoked.

## Next Phase Readiness

**Ready:**
- All four analytics sources (SEMrush, Google Ads, GA4, GSC) are LIVE on prod — the data foundation Phase 12 (PSG report) consumes.
- Pilot shop Wallace Collision is fully linked (GA4 properties/313002669 + GSC sc-domain:wallacecollisionrepair.com).

**Concerns:**
- OAuth re-link error root cause unconfirmed (deferred).
- Connect-button UX wart (deferred).

**Blockers:**
- None for Phase 12 planning. One operator-gated step remains to fully close the branch: Stage E merge feature/11-ga4-gsc -> main + push (prod merge, operator-gated).

---
*Phase: 11-ga4-gsc, Plan: 04*
*Completed: 2026-06-10*
