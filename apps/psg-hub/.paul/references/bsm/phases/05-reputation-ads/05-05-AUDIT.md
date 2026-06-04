# Enterprise Plan Audit Report

**Plan:** .paul/phases/05-reputation-ads/05-05-PLAN.md
**Audited:** 2026-04-19
**Verdict:** Conditionally acceptable → enterprise-ready after upgrades applied

---

## 1. Executive Verdict

**Conditionally acceptable.** Plan is the final UI slice of Phase 5 — lower security risk than 05-03 + 05-04 but has a latent maintainability trap (hand-transcribed client template subset) and a cluster of a11y + UX polish gaps that would bite screen-reader users and multi-owner shops. Five release-blockers applied. Post-upgrade this plan closes Phase 5 with a coherent end-to-end ads experience.

Sign my name? Yes, post-upgrade. Original? No — a hand-copied template list with no drift detection is the sort of thing that breaks 4 months later when someone edits only one file and forgets the other.

---

## 2. What Is Solid (Do Not Change)

- **No new API routes.** Plan correctly consumes 05-03 routes.
- **Pure-function validation helpers.** Testable without jsdom; mirrors 05-04's pattern.
- **Modal a11y pattern referenced from 05-02.** Focus trap + ESC + return-focus is right.
- **Role gate via selectCampaignControls helper.** Avoids inlining role checks all over the UI.
- **Client-safe template module (concept).** Correctly flags that `server-only` imports must not leak to client.
- **No chart library.** Numbers-only metrics cards keep bundle small + ship faster.
- **Section renders conditionally on linked accounts.** Avoids showing empty campaigns UI when no account exists.

---

## 3. Enterprise Gaps / Latent Risks

1. **Template drift.** Hand-transcribed `CLIENT_CAMPAIGN_TEMPLATES` array is a timebomb. Someone adds a 4th template to the server-side file in 6 months, ships it, and the picker never shows it. No test catches this. Users think the new vertical isn't available.
2. **No aria-live for sync transient messages.** Sync status ("Synced 3 of 5 campaigns") is a status update that screen readers need announced; plain text in a div doesn't get announced.
3. **Metrics shape tolerance not tested.** `campaign.metrics` is jsonb defaulting to `{}` (from 05-03). If a campaign has never synced, `metrics.impressions` is `undefined`. Plan says "fall back to 0" but no test verifies; easy regression.
4. **Clickable row keyboard behavior ambiguous.** Plan mentions `tabIndex=0 + onKeyDown Enter/Space` — but Space scrolls the page by default unless `preventDefault()` is called. Without that, Space = page-scroll, not row-open. Subtle bug.
5. **Sync 207 error display uses template name.** Sync route's error shape is `{id, code, message}` where `id` is the campaign row id. User sees "camp-abc-123 failed" — opaque. Needs name lookup via local campaigns list.
6. **Stale data in detail modal.** User opens modal, coworker changes budget, user submits based on the old value. Plan has no stale-data warning. 05-03 doesn't use expectedVersion on campaigns (different pattern than review_responses). Risk is lower — budget delta guard catches gross changes — but UX confusing on minor edits.
7. **Budget input precision.** "$50.50" → `50.5 * 1_000_000 = 50_500_000` micros. JavaScript float math means $50.55 → 50_550_000.00000001 — clean for short decimals but any 3+ decimal input produces floating-point noise. Needs explicit validation to 2 decimals.
8. **No pagination.** 100+ campaigns render as a 100-row table. PSG's MVP won't hit this but the pattern is easy to establish now.
9. **Focus trap test coverage.** Plan's tests cover pure functions but not the Tab-cycle behavior.
10. **Delete confirm text.** `window.confirm("Delete campaign ...")` — user thinks it's gone forever, but in Google Ads the campaign moves to REMOVED status and history is retained. Copy should clarify so users understand they can't recover it but Google has a record.

---

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Template drift detection | Task 1 + Task 2 tests | Add test that imports the server-side `CAMPAIGN_TEMPLATES` (vitest already stubs `server-only`) AND the client `CLIENT_CAMPAIGN_TEMPLATES`, asserts same IDs + count + name/description match. Drift → red test. |
| 2 | aria-live on sync messages | Task 3 action (sync-button) | Message container gets `role="status" aria-live="polite"`. Error state within same container uses `role="alert"` inline when fatal. |
| 3 | Metrics shape tolerance | Task 2 tests + Task 3 action | Add tests for `readMetrics(campaign)` helper: handles `null`, `{}`, `{impressions: null}`, `{impressions: '5'}` (string-coerced) — returns 0 when absent. Helper added to campaigns-client.ts. |
| 4 | Clickable-row keyboard: preventDefault on Space | Task 3 action (campaigns-table) | `onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(c); } }}` — preventDefault stops page scroll. |
| 5 | Sync error maps to campaign name | Task 3 action (sync-button) + Task 2 helper | Error display receives campaigns array; looks up name by id; falls back to id prefix when name missing. Extract `formatSyncErrors(errors, campaigns)` pure helper + test. |

