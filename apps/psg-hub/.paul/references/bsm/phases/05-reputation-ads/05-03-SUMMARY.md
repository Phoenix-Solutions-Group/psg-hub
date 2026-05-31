---
phase: 05-reputation-ads
plan: 03
subsystem: ads-integration
tags:
  - google-ads-api
  - oauth2
  - aes-256-gcm
  - encryption-at-rest
  - rate-limiting
  - tier-gating
  - rls
  - vitest
  - nextjs-16

requires:
  - phase: 05-reputation-ads
    provides: ads_api_call_log pattern mirror of llm_call_log (05-02), service-role client, vitest harness
  - phase: 04-customer-facing-mvp
    provides: subscriptions + billing_tier enum, shop_role + get_user_shop_ids(), shops base schema
provides:
  - google_ads_accounts + google_ads_campaigns + google_ads_oauth_states + ads_api_call_log tables
  - billing_tier extended with 'performance'
  - shops.max_daily_ad_budget_micros + shops.service_radius_miles columns
  - Per-shop OAuth 2.0 flow w/ encrypted refresh tokens (AES-256-GCM)
  - Key rotation map (v1..v10 slots)
  - Google Ads API v20 client wrapper w/ rate-limit + logging + GAQL id validation
  - Tier gate module (Performance subscription OR SHOP_ADS_TIER_OVERRIDE)
  - Starter template library (storm-damage, insurance-approved, oem-certified)
  - 7 API routes w/ role + preflight + budget ceiling + state-machine enforcement
  - sanitize.ts PII-redaction helper
  - docs/secrets.md rotation procedure
  - 53 new tests (80 total in dashboard)
affects:
  - 05-04 (Ads dashboard UI) — consumes accounts + campaigns + sync endpoints
  - Phase 6 (Email/SMS) — reuses rate-limit + api_call_log pattern
  - Future OAuth integrations — crypto + key-version map pattern

tech-stack:
  added:
    - google-ads-api ^23.0.0 (dependency)
  patterns:
    - "Two-tier trust: explicit role + tier + tenancy + preflight all gate BEFORE upstream calls"
    - "Append-only audit via REVOKE UPDATE/DELETE on api_call_log tables"
    - "OAuth callback binds state.userId to auth.uid() — defense-in-depth on state interception"
    - "Lazy state-token GC on callback (no cron needed at MVP volumes)"
    - "UPSERT on (shop_id, customer_id) enables reconnect-after-revoke without constraint violations"
    - "Budget governance: cap pre-mutate, delta cap ±50%/24h, first-enable owner-only"
    - "Test-mock at business-logic layer (campaigns.ts) rather than library layer (google-ads-api) for faster + more reliable integration tests"

key-files:
  created:
    - supabase/migrations/005_google_ads.sql
    - dashboard/src/lib/google-ads/crypto.ts
    - dashboard/src/lib/google-ads/sanitize.ts
    - dashboard/src/lib/google-ads/oauth.ts
    - dashboard/src/lib/google-ads/tier.ts
    - dashboard/src/lib/google-ads/types.ts
    - dashboard/src/lib/google-ads/client.ts
    - dashboard/src/lib/google-ads/templates.ts
    - dashboard/src/lib/google-ads/campaigns.ts
    - dashboard/src/app/api/ads/google/authorize/route.ts
    - dashboard/src/app/api/ads/google/callback/route.ts
    - dashboard/src/app/api/ads/google/accounts/route.ts
    - dashboard/src/app/api/ads/google/accounts/[id]/disconnect/route.ts
    - dashboard/src/app/api/ads/google/campaigns/route.ts
    - dashboard/src/app/api/ads/google/campaigns/[id]/route.ts
    - dashboard/src/app/api/ads/google/campaigns/sync/route.ts
    - dashboard/src/lib/google-ads/__tests__/crypto.test.ts
    - dashboard/src/lib/google-ads/__tests__/sanitize.test.ts
    - dashboard/src/lib/google-ads/__tests__/templates.test.ts
    - dashboard/src/lib/google-ads/__tests__/oauth.test.ts
    - dashboard/src/lib/google-ads/__tests__/tier.test.ts
    - dashboard/src/app/api/ads/google/__tests__/routes.test.ts
    - docs/secrets.md
  modified:
    - dashboard/.env.example
    - dashboard/vitest.setup.ts
    - dashboard/package.json

key-decisions:
  - "Extend billing_tier enum (not new enum) for Performance tier. Keeps billing subsystem cohesive."
  - "Add service_radius_miles column in 005 (not a prior migration). Tied to first use case (ads geo-targeting)."
  - "Lazy state-token GC on every callback instead of scheduled cron. Cheap at MVP volumes; defer dedicated scheduler."
  - "Mock campaigns.ts in route tests, not google-ads-api. Crypto + rate-limit get their own tests; route tests stay focused on route behavior."
  - "last_error storage column (not separate audit table). Single error string per account; forensic history lives in ads_api_call_log."
  - "revokeAtGoogle is best-effort (doesn't block local status flip). Local revocation is the contract; Google-side is opportunistic hygiene."

