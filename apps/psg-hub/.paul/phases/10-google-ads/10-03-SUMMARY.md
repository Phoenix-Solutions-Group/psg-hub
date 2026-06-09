---
phase: 10-google-ads
plan: 03
subsystem: infra
tags: [supabase-migration, vercel, semrush, google-ads, oauth, prod-activation]
requires:
  - phase: 09-03
    provides: SEMrush ingest + analytics surface (activated here)
  - phase: 10-01
    provides: google_ads_* tables + bytea token fix (activated here)
  - phase: 10-02
    provides: google_ads ingest + paid panel (activated here)
provides:
  - Phase 9 SEMrush LIVE on prod (real numbers, 4 url-shops)
  - Phase 10 Google Ads LIVE on prod (real paid numbers, Wallace pilot)
  - 10-03-GATE-BATCH.md runbook (executed)
affects: [11-ga4-gsc, 12-psg-report]
tech-stack:
  added: []
  patterns: ["advisor baseline->apply->diff per prod migration", "real-numbers (not cron-200) first-live-run gate"]
key-files:
  created:
    - .paul/phases/10-google-ads/10-03-GATE-BATCH.md
  modified:
    - .paul/STATE.md
key-decisions:
  - "Combined Phase-9+10 activation from one feature/09-analytics tree, one deploy"
  - "Pilot = Wallace Collision (operator choice); onboarded as a new client+shop"
  - "Vercel project rootDirectory corrected psg-hub/apps/psg-hub -> apps/psg-hub (was a deploy blocker)"
  - "MCC gap surfaced at Stage B -> built 10-04 account-selection (separate unit)"
patterns-established:
  - "Per-migration advisor security diff with pre-declared expected deltas; abort on anything else"
duration: ~5h (operator-paced, live)
started: 2026-06-09
completed: 2026-06-09
---

# Phase 10 Plan 03: Combined Phase-9+10 Prod Activation Summary

**Executed the gate-batch runbook live: applied 3 prod migrations under PROTOCOL, set 8 secrets, fixed a Vercel root-directory deploy blocker, deployed, and verified REAL numbers for both SEMrush (4 url-shops) and Google Ads (Wallace pilot). Phase 9 and Phase 10 both live.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~5h (operator-paced) |
| Tasks | 3 (2 auto + 1 checkpoint:human-action, executed) |
| Migrations applied to prod | 3 (+1 from the 10-04 scope addition) |
| Deploys | 4 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Runbook complete, ordered, prod-safe | Pass | 10-03-GATE-BATCH.md (Stages 0/A/B/C), executed end to end |
| AC-2: Lead-time blockers front-loaded | Pass | Stage 0 dev-token + consent; operator reported done |
| AC-3: Each prod migration carries PROTOCOL inline | Pass | advisor baseline->diff each; only expected `rls_enabled_no_policy` deltas (+1 sync_runs, +2 google_ads default-deny); no unintended diff |
| AC-4: First-live-run gates are real-numbers | Pass | SEMrush: real non-zero for 4 url-shops. Google Ads: Wallace 7-day real spend/clicks/conv, single-row, account-tz dates, bare-10-digit id, CPL null on 0-conv day |
| AC-5: 10-02 tree committed locally | Pass | `8f0527c` (pre-session) |
| AC-6: Honest close | Pass | Phase 10 marked live ONLY after both sources verified on real numbers |

## Accomplishments

- **Phase 9 SEMrush live:** migrations `20260604`/`20260605` applied; `SEMRUSH_API_KEY`+`CRON_SECRET` set; cron `synced:4` → real organic numbers (Flower Hill ×3, Tracy's).
- **Phase 10 Google Ads live:** migration `20260608` applied; 6 Google secrets + MCC `GOOGLE_ADS_LOGIN_CUSTOMER_ID=6935795509`; Wallace linked; cron `synced:7 failed:0` → real paid metrics ($29–$200/day, 06-02..06-08).
- **Deploy blocker fixed:** Vercel project Root Directory was stale (`psg-hub/apps/psg-hub`); corrected to `apps/psg-hub` via API — no prior CLI deploy from this split repo would have worked.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Pilot = Wallace Collision | Operator choice (acct 604-861-1995) | Onboarded a new client+shop (107fa991) + nick owner + `SHOP_ADS_TIER_OVERRIDE=wallace-collision` (no fake Stripe row) |
| Build MCC support as a researched unit, not inline | Security-sensitive prod OAuth; unverified enumeration API | Spawned 10-04 (see 10-04-SUMMARY) |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 1 | 10-04 MCC account-selection (callback enumeration + picker + /select + migration) — required because PSG is an MCC and the 10-01/02 single-customer link couldn't link any real client |
| Infra fixes | 1 | Vercel rootDirectory correction |

**Total impact:** Both essential. The MCC unit was the only path to a real Google Ads link for PSG.

## Skill Audit

Research-first (SPECIAL-FLOWS, required): ✓ — 10-03 fed by RESEARCH.md; the 10-04 scope addition opened a new API surface (`customer_client` enumeration) and was researched first (`10-04-MCC-RESEARCH.md`, verified against Google Ads API docs) before building.

## Next Phase Readiness

**Ready:** Analytics surface live with SEMrush + Google Ads; MCC link flow generalizes to every PSG client. Phase 11 (GA4+GSC) inherits the OAuth/state/crypto + per-account `login_customer_id` patterns.
**Concerns:** Single Google Ads account per shop (multi-per-shop collides on the snapshot key — deferred). Dev-token tier (Explorer) caps ops/day; Basic needed to scale.
**Blockers:** None.

---
*Phase: 10-google-ads, Plan: 03*
*Completed: 2026-06-09*
