---
phase: 14-reviews-sentiment
plan: 03b
type: execute
wave: 1
depends_on: ["14-03"]
files_modified:
  - src/lib/reviews/sentiment-summary.ts
  - src/lib/reviews/__tests__/sentiment-summary.test.ts
  - src/lib/reviews/review-sentiment-sync.ts
  - src/app/dashboard/reviews/page.tsx
  - src/components/dashboard/reviews-table.tsx
  - src/app/api/reviews/classify/route.ts
  - src/app/dashboard/analytics/page.tsx
  - src/lib/report/types.ts
  - src/lib/report/report-data.ts
  - src/lib/report/render.ts
  - src/app/reports/[slug]/print/route.ts
autonomous: false
---

<objective>
## Goal
Surface the LLM sentiment that 14-03 already classifies. `review_sentiment` is populated
build-local → live (Haiku classify-on-ingest), but NOTHING reads it. This plan adds the READ
surface: per-review sentiment badges on the Reviews page, a shop-level aggregate panel on the
analytics dashboard, and a monthly-report sentiment block — plus a "Classify now" trigger so
sentiment can be populated on demand instead of waiting for the daily gbp-reviews-sync cron.

## Purpose
14-03 built the classifier; without a surface, the sentiment data is invisible. This closes
the loop on the v0.3.5 "post-repair sentiment" value — the shop sees how customers feel and
which complaints are actionable, in the places they already look.

## Output
- New `getReviewSentimentSummary` reader (shared by dashboard + report)
- Reviews page: per-review polarity / actionable / themes badges + "Classify now" button + classify route
- Analytics dashboard: per-shop sentiment aggregate panel
- Monthly report: additive sentiment block (mirrors the 13-03 gbpPresence block)
- `.paul/phases/14-reviews-sentiment/14-03b-SUMMARY.md`
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/STATE.md
@.paul/ROADMAP.md

## Research gate (SPECIAL-FLOWS research-first)
No NEW external API/library surface — this surfaces the existing `review_sentiment` table
using internal patterns already in the codebase. 14-RESEARCH §LLM sentiment design covers the
classifier/schema; the per-plan pattern pass (2026-06-17) confirmed the consuming patterns:
the report block mirror (13-03 gbpPresence), the analytics panel (13-03b presence header),
and the per-review reviews-table. Research gate SATISFIED — no ultracode research Workflow needed.

## Source Files (patterns this plan mirrors / extends)
@src/lib/reviews/review-sentiment-sync.ts        # classifyPendingSentiment (classify-now reuses it)
@src/app/dashboard/reviews/page.tsx              # review_items select (add the review_sentiment embed)
@src/components/dashboard/reviews-table.tsx      # add the Sentiment column
@src/app/api/reviews/ingest/route.ts             # membership-gated POST pattern for the classify route
@src/app/dashboard/analytics/page.tsx            # gbp_presence panel pattern (~323) to mirror
@src/lib/report/report-data.ts                   # buildGbpPresence reader/build pattern to mirror
@src/lib/report/render.ts                         # gbp presence block (~655) to mirror
@supabase/migrations/20260617120000_review_sentiment.sql  # LIVE table shape (DO NOT re-migrate)
</context>

<skills>
## Required Flows (from SPECIAL-FLOWS.md)

| Flow | Priority | When | Status |
|------|----------|------|--------|
| Per-plan research check | required | Before authoring | ✅ Satisfied — no new external surface; 14-RESEARCH + pattern pass cover it |

No new external API/library → no ultracode research Workflow required (per SPECIAL-FLOWS rule).
</skills>

<acceptance_criteria>

## AC-1: Per-review sentiment on the Reviews page
```gherkin
Given a review_items row that has a review_sentiment row
When the owner/manager opens /dashboard/reviews for that shop
Then the review's row shows a polarity badge (positive/neutral/negative), an
  actionable-complaint indicator when actionable_complaint is true, and its themes
And a review with NO sentiment row shows a neutral "—" (no fabricated label)
```

## AC-2: Classify-now trigger
```gherkin
Given the active shop has review_items without sentiment rows
When the owner/manager clicks "Classify now"
Then a membership-gated POST runs classifyPendingSentiment scoped to that shop
And after the run completes the page reflects newly-classified reviews
And a non-member / cross-shop shop_id is rejected (403)
```

## AC-3: Dashboard sentiment aggregate
```gherkin
Given a shop with classified reviews
When the owner/manager views /dashboard/analytics for that single shop
Then a sentiment panel shows the polarity breakdown (positive/neutral/negative counts),
  the open actionable-complaint count, and the top themes
And in the all-shops (MSO) scope the panel is skipped (per-shop only, mirrors gbp_presence)
And a shop with no classified reviews shows a scoped empty state (no global error)
```

