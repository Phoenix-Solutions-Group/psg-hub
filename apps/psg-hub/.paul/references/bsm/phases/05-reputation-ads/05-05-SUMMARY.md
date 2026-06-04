---
phase: 05-reputation-ads
plan: 05
subsystem: ads-campaigns-ui
tags:
  - campaigns-ui
  - modal-a11y
  - pure-helpers
  - drift-detection
  - vitest

requires:
  - phase: 05-reputation-ads
    provides: 05-03 campaign routes + templates; 05-04 ads scaffold + tier gate
provides:
  - CampaignsSection plugged below AccountsTable on /ads
  - CampaignsTable with keyboard-accessible rows (Enter + Space preventDefault)
  - CreateCampaignModal + CampaignDetailModal with shared focus-trap helper
  - MetricsSummary (4 plain cards, tolerant of empty/partial metrics)
  - SyncButton with aria-live status + name-mapped error display
  - Client-safe template subset with drift-detection test (server/client ID + count + name + description + shape parity)
  - Pure helpers: validateCampaignCreate + validateBudgetDelta + selectCampaignControls + formatMicrosAsUsd + dollarsToMicros + readMetrics + formatSyncErrors + handleTabTrap
  - 43 new tests (136 total)
affects:
  - Future reviews/content UI can reuse handleTabTrap + modal a11y pattern
  - Phase 6 (analytics) can extend MetricsSummary w/ chart library later

tech-stack:
  added: []
  patterns:
    - "Client-safe module pattern: hand-transcribed subset + drift test against server-only module"
    - "Pure-function helpers for validation/formatting — jsdom-free testing"
    - "Shared focus-trap helper across modals (createCampaign + detail)"
    - "Clickable row pattern: tabIndex=0 + Enter/Space + preventDefault(Space)"
    - "aria-live='polite' + aria-role swap ('status' vs 'alert') on sync button"

key-files:
  created:
    - dashboard/src/app/(dashboard)/ads/campaigns-section.tsx
    - dashboard/src/app/(dashboard)/ads/campaigns-table.tsx
    - dashboard/src/app/(dashboard)/ads/create-campaign-modal.tsx
    - dashboard/src/app/(dashboard)/ads/campaign-detail-modal.tsx
    - dashboard/src/app/(dashboard)/ads/metrics-summary.tsx
    - dashboard/src/app/(dashboard)/ads/sync-button.tsx
    - dashboard/src/lib/ads/campaigns-client.ts
    - dashboard/src/lib/ads/campaign-templates.ts
    - dashboard/src/lib/ads/focus-trap.ts
    - dashboard/src/lib/ads/__tests__/campaigns-client.test.ts
    - dashboard/src/lib/ads/__tests__/focus-trap.test.ts
    - dashboard/src/lib/ads/__tests__/campaign-templates-drift.test.ts
  modified:
    - dashboard/src/app/(dashboard)/ads/page.tsx

key-decisions:
  - "Dropped 'Loaded N seconds ago' hint — React 19 refs-during-render rule conflicts cleanly. Last-sync timestamp + Refresh button cover the spec intent."
  - "Soft-cap pagination via .limit(50) on server query + footer note. Full pagination UI deferred to scale-focused plan."
  - "Mock at business-logic layer for route-level concerns (done in 05-03); pure-function tests cover new 05-05 helpers without jsdom."

patterns-established:
  - "Hand-transcribed client subset + drift test: OK for small, stable sets (3 items). Convert to build-time codegen if set grows."
  - "Modal a11y checklist: role=dialog + aria-modal + aria-labelledby + focus trap helper + ESC + return focus."
  - "Tabular keyboard: row tabIndex=0 + handler preventDefault(Space) so Space triggers row action, not page scroll."

duration: ~40min
started: 2026-04-19T19:30:00Z
completed: 2026-04-19T19:50:00Z
---

# Phase 5 Plan 05: Campaigns UI Summary

**Campaigns table + Create/Detail modals + Metrics + Sync now plugged into /ads below AccountsTable. Shop members can create from template, pause/enable/edit-budget/delete per campaign, sync metrics. Role gates match server. 9/9 post-audit ACs green at code level; 136/136 tests pass.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~40min |
| Tasks | 6 of 6 completed |
| Files created | 12 |
| Files modified | 1 |
| Tests passing | 136 / 136 (43 new) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Section renders when account linked | Pass | Conditional render in page; empty state has create button for owner/manager |
| AC-2: Create from template w/ preflight | Pass | Precision guard (dollarsToMicros) + missing[] surface |
| AC-3: Detail modal pause/enable/budget/delete | Pass | selectCampaignControls + clear delete confirm copy |
| AC-4: Sync w/ aria-live + name mapping | Pass | formatSyncErrors maps id→campaign.name; role swap status↔alert |
| AC-5: Metrics summary tolerates shapes | Pass | readMetrics: {}, null, partial, string-coerced all return zeros |
| AC-6: Client-safe template subset | Pass | No server-only import; drift test red-fails on mismatch |
| AC-7: Tests cover every branch | Pass | 26 campaigns-client + 6 focus-trap + 3 drift + 8 other |
| AC-8: a11y + uncodixfy | Pass | Modal roles + focus trap + ESC; clickable-row Space preventDefault |
| AC-9: Soft-cap footer @ 50 | Pass | Server query .limit(50); footer copy at ≥50 rows |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Dropped "Loaded N seconds ago" hint — React 19 refs-during-render + set-state-in-effect rules. Refresh button + last-sync copy cover spec intent. |
| Scope clarifications | 0 | — |
| Deferred | 4 | All AUDIT deferrals carried (chart lib, filter/search, bulk actions, optimistic concurrency) |

## Skill Audit (05-05)

| Expected | Invoked | Notes |
|----------|---------|-------|
| /uncodixfy | ✓ | Plain table/modals, no glassmorphism, no pills |
| /frontend-design | ✓ | Existing primitives (Table/Button/Badge/Card) + shared focus-trap |
| /humanizer | ✓ | Active voice copy; delete confirm clarifies REMOVED + irreversibility |
| /brand | ✓ | Clarity Teal reserved for Create + Enable CTAs |

Status: All 4 required skills invoked ✓.

## Phase 5 Status

**Phase 5 COMPLETE** pending transition (commits + PROJECT.md + ROADMAP.md updates). All 5 plans closed:
- 05-01: Review ingestion ✓
- 05-02: AI review response generation ✓
- 05-03: Google Ads API integration ✓
- 05-04: Performance tier billing + ads scaffold ✓
- 05-05: Campaigns UI ✓

## Next Phase Readiness

**Ready:** Phase 6 (Email/SMS + analytics) — inherits rate-limit + api_call_log pattern + tier gate pattern + modal a11y pattern.

**Runtime verify blocked on (Phase 5 overall):** Supabase project link + all migrations applied + 15+ env vars (Supabase service key, Yelp, Places, Anthropic, 7 Google Ads, encryption keys, 3 Stripe prices) + Google Cloud OAuth app + developer token (Standard) + MCC + Performance-tier subscription per shop.

---
*Phase: 05-reputation-ads, Plan: 05*
*Completed: 2026-04-19*
