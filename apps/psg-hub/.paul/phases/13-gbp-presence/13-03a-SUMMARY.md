---
phase: 13-gbp-presence
plan: 03a
completed: 2026-06-15T00:00:00Z
duration: ~1 session
---

# Phase 13 Plan 03a: GBP presence foundation — Summary

**The schema, types, read-path seam, and report data block for the monthly GBP presence + star-rating snapshot are in place — a third CHECK-widening migration admits `'gbp_presence'`, `GbpPresenceMetrics` types the row (location state + nullable `average_rating`/`total_review_count`), `getLinkedAccount` now returns `external_parent_id` (the one read-side blocker the v4 reviews call needs), and `ReportData.gbpPresence?` assembles off a monthly reader exactly like `performance?` — all LOCAL, tsc/test-proven, ZERO prod, with no `AnalyticsSource` union pollution.**

## Objective

The foundation half of the 13-03 monthly presence + rating split (mirrors 13-02a). 13-03b is the ingest vertical (Business-Info `locations.get` presence fetch + the v4 raw-HTTP rating aggregate + a monthly orchestrator + cron + surface + e2e). `'gbp_presence'` is point-in-time STOCK, so by the codebase's FLOW-vs-STOCK rule it stays a `SnapshotSource`-only value (mirroring `performance`/`ga4_dimensions`) and must NOT enter the `AnalyticsSource` union; the lifetime star rating rides ON the same `gbp_presence` row jsonb (13-03-RESEARCH §Data-model).

## Skill audit

All required flows satisfied ✓. Research-first (phase): `13-RESEARCH.md` §Data-model. Per-plan: `13-03-RESEARCH.md` (the focused ultracode Workflow `wf_0906aaba-c3b` output) settled the two foundation decisions — the `getLinkedAccount` external_parent_id read-side seam fix (write side already done at 13-01) and the rating-on-the-`gbp_presence`-row data model. No external API surface is touched in 13-03a (the Business-Info `locations.get` + the v4 reviews `.request` are 13-03b), so no APPLY-time contract introspection was required — correctly, not a gap.