## AC-4: Monthly report sentiment block
```gherkin
Given a shop with classified reviews in the report month
When the monthly report PDF is rendered for that shop+month
Then it includes a sentiment block (polarity breakdown + actionable count + top themes)
And when the shop has no sentiment data for the month the block is omitted entirely
  (graceful degrade, exactly like the gbpPresence block)
And the narrative/eval path is UNTOUCHED (block is tabular, print-path only — 12-05c precedent)
```

## AC-5: Quality gates
```gherkin
Given the plan is complete
When the gates run
Then tsc 0, eslint 0/0, vitest all pass (incl. new sentiment-summary tests), build ✓
And NO new runtime dependency, NO migration, NO prod write, review_sentiment/sentiment.ts/
  review_items/the classify-on-ingest cron wiring all UNCHANGED
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Sentiment summary reader + per-shop classify scope</name>
  <files>src/lib/reviews/sentiment-summary.ts, src/lib/reviews/__tests__/sentiment-summary.test.ts, src/lib/reviews/review-sentiment-sync.ts</files>
  <action>
    Create `getReviewSentimentSummary(client, { shopId, month? })`:
    - Query review_sentiment for the shop via the passed (user-session, RLS-clamped) client.
      When `month` ('YYYY-MM') is given, scope to that month by embedding review_items
      (`review_items!inner(reviewed_at)`) and filtering reviewed_at within [month-01, nextMonth-01).
    - Return a pure summary: { total, positive, neutral, negative, actionableOpen, avgConfidence,
      topThemes: { theme, count }[] (desc, cap ~6) }.
    - Aggregate polarity counts + themes in JS over the fetched rows.
      // ponytail: JS aggregation over fetched rows — correct for the pilot; a DB rollup
      // (rpc/view) is the fleet-scale upgrade. Cap the fetch (e.g. 2000) and name the ceiling.
    - Keep it deps-light + node-testable (no "server-only" import) so the unit test can drive it
      with a fake Supabase client builder (mirror the existing reviews test seams).

    In review-sentiment-sync.ts: add an OPTIONAL `shopId?: string` to ClassifyPendingOptions and,
    when present, add `.eq("shop_id", shopId)` to the review_items select. Default (cron) behavior
    UNCHANGED when shopId is absent. Do NOT touch the classifier, the upsert, or the dirty-key logic.

    Add sentiment-summary.test.ts: assert polarity tallies, actionableOpen count, theme ranking +
    cap, avgConfidence, and the empty-input case (total 0, no throw).
    Avoid: changing review_sentiment columns or sentiment.ts (the table is LIVE on prod).
  </action>
  <verify>npx vitest run src/lib/reviews/__tests__/sentiment-summary.test.ts ; npx tsc --noEmit</verify>
  <done>AC-3 + AC-4 data layer satisfied; AC-2 scope filter added; AC-5 (tsc/tests) green</done>
</task>

<task type="auto">
  <name>Task 2: Reviews page sentiment badges + Classify-now</name>
  <files>src/app/dashboard/reviews/page.tsx, src/components/dashboard/reviews-table.tsx, src/app/api/reviews/classify/route.ts</files>
  <action>
    page.tsx: extend the review_items select to embed the sentiment row
    (`review_sentiment(polarity, confidence, themes, actionable_complaint)`); map it onto each
    review object (handle the PostgREST to-one embed = object|single-element-array, like
    existingSentiment in review-sentiment-sync.ts). Pass through to the table.

    reviews-table.tsx: extend the Review type with an optional sentiment field; add a "Sentiment"
    column rendering a polarity Badge (variant/colour by polarity — reuse existing Badge; map
    positive/neutral/negative to brand-token classes, no new colours), an actionable-complaint
    marker when true, and themes as small muted text. Null sentiment → "—". Add a "Classify now"
    button beside "Sync now" that POSTs { shop_id: active } to /api/reviews/classify and shows the
    returned counts (mirror the existing handleSync transition + message pattern).

    classify/route.ts: membership-gated POST mirroring api/reviews/ingest/route.ts — read the user,
    verify membership of body.shop_id (403 otherwise), then run classifyPendingSentiment with the
    SERVICE client scoped { shopId } and return { classified, skipped, failed }.
    Avoid: a CRON_SECRET-only or unauthenticated trigger; writing review_sentiment directly
    (go through classifyPendingSentiment); touching the classify-on-ingest cron wiring.
  </action>
  <verify>npx tsc --noEmit ; npx next build (route ƒ /api/reviews/classify present) ; manual: Classify now returns counts, badges render</verify>
  <done>AC-1 + AC-2 satisfied (per-review badges; membership-gated on-demand classify)</done>
</task>

<task type="auto">
  <name>Task 3: Dashboard sentiment panel + monthly report block</name>
  <files>src/app/dashboard/analytics/page.tsx, src/lib/report/types.ts, src/lib/report/report-data.ts, src/lib/report/render.ts, src/app/reports/[slug]/print/route.ts</files>
  <action>
    Dashboard (analytics/page.tsx): mirror the gbp_presence panel (~323). PER-SHOP ONLY — skip in
    scopeAll (an MSO cross-shop theme blend is noise, same rule as the presence rating). Call
    getReviewSentimentSummary(supabase, { shopId: activeShopId }); render polarity breakdown +
    actionableOpen + topThemes, with a scoped empty state when total = 0.

    Report: add a `SentimentReport` type + optional `sentiment?` on ReportData (types.ts); add an
    optional `readReviewSentiment?` reader dep + a buildSentiment mapper + additive assembly in
    report-data.ts (EXACT shape of the readMonthlyGbpPresence / buildGbpPresence pattern — absent
    reader/data => sentiment stays undefined); add a render block in render.ts AFTER the gbp
    presence block (~655), tabular, omitted when sentiment is undefined; bind the month-scoped
    reader in the print route (getReviewSentimentSummary with { shopId, month }) next to the
    gbp_presence binding.
    Avoid: touching narrative.ts / the eval gate / buildPlaceholders (print-path only, 12-05c
    precedent — a tabular block the writer never cites); calling rollupMonth (sentiment is not
    summable metric-class data).
  </action>
  <verify>npx tsc --noEmit ; npx vitest run ; npx next build</verify>
  <done>AC-3 + AC-4 satisfied (dashboard aggregate + report block, both graceful-degrading)</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Sentiment read surface: reviews-page badges + Classify-now, dashboard sentiment panel, monthly-report sentiment block.</what-built>
  <how-to-verify>
    1. Run the app against local Supabase (seeded) OR review on prod after deploy.
    2. /dashboard/reviews (Wallace): confirm polarity badges + actionable markers + themes; click
       "Classify now" and confirm counts return and badges populate.
    3. /dashboard/analytics (Wallace, single-shop): confirm the sentiment panel (breakdown + themes
       + actionable count); switch to All shops and confirm the panel is absent.
    4. Render a monthly report for a shop with sentiment and confirm the block appears; confirm a
       shop with none omits it cleanly.
  </how-to-verify>
  <resume-signal>Type "approved" to continue, or describe issues to fix</resume-signal>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- supabase/migrations/* and the review_sentiment table shape (LIVE on prod — no migration this plan)
- src/lib/reviews/sentiment.ts + sentiment-prompt.ts (the classifier + prompt are stable)
- src/lib/reviews/review-sentiment-sync.ts classify logic (only the OPTIONAL shopId filter is added)
- review_items table + the classify-on-ingest wiring in /api/cron/gbp-reviews-sync
- src/lib/report/narrative.ts + the eval gate + buildPlaceholders (print-path-only surface)

## SCOPE LIMITS
- NO low-confidence human-review / correction queue (that is 14-03c — write path + RLS write policy + audit)
- NO write to review_sentiment except via the existing classifyPendingSentiment
- NO new external API, NO new runtime dependency, NO prod write (deploy is a separate operator step)
- MSO/all-shops sentiment aggregate is out of scope (per-shop only, like gbp_presence)
</boundaries>

<verification>
Before declaring plan complete:
- [ ] npx tsc --noEmit → 0
- [ ] npx eslint (changed files) → 0/0
- [ ] npx vitest run → all pass (incl. new sentiment-summary tests)
- [ ] npx next build → green; ƒ /api/reviews/classify present; no new dep
- [ ] grep confirms: no migration added, review_sentiment/sentiment.ts/review_items untouched
- [ ] All acceptance criteria met (human-verify checkpoint approved)
</verification>

<success_criteria>
- Sentiment is visible on the reviews page, the analytics dashboard, and the monthly report
- Classify-now populates sentiment on demand for the active shop, membership-gated
- All gates green; zero new dependency; zero prod write; zero schema change
- The correction queue is cleanly deferred to 14-03c
</success_criteria>

<output>
After completion, create `.paul/phases/14-reviews-sentiment/14-03b-SUMMARY.md`
</output>
