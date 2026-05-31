# Enterprise Plan Audit Report

**Plan:** .paul/phases/05-reputation-ads/05-04-PLAN.md
**Audited:** 2026-04-19
**Verdict:** Conditionally acceptable → enterprise-ready after upgrades applied

---

## 1. Executive Verdict

**Conditionally acceptable.** This plan is UI + billing glue — lower-risk than 05-03, but the async-Stripe-to-tier-gate race and the popup-based OAuth flow have classic UX failure modes that frustrate paying customers on the exact path where BSM collects revenue. Five release-blocking gaps found; all applied. Post-upgrade the plan ships a self-serve upgrade → link → ready path without the 402-flash-after-upgrade failure that plagues most tier-gated SaaS products.

Would I sign my name to the post-upgrade plan? Yes. The original? No — the post-Stripe-checkout tier race would confuse the first paying customer, and missing popup-blocker detection would stall the next five.

---

## 2. What Is Solid (Do Not Change)

- **No new API routes.** Plan correctly consumes 05-03 routes; avoids scope creep + keeps security surface frozen.
- **Tier gate at page level, not middleware.** Simpler to reason about, reuses existing `assertAdsTier` logic.
- **Sidebar link visible to all.** Good — drives upgrade visibility.
- **Role-based Link/Disconnect controls.** Matches 05-02 + 05-03 pattern.
- **Existing Stripe checkout route extended, not replaced.** Webhook handler already writes `subscriptions.tier` from metadata — enum extension in 05-03 makes this automatic.
- **PSG voice + uncodixfy constraints called out explicitly.**
- **Anchor `#performance` on billing card for deep-link from tier-gate CTA.**

---

## 3. Enterprise Gaps / Latent Risks

1. **Post-upgrade tier race.** Stripe Checkout success_url returns the user to `/dashboard/billing?success=true` before the webhook has processed the new subscription. User clicks "Ads" → tier gate still shows → they think upgrade failed → they contact support. Plan has no grace handling.
2. **Popup blocker.** `window.open` returns `null` when blocked (Safari default, Chrome with some extensions). Plan doesn't detect this. User sees button, nothing happens, no signal.
3. **Polling has no cleanup.** 3s interval over 5 min = ~100 requests. If user navigates away while polling is active, the interval keeps firing (memory leak, wasted API quota). Plan doesn't call out `useEffect` cleanup.
4. **Missing env var validation.** `process.env.STRIPE_PERFORMANCE_PRICE_ID!` with the TS non-null assertion compiles fine, but at runtime passes `undefined` to Stripe → opaque Stripe error. User sees a 500; operator can't diagnose.
5. **Snapshot-less polling.** Plan polls accounts list every 3s after clicking Link. If the account was already there (from a prior link attempt or test), the poller falsely "detects" a new link immediately. Need to snapshot account IDs before opening popup and detect a genuinely new one.
6. **No postMessage handshake.** Polling works but takes up to 3 seconds to detect completion. Callback page can `postMessage` to the opener, delivering instant signal. Polling stays as fallback.
7. **Multi-shop user path undefined.** Plan says "fall back to user's first membership (existing pattern)". If that pattern doesn't exist yet or returns the wrong shop, `/ads` shows a confusing state. Needs explicit handling.
8. **TierGateCard button accessibility.** Plan mentions uncodixfy styling but not focus-visible / semantic `<button>` / keyboard navigation.
9. **No test for grace state.** Plan's test task doesn't cover the Stripe-return-with-?success=true flow.
10. **Plan assumes existing webhook handler writes `tier` from `metadata.tier`.** If the handler has an allowlist that excludes 'performance', the 05-03 enum addition doesn't help. Plan doesn't verify.

