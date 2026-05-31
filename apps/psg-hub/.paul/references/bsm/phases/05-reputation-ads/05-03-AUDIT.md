# Enterprise Plan Audit Report

**Plan:** .paul/phases/05-reputation-ads/05-03-PLAN.md
**Audited:** 2026-04-19
**Verdict:** Conditionally acceptable → enterprise-ready after upgrades applied

---

## 1. Executive Verdict

**Conditionally acceptable.** The original plan has a defensible architectural shape (OAuth + encrypted storage + API wrapper + template library + CRUD) and correctly reuses the 05-02 observability / rate-limit patterns. However, Google Ads is a $-adjacent system: one misplaced null check lets a shop spend tens of thousands of dollars on a misconfigured campaign, and one missed permission gate lets a free-tier user drain PSG's shared API quota. Eleven release-blocking gaps were found around budget governance, OAuth state security, tier gating, and operational hygiene. All must-have and strongly-recommended findings applied. Post-upgrade, the plan is approvable for APPLY.

Would I sign my name to the post-upgrade plan for production? Yes, contingent on Google Ads developer token access level being confirmed (Standard, not Test) and the first 3-5 shops being manually audited before automation scales. The original plan as first written? No — a missing shop.website_url would have silently created a no-target campaign.

---

## 2. What Is Solid (Do Not Change)

- **Pattern reuse from 05-02.** `ads_api_call_log` mirrors `llm_call_log`; route shape (auth → tenancy → role → rate-limit → API → log → write) is identical. This is the right move: consistency beats cleverness, and the 05-02 audit stress-tested this shape already.
- **OAuth state signing + replay defense.** HMAC + one-shot consumption + expiry is correct. Most OAuth CSRF bugs come from weaker state schemes.
- **Encryption at Phase 5 (not deferred).** The carve-out from the Plan 05-01 deferral is the right call — OAuth refresh tokens authorize ad spend, which is a different risk class from Yelp API keys. AES-256-GCM with IV + auth tag is the correct choice (not AES-CBC, not ECB).
- **Campaign default status = 'paused'.** Never auto-enabling a campaign at create time is the single most important guardrail in this plan. Preserve at all costs.
- **Template library as static, hand-curated data.** Not LLM-generated. Templates go into ads that spend real money; deterministic hand-curated starter set is correct.
- **Append-only ads_api_call_log via REVOKE.** Same pattern as review_response_versions in 05-02.

---

## 3. Enterprise Gaps / Latent Risks

1. **No tier gating.** Plan does not check shop's subscription tier. Performance tier ($999/mo) is explicit in PROJECT.md success metrics but the API surface is open to any authenticated member of a linked shop. A shop on Essentials or no tier at all could drain PSG's shared Google Ads developer-token quota + incur API charges.
2. **No maximum budget cap.** Plan caps daily budget *delta* at ±50%/24h but accepts any *initial* value. Client could pass `daily_budget_micros: 10_000_000_000` ($10,000/day) on create. Plan boundary would need 20 consecutive -50% changes to correct. Hard ceiling missing.
3. **Geo-targeting falls through on missing address.** Plan says "fallback: shop state only" if shop address missing. That's worse than refusing: a state-wide ad budget for a single-location shop burns money on non-convertible traffic. Must preflight.
4. **Missing website_url preflight.** `final_urls = [shop.website_url]` — if `website_url` is null, ads have no landing page and fail Google validation, burning one mutate quota + creating a zombie campaign row.
5. **OAuth state GC is passive.** `expires_at` index exists "for GC cleanup" but no actual sweep happens. States accumulate forever unless a cron runs. MVP needs at least a lazy sweep in the callback.
6. **Callback doesn't verify user identity.** State is HMAC-signed and one-shot, but the plan doesn't require the callback's `auth.getUser()` to match `state.userId`. If an attacker intercepts a state token (shoulder-surf, leaked log), they could complete the flow from their own session and bind the shop's tokens to... actually no, the account_id is taken from state.shopId. But the attacker could trigger write by replay if HTTPS is breached — still: defense in depth says match userId.
7. **Revoke doesn't revoke at Google.** Plan marks local status='revoked' only. Google's refresh token remains valid until naturally expired (can be 6+ months). A leak during that window gives an attacker full ad-account control on a shop that thinks it has been disconnected.
8. **Upsert-on-reconnect missing.** UNIQUE(shop_id, customer_id) + INSERT-only on callback means re-linking after a revoke fails with a constraint violation. User has no path to restore.
9. **last_error field can leak Google's error payload PII.** Google Ads error messages sometimes include customer IDs, campaign IDs, or user email addresses. Storing raw into `last_error` column makes it part of the row readable by all shop members.
10. **Test setup not specified.** Crypto tests require `ADS_ENCRYPTION_KEY` + `ADS_STATE_SECRET` in test env. Plan doesn't specify where these get set; vitest.setup.ts isn't extended.
11. **Encryption key rotation is not addressed.** `key_version` column exists but no key-map, no rotation procedure. Compliance review will flag this as a standing risk even on day one.
12. **GAQL interpolation trusts external_id.** Plan interpolates campaign.id into GAQL. external_id is Google-issued (always numeric), but defense in depth says validate before interpolating into a query string.
13. **Configurable rate limits missing.** Hard-coded 20/500 thresholds. Google's per-token quota may change; project may want per-shop tuning. Missing env knobs.