## What Was Built

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260615123218_gbp_presence_source.sql` | NEW | 3rd CHECK-widen: both source CHECKs admit `'gbp_presence'` (full prior set), mirror of 20260614202719; LOCAL-applied only |
| `src/lib/analytics/types.ts` | EDIT | `SnapshotSource += 'gbp_presence'` (AnalyticsSource UNCHANGED); NEW `GbpPresenceMetrics` (location state + `average_rating`/`total_review_count` nullable, STOCK monthly) |
| `src/lib/google-oauth/accounts.ts` | EDIT | `getLinkedAccount`: select + return `external_parent_id`; `LinkedAccount += externalParentId: string | null` (generic — null for ga4/gsc) |
| `src/lib/google-oauth/__tests__/accounts.test.ts` | EDIT | +externalParentId returned ('accounts/{id}' for gbp, null for ga4); existing exact-shape `toEqual` updated |
| `src/lib/report/types.ts` | EDIT | NEW `GbpPresenceReport` + `ReportData.gbpPresence?` (additive, parallel to `performance?`) |
| `src/lib/report/report-data.ts` | EDIT | `MonthlyGbpPresenceReader` + `buildGbpPresence` (rollup-bypassing snake→camel) + `AssembleDeps.readMonthlyGbpPresence?` + additive `gbpPresence?` spread |
| `src/lib/report/__tests__/report-data.test.ts` | EDIT | +gbpPresence present (rating + completenessScore mapped) / +rating-null when absent |
| `src/lib/google-oauth/__tests__/gbp-sync.test.ts` | EDIT (fix) | latent 13-02b tsc/hoist regression repaired (see Deviations) |

## Acceptance Criteria Results

| AC | Description | Status |
|----|-------------|--------|
| AC-1 | 3rd CHECK-widen migration — both CHECKs admit `'gbp_presence'` (full set), LOCAL-verified, NOT a union member | ✅ PASS |
| AC-2 | `GbpPresenceMetrics` type + `SnapshotSource += 'gbp_presence'`; `AnalyticsSource` unchanged | ✅ PASS |
| AC-3 | `getLinkedAccount` returns `external_parent_id` (generic, null for ga4/gsc, callers unaffected, tested) | ✅ PASS |
| AC-4 | `ReportData.gbpPresence?` additive rollup-bypassing block (mirror of `performance?`), present/absent + rating-null tested | ✅ PASS |
| AC-5 | Boundaries — no ingest/fetch/cron/render/dashboard; `'gbp_presence'` NOT in the union; report narrative/eval untouched; zero prod | ✅ PASS |

## Verification Results

- `tsc --noEmit` → exit 0
- `supabase db reset` → exit 0 (new migration applied last); psql via `docker exec supabase_db_psg-hub`: BOTH source CHECKs admit `'gbp_presence'`; a `'gbp_presence'` `analytics_sync_runs` insert ACCEPTED, a bogus source REJECTED ("violates check constraint"); auto-named sync_runs constraint resolved to the standard name
- `vitest run` → **625/625** (622 prior + 3 new: 1 accounts + 2 report-data)
- `eslint` (changed files) → exit 0, **0 errors / 0 warnings**
- `pnpm build` → ✓ (NO new dep — package.json/pnpm-lock unchanged)

## Deviations

- **Latent 13-02b regression fixed (in-scope correction).** The committed `b9a9cba` `gbp-sync.test.ts` carried a TS2556: the 13-02b eslint cleanup changed `markErrorMock` to zero-arg while a `(...a) => markErrorMock(...a)` spread wrapper remained. vitest/esbuild never type-checks, so it shipped green at runtime but broke `tsc`. The first 13-03a `tsc` caught it. An initial fix (`markAccountError: markErrorMock` direct) then hit a vitest hoist error (`ReferenceError: Cannot access 'markErrorMock' before initialization` — the `vi.mock` factory is hoisted above the `const`). Final fix restores the shipped gsc-sync.test pattern (rest-param mock + wrapper arrow, which keeps the reference lazy for the hoisted factory) plus an `eslint-disable-next-line` for the intentional unused rest param → tsc-clean, vitest-clean, eslint-clean. **`main`@b9a9cba fails `tsc` until the next push carries this fix.**

## Key Patterns / Decisions

- `'gbp_presence'` is `SnapshotSource`-only (STOCK), never the `AnalyticsSource` union — the same rule that kept `performance`/`ga4_dimensions` out. Forcing it in would fabricate a fake daily rollup on a point-in-time average.
- The star rating lives ON the `gbp_presence` row jsonb (`average_rating`/`total_review_count`), not a sibling source — it shares the presence row's grain, read path (`getMonthlySnapshot`), and write cadence (one orchestrator run). Both rating fields are `number | null` because the orchestrator (13-03b) will write the presence row even when the v4 call fails or the location is unverified.
- `getLinkedAccount` widened generically (one reader serves ga4/gsc/gbp; the field is simply null for the first two) — the additive `externalParentId` field does not break the existing `{accountId, externalAccountId, refreshToken}` destructures.
- `ReportData.gbpPresence?` is an exact structural mirror of the `performance?` additive path: a `getMonthlySnapshot`-bound reader, a `rollupMonth`-bypassing `build*`, and a spread that omits the block when no reader/row exists.

## Next Phase

Phase 13 = 2 of 4(→5) plans complete in logical terms (13-01 OAuth foundation ✅ + 13-02 daily insights ✅; 13-03 presence is now foundation-done, ingest pending). NO phase transition — the 4(→5)-plan split is truth, not the file count (after this SUMMARY the dir shows 4 PLAN = 4 SUMMARY, which would falsely trigger; overridden, same call as 11-01/12-01/13-01/13-02a). Remaining: **13-03b** presence + rating ingest (Business-Info `locations.get` + v4 raw-HTTP `fetchGbpReviewsAggregate` via `buildOAuth2Client(...).request` + monthly `gbp-presence-sync` orchestrator + cron `0 4 1` + vercel.json 9th cron + render/dashboard surface + e2e) · **13-04** prod activation gate batch.

**Deferred to 13-04 live smoke (from 13-03-RESEARCH):** (a) `pageSize:1` returns the v4 aggregate; (b) the non-VoM / non-verified `reviews.list` response shape; (c) the StarRating enum value set (only if Phase 14 needs per-review mapping).

**⚠️ Still on the clock (operator, NOT waiting for 13-04):** Gate A GBP API access (covers Performance AND v4 reviews; legacy "Google My Business API" needs separate ENABLEMENT), Gate B `business.manage` verification, and revoke the chat-pasted GCP key (26cd29f).

NEXT: `/paul:plan 13-03b`.

---
*Completed: 2026-06-15*