patterns-established:
  - "OAuth callback shape: verify-and-consume state → auth-bind → exchange → listAccessibleCustomers → UPSERT → HTML success/error page"
  - "Route shape: auth → tenancy → tier gate → role gate → preflight → budget cap → rate-limit → upstream call → log → write"
  - "Test mock hierarchy: mock at business-logic module (campaigns.ts, oauth.ts) — not at library (google-ads-api) or network (fetch)"
  - "Audit-trail: api_call_log table per subsystem (llm_call_log, ads_api_call_log). REVOKE UPDATE/DELETE on both. Cross-subsystem reuse stays at the pattern level, not the table level."
  - "PII-redact sanitizer at the boundary between upstream error and DB write. Never store Google's raw error strings."

duration: ~95min
started: 2026-04-19T16:30:00Z
completed: 2026-04-19T18:05:00Z
---

# Phase 5 Plan 03: Google Ads API backend Summary

**Backend-only Google Ads integration end-to-end: OAuth link + encrypted storage + API wrapper + template library + 7 routes with tier/role/preflight/budget gates, all logged. 12/12 ACs green at code level, 80/80 tests pass. 5 skills invoked. UI ships in 05-04. Runtime verify blocked on 11 env vars and Performance tier activation in Stripe.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~95min |
| Started | 2026-04-19T16:30:00Z |
| Completed | 2026-04-19T18:05:00Z |
| Tasks | 6 of 6 completed |
| Files created | 23 |
| Files modified | 3 |
| Tests passing | 80 / 80 (53 new) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: OAuth authorize + callback | Pass (code) | State HMAC-signed, one-shot consume, callback user-auth binding, UPSERT on reconnect |
| AC-2: Encrypted refresh-token storage + key rotation | Pass | AES-256-GCM, IV 12B + tag 16B, KEY_VERSION_MAP (v1..v10), tests for tamper + wrong key |
| AC-3: Google Ads API client + tenancy | Pass | Cross-tenant asserted NOT to call Google in integration tests |
| AC-4: Campaign template library | Pass | 3 templates, all pass Google char limits at module-load time, inline snapshot in tests |
| AC-5: Campaign CRUD + safe mutations | Pass | Name ≤255, external_id numeric CHECK at DB, delete→status='removed' |
| AC-6: Metrics sync endpoint | Pass | validateGaqlId pre-interpolation, 207 + partial:true on partial failure |
| AC-7: Rate limiting | Pass | 20 MUTATE / 500 READ per shop per hour, configurable via env |
| AC-8: OAuth state tamper + auth binding | Pass | replayed/expired/not-found/invalid-signature/malformed all → 400; user-auth mismatch → 403 |
| AC-9: Tests assert negative invariants | Pass | Google mock NOT called on 401/402/403/400 paths (asserted) |
| AC-10: Tier gating | Pass | Performance tier required; SHOP_ADS_TIER_OVERRIDE allowlist for PSG internal |
| AC-11: Budget ceiling | Pass | ADS_MAX_DAILY_MICROS default 500_000_000 ($500); per-shop override column |
| AC-12: Shop preflight | Pass | Missing address/website/non-https/radius → 400 pre-mutate |

## Accomplishments

- Shipped Google Ads API v20 integration with all 11 audit-identified release-blockers closed (tier gate, budget cap, preflight, state user-auth binding, revoke-at-Google, upsert-on-reconnect, key rotation, PII sanitizer, test env, callback auth match, first-enable narrowing).
- Added first encryption-at-rest infrastructure to the project (AES-256-GCM + key rotation map), with documented rotation procedure.
- Established the `*_api_call_log` pattern as reusable infrastructure (06 Email/SMS will inherit directly).
- 53 new tests covering crypto tamper, state replay, tier gating, preflight, budget cap, role gates, sync partial-failure response, refresh-token-never-logged.
- Backend surface is ready for 05-04 UI without any further API changes.

## Task Commits

Commits deferred to post-UNIFY per project pattern (split parent + dashboard). Planned scopes:

