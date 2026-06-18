---
phase: 14-reviews-sentiment
plan: 03b
subsystem: ui
tags: [sentiment, reviews, report, dashboard, supabase, postgrest]

requires:
  - phase: 14-reviews-sentiment (14-03)
    provides: review_sentiment table + Haiku classify-on-ingest (the data this surfaces)
provides:
  - getReviewSentimentSummary shared aggregate reader (dashboard + report)
  - per-review sentiment badges + Classify-now trigger on the Reviews page
  - per-shop sentiment aggregate panel on /dashboard/analytics
  - additive monthly-report sentiment block (print-path only)
  - optional shopId scope on classifyPendingSentiment
affects: [14-03c sentiment correction queue, v0.4]

tech-stack:
  added: []
  patterns:
    - "Shared read-model aggregate (getReviewSentimentSummary) consumed by both dashboard and report, reusing the additive optional-block report pattern (13-03 gbpPresence mirror)"

key-files:
  created:
    - src/lib/reviews/sentiment-summary.ts
    - src/lib/reviews/__tests__/sentiment-summary.test.ts
    - src/app/api/reviews/classify/route.ts
  modified:
    - src/components/dashboard/reviews-table.tsx
    - src/app/dashboard/reviews/page.tsx
    - src/app/dashboard/analytics/page.tsx
    - src/lib/reviews/review-sentiment-sync.ts
    - src/lib/report/types.ts
    - src/lib/report/report-data.ts
    - src/lib/report/render.ts
    - src/app/reports/[slug]/print/route.ts
    - src/lib/report/__tests__/print-route.test.ts

key-decisions:
  - "Read surface only; the low-confidence human-review/correction queue deferred → 14-03c (operator AskUserQuestion)"
  - "Merged Platform + Source columns into one — the Google badge IS the View-on-Google link (operator 'same?' feedback at the live checkpoint); removed the standalone Source column 8c8438c added"
  - "maps_uri rides the gbp_presence snapshot (no migration, no locations table change) — from the SOURCE fix 8c8438c"
  - "Deployed to prod for live verification (operator Path A) — the plan's ZERO-prod boundary waived by the operator; no migration (review_sentiment already LIVE from 14-04), code-only"

patterns-established:
  - "PostgREST to-one embed normalized (object | 1-elem array) at the page layer, mirroring existingSentiment in review-sentiment-sync"
  - "Classify-now: membership-gate (user client) then service-client run of classifyPendingSentiment scoped by shopId — mirrors api/reviews/ingest"

duration: ~110min
started: 2026-06-17T17:30:00Z
completed: 2026-06-17T19:20:00Z
---

# Phase 14 Plan 03b: Sentiment surface (read) Summary

**The LLM sentiment 14-03 already classifies is now visible — per-review badges + Classify-now on the Reviews page, a per-shop aggregate panel on the analytics dashboard, and an additive monthly-report sentiment block — shipped LIVE to prod and verified on the real 385 Wallace reviews.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~110 min |
| Completed | 2026-06-17 |
| Tasks | 3 auto + 1 checkpoint (approved) |
| Files | 3 created, 10 modified |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Per-review sentiment badges | Pass | Live-verified on Wallace — polarity badge, "Action needed", themes; null → "—" |
| AC-2: Classify-now trigger | Pass | Live "Classified: 5 new, 0 current, 195 failed" then drained; membership-gated, shop-scoped (403 for non-member) |
| AC-3: Dashboard sentiment aggregate | Pass | Per-shop panel (polarity %, actionable count, themes); skipped in all-shops; scoped empty state |
| AC-4: Monthly report sentiment block | Pass | Built + wired (print-path, omits when no data); print-route binding-guard test added. Live PDF render not separately exercised this session |
| AC-5: Quality gates | Pass | tsc 0 · eslint 0 · vitest 746 (+7) · build ✓ (ƒ /api/reviews/classify) · no migration · no new dep |

Skill audit: research-first satisfied (no new external API/library surface; 14-RESEARCH + pattern pass). ✓

## Accomplishments