---

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Popup-blocker detection | Task 4 (link-account-button) + AC-5 strengthened | If `window.open` returns null, render inline error "Your browser blocked the popup. [Open in new tab]" with anchor-tag fallback to the same URL. Disable poller until popup opens successfully. |
| 2 | Polling cleanup | Task 4 action | useEffect cleanup clears interval + stops polling on unmount. Plan explicitly calls out `let cancelled = false` pattern with ref guard to prevent state updates after unmount. |
| 3 | Env var validation | Task 1 action + AC-1 extended | Checkout route: guard `if (!process.env.STRIPE_PERFORMANCE_PRICE_ID)` → return 500 with message "Performance price not configured"; log to server. Test asserts the guard. |
| 4 | Post-upgrade grace state | Task 2 action + new AC-9 | `/dashboard/billing?success=true` shows a processing banner. Client-side component polls `/api/billing/subscription-status?shop_id=X` (NOTE: this tiny endpoint is EXCLUDED from 05-04 scope — the plan's boundary was "no new API routes", so we use a server-rendered refresh via `router.refresh()` every 5s for up to 60s instead). Banner disappears once `subscriptions.tier === 'performance'` OR after 60s w/ fallback message "Refresh the page in a minute." |
| 5 | Snapshot-and-diff polling | Task 4 action + AC-5 strengthened | Before opening popup, capture `Set<customer_id>` of existing accounts. Polling compares current set against snapshot — detects NEW ids only. Stops when new linked account appears OR popup closes OR 5-min timeout. |

### Strongly Recommended

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | postMessage handshake | Task 4 action + docs note | Client registers `window.addEventListener('message', ...)` filtered by origin. Callback HTML (in 05-03) can be extended in a follow-up to postMessage on success. For now: poller is primary, postMessage is forward-compat stub. Add comment at callback handler in 05-03 pointing to 05-04's listener. |
| 2 | Webhook handler verification | Task 1 verify step + new sub-check | `cd dashboard && cat src/app/api/webhooks/stripe/route.ts | grep -E "tier|performance"` — ensure no hardcoded allowlist excluding 'performance'. If present, flag in SUMMARY as a blocker (not this plan's fix). |
| 3 | Accessibility on TierGateCard + LinkAccountButton | Task 3 + Task 4 actions | Semantic `<button>` (not `<div onClick>`); focus-visible ring via existing token; keyboard-activatable; aria-label on icon-only actions. |
| 4 | Multi-shop fallback handling | Task 3 action | When user has >1 memberships and no `?shop_id` query param, redirect to `/ads?shop_id=<first-owner-membership>` (owners first) or to `/dashboard` if no memberships. Document the shop-selection heuristic in code comment. |
| 5 | Grace state test | Task 5 action (new test case) | Pure function test: `shouldShowUpgradeBanner({ justReturned: true, subTier, elapsedMs })` — returns true for first 60s after return unless sub already = 'performance'. |

### Deferred (Can Safely Defer)

| # | Finding | Rationale for Deferral |
|---|---------|----------------------|
| 1 | Replace native confirm with custom modal for disconnect | Native confirm is accessible + universally understood; custom modal work belongs in a dedicated UI-polish plan post-05-05. |
| 2 | Conversion / analytics tracking (mixpanel / amplitude) | Out of phase scope; belongs in Phase 6 analytics work. |
| 3 | Multi-shop picker UI in sidebar | Acknowledged limitation. Existing "first membership" fallback is good enough for MVP — PSG team is the primary user until 05-05+ launch. |
| 4 | Custom toast library for disconnect errors / success | Inline error text is sufficient; toast adds a dep without MVP value. |

---

## 5. Audit & Compliance Readiness

**Post-upgrade:**

- **Defensible audit evidence.** All state changes land through 05-03 routes (which log to `ads_api_call_log`) or Stripe webhooks (which write to `subscriptions`). No 05-04 state is persisted outside these two audited paths.
- **Silent failure prevention.** Popup-blocker, env-missing, and polling-timeout paths all surface user-visible messages. Error boundaries on the page protect against component crashes.
- **Post-incident reconstruction.** If a shop reports "I upgraded but can't link my ad account", operators can: check `subscriptions` for tier/status, check `google_ads_oauth_states` for un-consumed states, check `google_ads_accounts` for stale status='error' rows. All data surfaces exist from 05-03.
- **Ownership and accountability.** Role gate is UI-level on 05-04 (Link/Disconnect visible to owners); the authoritative enforcement remains server-side in 05-03 routes.

**Residual risks:**

- Stripe webhook delivery is at-least-once with ~1s typical latency, but SLA is "within 48 hours." A 48-hour webhook delay would leave the user in grace state permanently. Not mitigated here; acceptable for launch because Stripe's 99.99th percentile is seconds, not hours. Document for ops.
- Users who close the checkout browser tab after paying but before redirect may not land on the success URL. Subscription still activates via webhook, but they don't see the grace banner. Next visit to `/dashboard/billing` shows "Current plan: Performance". Acceptable.
- A malicious browser extension could stub `window.open` to return a fake popup object. The poller still won't detect a linked account (polling hits real API with server-side auth) — worst case is a 5-min timeout. No security risk, just UX.

---

## 6. Final Release Bar

**Before this plan ships:**

- All 5 tasks complete with Task 5 tests green
- `STRIPE_PERFORMANCE_PRICE_ID` provisioned (real Stripe price)
- Stripe webhook handler verified to accept 'performance' tier from metadata (Strongly-Recommended #2 check)
- Sidebar link renders; /ads route renders correctly across 3 tier/role states
- Popup-blocker fallback tested manually in Safari
- Grace banner tested by walking the full upgrade flow in Stripe test mode

**Residual risks if shipped post-upgrade:**

- Webhook delivery latency beyond 60s leaves user with stale "processing" state; documented fallback in banner text tells them to refresh.
- Multi-shop users default to first-membership shop; not obvious which one. Acceptable for MVP (PSG internal shops all single-site).
- Users on ancient browsers without `fetch` / `postMessage` hit issues, but those users aren't our market (collision shop owners on recent iOS / Chrome).

**Sign-off:** Yes, post-upgrade. Plan 05-04 + 05-05 together complete Phase 5; this plan is the payments gate and 05-05 is the value surface. Both must ship before external paying customers.

---

**Summary:** Applied 5 must-have + 5 strongly-recommended upgrades. Deferred 4 items with documented rationale.
**Plan status:** Updated and ready for APPLY.

---
*Audit performed by PAUL Enterprise Audit Workflow*
*Audit template version: 1.0*