| Scope | Type | Description |
|-------|------|-------------|
| supabase/migrations | feat | 005: accounts + campaigns + oauth_states + api_call_log + Performance tier |
| dashboard/src/lib/google-ads | feat | crypto + oauth + tier + client + templates + campaigns + sanitize |
| dashboard/src/app/api/ads/google | feat | 7 routes w/ gates + budget cap + preflight |
| dashboard/src/**tests** | test | 53 new tests across crypto / sanitize / templates / oauth / tier / routes |
| docs | docs | secrets.md rotation procedure |
| .paul | docs | 05-03 PLAN + AUDIT + SUMMARY |

## Files Created/Modified

See frontmatter `key-files`. Created: 23 files (migration + 9 lib modules + 7 route files + 6 test files). Modified: 3 files (.env.example, vitest.setup.ts, package.json).

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Extend `billing_tier` enum in 005 | Keeps billing cohesive; avoids parallel enum | Alters shared enum via idempotent `add value if not exists` |
| service_radius_miles column added in 005 | Tied to first real use case (ads geo) | Future non-ads features can reuse; check constraint bounds 1..500 |
| Lazy state GC on callback (not cron) | Cheap, no infra add for MVP | Scales up to low-thousands of states/day easily |
| Mock campaigns.ts in route tests (not google-ads-api directly) | Keeps route tests fast + reliable; unit tests cover lower layers | Crypto + rate-limit tests live separately |
| Best-effort revokeAtGoogle on disconnect | Google's endpoint sometimes flaky; local state is source of truth | Disconnect never blocks on Google |
| POST /accounts/[id]/disconnect (not DELETE) | Semantically an action (state change + external call) | REST purism sacrificed for clarity |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 2 | Lint warnings (unused NextResponse import, unused `payload` var in oauth.ts) |
| Scope additions | 2 | Added `service_radius_miles` column to shops in 005 (plan implied need, didn't spec); added `performance` to billing_tier enum (required by tier gate) |
| Scope clarifications | 1 | Route tests mock at `@/lib/google-ads/campaigns` (business-logic layer) rather than `google-ads-api` library — kept tests deterministic without exercising crypto |
| Deferred | 4 | All from AUDIT deferrals (cron GC, multi-customer picker UI, non-SEARCH types, dev-token tier verification) — unchanged |

**Total impact:** Low. Scope additions resolved schema dependencies that would have blocked AC-10/12. Test-mock strategy diverged from plan pseudocode but delivered identical test-assertion coverage.

### Auto-fixed Issues

**1. Lint: unused `NextResponse` import in callback/route.ts**
- Removed — callback returns raw `Response` objects for HTML rendering.

**2. Lint: unused `payload` variable in oauth.ts verifyAndConsumeState**
- Simplified `const payload = verify(...)` to `verify(...)` — return value not needed; verify throws on failure.

### Deferred Items

Carried forward from AUDIT.md (not new):
- Cron-based state-token GC (lazy sweep sufficient)
- Multi-customer-id picker UI (belongs in 05-04)
- Shopping / Display / Video campaign types
- Google Ads developer-token Basic→Standard verification (deploy-time, not code)
- Automated background re-encryption job for key rotation (procedure documented; execution is future work)
- Operational policy on BSM-managed vs shop-managed pre-existing campaigns (ops docs, not code)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Initial route-test mock chain for sync failed (incomplete update().eq() thenable) | Refactored: introduced `updateThenable()` builder, then re-refactored to mock `@/lib/google-ads/campaigns` at business-logic layer — simpler + more maintainable |
| `billing_tier` enum didn't include 'performance' | Added `alter type billing_tier add value if not exists 'performance'` in 005 |
| `shops.service_radius_miles` column didn't exist | Added `alter table shops add column if not exists service_radius_miles integer check (...)` in 005 |
| Post-write hook flagged route handlers for "observability" | Validated: every external-call path is already logged via `logAdsCall`. Read-only DB routes intentionally minimal per plan boundary. |

## Skill Audit (05-03)

Per SPECIAL-FLOWS.md required skills for this plan:

| Expected | Invoked | Notes |
|----------|---------|-------|
| /collision-repair-content-system | ✓ | Loaded; template keyword lists reflect collision-repair vertical (storm damage, DRP, OEM-certified) |
| /humanizer | ✓ | Loaded; ad copy active voice, no em dashes, no filler, no cliches |
| /brand | ✓ | Loaded; PSG voice maintained in ad copy (sign-off conventions, no promises) |

Status: **All 3 required skills invoked ✓**. Carry-over from 05-02 session (same `/humanizer`, `/brand` + new `/collision-repair-content-system` for vertical content).

## Next Phase Readiness

**Ready:**
- 05-04 (Ads dashboard UI) — backend surface stable; consumes `/api/ads/google/{accounts,campaigns,campaigns/[id],campaigns/sync}` endpoints + `response-modal`-style approve-on-enable pattern mirrors 05-02
- Any future OAuth integration (GBP, Google Search Console deferred in 02-05) — reuses `crypto.ts` + key-version map + state token infrastructure
- Phase 6 email/SMS work — reuses rate-limit + `*_api_call_log` pattern + sanitize.ts + tier-gate pattern

**Concerns:**
- Google Ads developer-token access-level (Basic vs Standard) must be verified before first paying customer — Basic is test-only
- `revokeAtGoogle` failure leaves token theoretically valid upstream; documented in secrets.md incident procedure
- Automated re-encryption of old-key rows is future work; rotation requires manual admin script until then

**Blockers for runtime verify:**
- 11 new env vars (listed in `.env.example`)
- Google Cloud OAuth client created with redirect URI matching `GOOGLE_ADS_OAUTH_REDIRECT_URI`
- Google Ads API Center developer-token approved at Standard tier
- MCC (manager account) provisioned; `GOOGLE_ADS_LOGIN_CUSTOMER_ID` set
- At least one shop with `status='active'` + `tier='performance'` subscription row (OR slug on `SHOP_ADS_TIER_OVERRIDE`)
- 05-01/02 blockers still apply (Supabase link + service role key + review secrets)

---
*Phase: 05-reputation-ads, Plan: 03*
*Completed: 2026-04-19*