- Sentiment is no longer write-only — it surfaces in the three places the operator asked for, reusing the analytics-panel + report-block + reviews-table patterns with zero new dependency.
- `getReviewSentimentSummary` is one shared aggregate consumed by both the dashboard and the report (month-scoped via the review_items.reviewed_at join).
- Classify-now lets the operator populate sentiment on demand (used live to classify the 385-review backfill instead of waiting two daily crons).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/reviews/sentiment-summary.ts` | Created | Shared per-shop sentiment aggregate (polarity counts, actionable, avg confidence, top themes) |
| `src/lib/reviews/__tests__/sentiment-summary.test.ts` | Created | 7 unit tests (tallies, theme cap, month window, error) |
| `src/app/api/reviews/classify/route.ts` | Created | Membership-gated on-demand classify trigger |
| `src/components/dashboard/reviews-table.tsx` | Modified | Sentiment column + Classify-now; merged Platform/Source; wrap + top-align |
| `src/app/dashboard/reviews/page.tsx` | Modified | Embed review_sentiment, normalize to-one, pass to table |
| `src/app/dashboard/analytics/page.tsx` | Modified | Per-shop Review sentiment panel + empty state |
| `src/lib/reviews/review-sentiment-sync.ts` | Modified | Optional shopId scope on classifyPendingSentiment |
| `src/lib/report/types.ts` | Modified | SentimentReport type + sentiment? on ReportData |
| `src/lib/report/report-data.ts` | Modified | readReviewSentiment dep + additive assembly |
| `src/lib/report/render.ts` | Modified | renderSentimentBlock + body wiring |
| `src/app/reports/[slug]/print/route.ts` | Modified | Bind the month-scoped sentiment reader |
| `src/lib/report/__tests__/print-route.test.ts` | Modified | Mock + binding-guard for the new reader (12th file, not in plan list) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Merge Platform + Source columns | Operator "same?" at live checkpoint — Platform="Google" + Source="link to Google" were redundant | Google badge is now the View-on-Google link; standalone Source column (added by 8c8438c) removed; freed table width |
| Deploy to prod (Path A) | Operator chose live verification on the real 385 reviews | Plan's ZERO-prod boundary waived; code-only deploy (no migration — review_sentiment already live); dpl_9a28pbddj |
| Defer correction queue → 14-03c | Read surface delivers most value; the write/correction path is a separate concern (RLS write + audit) | 14-03c remains a named follow-up |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | Test guard (12th file); checkpoint UI fixes (wrap/merge/capitalize) |
| Boundary waiver | 1 | ZERO-prod waived by operator (Path A); code-only, no DB change |
| Deferred | 1 | 14-03c correction queue (planned) |

**Total impact:** No scope creep — the checkpoint fixes were operator-requested polish; the prod deploy was an operator choice; no migration touched prod DB.

### Checkpoint fixes (operator feedback, CODE)
- **Review text overlap → wrap.** Review cell now `max-w-sm whitespace-normal break-words`, rows top-aligned (`[&>td]:align-top`); truncate raised to 220.
- **Platform/Source redundancy → merge.** Dropped the Source column; the Platform "Google" badge links to maps_uri when present.
- **Sentiment visibility.** Polarity badge capitalized; column freed of overlap.

### Deferred Items
- 14-03c: low-confidence human-review / sentiment correction queue (write path + RLS write policy + audit).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| print-route.test.ts mocked the service client as `{}`; the new sentiment reader called `.from` on it | Mocked getReviewSentimentSummary in that test + added a binding-guard assertion |
| vercel --prod doubled the root path from apps/psg-hub | Deploy from the repo toplevel (correct .vercel link; the documented above-repo hazard) |

## Next Phase Readiness

**Ready:**
- Sentiment surface is live and verified; classify-now lets the operator drain the backfill.
- The shared summary reader + additive report block are in place for any future sentiment work.

**Concerns:**
- Classify-now classified 200/run with "195 failed" on the first live run — worth a glance at the gateway-Haiku failure mode (rate/transport) on the 195; the dirty-key re-tries them on the next run. Track for 14-03c.
- The Google-badge link only activates once `maps_uri` is populated (a gbp-presence-sync run; monthly cron July 1 or manual).

**Blockers:** None.

**Phase-transition override:** Phase 14 + milestone v0.3.5 were already complete/closed (14-04). 14-03b is a post-close carried follow-up; the file-count heuristic (5 PLAN = 5 SUMMARY) would falsely trigger a phase transition — OVERRIDDEN (same call as 14-01/14-02/13-01). No re-transition, no milestone re-close.

---
*Phase: 14-reviews-sentiment, Plan: 03b*
*Completed: 2026-06-17*