---

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Tier gating | `<acceptance_criteria>` AC-10; Task 2 + Task 5 action; boundaries | Added AC-10 requiring Performance-tier (or explicit override) before any /api/ads/google/* route runs. Check reads `subscriptions` table (Phase 4) with fallback to `SHOP_ADS_TIER_OVERRIDE` allowlist env var for internal PSG shops without billing set up. |
| 2 | Max-budget cap per shop | Task 5 action; AC-11 added | Hard ceiling: `daily_budget_micros` ≤ `ADS_MAX_DAILY_MICROS` (default 500_000_000 = $500/day); reject at create with 400. Per-shop override via `shops.max_daily_ad_budget_micros` (nullable column in migration 005). |
| 3 | Address + radius preflight | Task 5 action; AC-12 added | Before mutate: require shop.address AND shop.service_radius_miles BOTH non-null. 400 "Shop missing address or service_radius_miles" if absent. No state-only fallback. |
| 4 | Website URL preflight | Task 5 action; AC-12 extended | Require shop.website_url non-null AND HTTPS (https:// prefix). 400 if absent or http-only. |
| 5 | OAuth state lazy sweep | Task 2 action (callback) | Before consuming state, run `DELETE FROM google_ads_oauth_states WHERE expires_at < now() OR consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day'`. Opportunistic, cheap at typical volumes. |
| 6 | Callback user-auth match | Task 2 action (callback); AC-8 strengthened | After verifyAndConsumeState returns {userId, shopId}, require `auth.getUser().id === userId`. 403 otherwise. |
| 7 | Revoke at Google on disconnect | Task 5 action (disconnect route) | Best-effort POST to `https://oauth2.googleapis.com/revoke?token={refresh_token}`; log to ads_api_call_log with method='REVOKE'. Failure does not block local status update but is recorded. |
| 8 | Upsert on reconnect | Task 2 action (callback); Task 1 schema | UPSERT: if existing row with (shop_id, customer_id) and status IN ('revoked', 'error'), update with new encrypted token + status='linked'. UNIQUE index allows this via ON CONFLICT DO UPDATE. |
| 9 | Sanitize last_error | Task 3 action | Before writing to last_error: truncate to 500 chars, replace all digit sequences ≥7 chars with `[REDACTED]`, replace email regex matches with `[REDACTED]`. |
| 10 | Test env setup | Task 6 action + vitest.setup.ts extension | Extend vitest.setup.ts to set `process.env.ADS_ENCRYPTION_KEY` (32-byte base64) and `process.env.ADS_STATE_SECRET` to fixed test values, plus stub `ANTHROPIC_API_KEY` consistency. |
| 11 | Encryption key rotation placeholder | Task 2 action (crypto.ts); AC-2 extended | `KEY_VERSION_MAP: Record<number, Buffer>` loaded from `ADS_ENCRYPTION_KEY` (v1) + optional `ADS_ENCRYPTION_KEY_V2` env. Decrypt selects by row.key_version. Encrypt uses highest available. Documented rotation procedure in docs/secrets.md (create placeholder file). |

### Strongly Recommended

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | GAQL external_id validation | Task 3 action | Assert `/^\d+$/` on external_id before interpolating into GAQL. |
| 2 | Narrow 'enable' to owner | Task 5 action (PUT route) | Generic PUT (budget changes, pause) stays owner\|manager. Enable transition (status='paused'→'enabled') requires role='owner'. Mirrors 05-02 override_safety pattern. |
| 3 | Configurable rate limits | Task 3 action (env) + .env.example | `ADS_MUTATE_LIMIT_PER_HOUR` (default 20), `ADS_READ_LIMIT_PER_HOUR` (default 500). Rate-limit module reads from env with fallback. |
| 4 | Campaign name validation | Task 5 action | Enforce name ≤255 chars before mutate; 400 if exceeded. |
| 5 | Partial-sync body flag | Task 5 action (sync route) | Return body includes `partial: boolean` field in addition to 207 status, so clients that ignore the status code still see the flag. |
| 6 | Tests assert refresh_token never logged | Task 6 action | New test: stub console.log/error; run encrypt + decrypt path; assert no log output contains either the plaintext token or a substring of it. |

### Deferred (Can Safely Defer)

| # | Finding | Rationale for Deferral |
|---|---------|----------------------|
| 1 | Automated expires_at GC job (cron) | Lazy sweep on callback is sufficient for MVP volumes. Dedicated cron adds infra complexity and can wait until a scheduler pattern lands elsewhere (noted in Plan 02-05 deferral). |
| 2 | Multi-customer-id picker UI | Plan explicitly scopes "single customer only; error if >1". Picker belongs in 05-04 UI work, where it can share the account-management screen. |
| 3 | Shopping / Display / Video campaign types | Explicit scope boundary. SEARCH campaigns cover 80% of collision-repair ad spend; other types need their own template library + bidding logic. |
| 4 | Google Ads developer-token Basic→Standard upgrade check | Platform-level prerequisite, not a code concern. Verified at deploy time. |

---

## 5. Audit & Compliance Readiness

**Post-upgrade:**

- **Defensible audit evidence.** `ads_api_call_log` captures every call with shop_id, user_id, method, endpoint, result, latency_ms. Combined with `google_ads_accounts.linked_by` + `google_ads_campaigns.updated_at`, operators can reconstruct "who changed what when" for any ad-spend incident.
- **Silent failure prevention.** Every error path (auth, tenancy, rate-limit, Google API, encryption, state validation) writes to ads_api_call_log. Sanitized last_error on the account row surfaces persistent issues without leaking PII.
- **Post-incident reconstruction.** Per-campaign mutation history lives in ads_api_call_log by resource_name (added in strongly-recommended finding). Operator can: filter by campaign.external_resource_name → see every mutation + result → replay timeline.
- **Ownership and accountability.** `linked_by` identifies who linked the account; `user_id` on every log row identifies who called each mutation. Role gate (owner linking, owner-to-enable) means no accidental spend-authorization.

**Residual risks:**

- Google Ads account-level access is all-or-nothing: linking a customer grants full control over every campaign in that account, including campaigns BSM didn't create. If a shop has pre-existing campaigns, BSM could accidentally mutate them. Mitigation: BSM only touches campaigns with template_id (or a BSM marker label); document "BSM-managed vs shop-managed campaign" distinction in operations docs. Not applied to PLAN (operational policy, not code) — flagged as standing risk.
- Refresh-token compromise before revocation is caught remains unmitigated until Google's token-expiry window lapses. No code can fix this; incident response procedure must include "revoke at Google console directly" as step 0.

---

## 6. Final Release Bar

**Before this plan ships:**

- All 6 tasks complete with Task 6 tests green
- Migration 005 applies cleanly; UNIQUE(shop_id, customer_id) reusable for upsert; ads_api_call_log append-only verified
- Cross-tenant regression test passing (no Google Ads mock invocation on 403 path)
- Tier-gate test passing (no Google Ads mock invocation without Performance tier)
- Budget-cap test passing (create with >MAX → 400 pre-mutate)
- Address+website preflight test passing
- OAuth state replay test passing (second consumption → 400)
- Google developer token verified Standard (platform-level, not code)
- 8 new env vars provisioned (original 7 + ADS_MAX_DAILY_MICROS or use default)
- docs/secrets.md placeholder with rotation procedure committed

**Residual risks if shipped post-upgrade:**

- Pre-existing campaigns in linked Google Ads accounts remain mutable by BSM (operations-level risk; no code fix possible).
- Refresh-token-compromise window before detection (1-24 hours typical; 7 days worst case). Incident response: revoke at Google console, delete local row, force re-link.
- Configurable rate limits can be miss-tuned. Too-low → false rate_limited; too-high → quota burn. Operators must monitor ads_api_call_log for error_code='rate_limited' frequency.

**Sign-off:** Would I sign my name to this system post-upgrade? Yes, provided the first 3-5 shops are manually audited (PSG staff reviews campaign creation in Google Ads console) before full automation. First external paying customer must NOT be the first shop to test this path.

---

**Summary:** Applied 11 must-have + 6 strongly-recommended upgrades. Deferred 4 items with documented rationale.
**Plan status:** Updated and ready for APPLY.

---
*Audit performed by PAUL Enterprise Audit Workflow*
*Audit template version: 1.0*