### Strongly Recommended

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Pagination soft-cap | Task 3 (campaigns-table) + Task 6 page action | Server page query adds `.limit(50)`; table renders a muted footer "Showing first 50 — contact support if you need more" when count ≥ 50. Defers real pagination UI but prevents rendering 500-row DOM. |
| 2 | Budget precision | Task 2 helper + Task 4 modal | `dollarsToMicros(dollars: number): number` rejects non-finite, <=0, and enforces 2-decimal precision via `Math.round(dollars * 100) * 10_000`. Test covers precision edge cases. |
| 3 | Stale-data hint in detail modal | Task 5 action | Modal shows "Loaded N seconds ago" hint; Refresh button triggers router.refresh(). Low-cost; high UX value. |
| 4 | Focus trap test | Task 6 test action | Extract focus-trap logic to a pure function `handleTabTrap(event, focusables)` returning a plan (`prevent: boolean`, `nextFocusIndex: number`); test exhaustively. Component uses it. |
| 5 | Delete confirm copy clarity | Task 5 action | `window.confirm("Delete campaign {name}? The campaign will be marked REMOVED in Google Ads and no longer appear in BSM. This cannot be undone.")` — explicit about what happens + finality. |

### Deferred (Can Safely Defer)

| # | Finding | Rationale for Deferral |
|---|---------|----------------------|
| 1 | Full chart library for metrics trends | Plan boundary. Numbers cards ship now; trend charts are a Phase 6 analytics concern. |
| 2 | Campaign filter / search | <50 campaigns per shop in MVP; filter belongs in a scale-focused plan. |
| 3 | Bulk actions (pause all, resume all) | Same scale argument; and bulk mutations deserve their own audit (quota amplification risk). |
| 4 | Stricter concurrency (expectedVersion for campaigns) | 05-03 chose budget-delta guard over version. Changing concurrency model is a 05-03 change, not a 05-05 change. |

---

## 5. Audit & Compliance Readiness

**Post-upgrade:**

- **Defensible audit evidence.** All state changes route through 05-03 APIs (which log to `ads_api_call_log`). 05-05 adds no new state or new mutation paths.
- **Silent failure prevention.** aria-live + inline error surfaces prevent "ghost" failures where the UI says nothing. Template drift test prevents the most common silent regression.
- **Screen reader support.** role="dialog" + role="status" + role="alert" cover the main interactions.
- **Ownership and accountability.** Role gate (selectCampaignControls) mirrors server-side enforcement; authoritative check remains server-side per 05-03.

**Residual risks:**

- Templates are hand-copied. Test catches drift in IDs/count/name but not nuanced drift (e.g., a default budget change). Acceptable — nuanced drift doesn't break functionality, just user expectation.
- No pagination UX beyond a 50-row soft cap. Caught by footer copy — user knows they're viewing a slice.
- Stale data in detail modal is mitigated by hint + refresh button + server's budget-delta guard. Full optimistic concurrency is a 05-03-scope change.

---

## 6. Final Release Bar

**Before this plan ships:**

- 6 tasks complete with tests green
- `cd dashboard && npm run build + npm run lint + npx vitest run` all green
- Manual keyboard walk of Create + Detail modals (Tab-trap, ESC, focus return)
- Manual screen-reader smoke test (NVDA or VoiceOver) on sync button state change
- Template drift test asserting IDs/count match between server + client modules

**Residual risks if shipped post-upgrade:**

- 50-campaign soft cap is a footer note, not a pagination UI. Acceptable for MVP.
- Stale detail-modal budget edits rely on server-side delta guard. Acceptable.
- Template drift beyond IDs/count/name (e.g., budget default change) silently propagates. Acceptable.

**Sign-off:** Yes, post-upgrade. This is the last plan in Phase 5. Shipping 05-05 closes the reputation + ads loop for paying customers.

---

**Summary:** Applied 5 must-have + 5 strongly-recommended upgrades. Deferred 4 items with documented rationale.
**Plan status:** Updated and ready for APPLY.

---
*Audit performed by PAUL Enterprise Audit Workflow*
*Audit template version: 1.0*
