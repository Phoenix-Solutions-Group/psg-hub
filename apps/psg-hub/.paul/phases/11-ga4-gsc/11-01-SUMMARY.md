---
phase: 11-ga4-gsc
plan: 01
subsystem: api
tags: [google-oauth, ga4, gsc, refresh-token, bytea, rls, next-server-external]

# Dependency graph
requires:
  - phase: 10-google-ads
    provides: AES-256-GCM app-key crypto (ADS_ENCRYPTION_KEY), the OAuth state-machine + two-step picker pattern, the enumerate-then-map deps seam
provides:
  - Shared Google OAuth foundation (one combined-scope consent → one refresh token usable for GA4 + GSC)
  - google_oauth_accounts table (generic per-source linked-account model; ga4 + gsc rows share one token)
  - google_oauth_pending_states table (parameterized pending-carry, source-agnostic accounts jsonb)
  - src/lib/google-oauth/ module (state machine, OAuth2 client builder, GA4 + GSC enumeration, error mapper, persist)
  - 3 link routes (/api/analytics/google/authorize|callback|select) + link-google-button UI
affects: [11-02 GA4 ingest, 11-03 GSC ingest]

# Tech tracking
tech-stack:
  added: ["@google-analytics/data@6.1.0", "@google-analytics/admin@9.1.0", "googleapis@173.0.0", "google-auth-library@10.7.0"]
  patterns:
    - "Parameterized OAuth state machine (scope + redirectUri injected per-flow; not hardcoded)"
    - "Generic per-source account table (one row per source, shared encrypted refresh token)"
    - "gax authClient vs googleapis auth: GA4 uses buildOAuth2Client→authClient; GSC uses googleapis' own google.auth.OAuth2"
    - "serverExternalPackages for native gRPC/gax deps (not bundled by Next)"

key-files:
  created:
    - supabase/migrations/20260609183451_google_oauth_accounts.sql
    - supabase/migrations/20260609183452_google_oauth_pending_states.sql
    - src/lib/google-oauth/{crypto,state,client,ga4-enumerate,gsc-enumerate,accounts}.ts
    - src/app/api/analytics/google/{authorize,callback,select}/route.ts
    - src/app/dashboard/analytics/link-google-button.tsx
    - e2e/google-analytics-link.spec.ts
  modified:
    - package.json
    - next.config.ts
    - src/app/dashboard/analytics/page.tsx
    - vitest.setup.ts

key-decisions:
  - "Crypto = re-export of google-ads/crypto (shared ADS_ENCRYPTION_KEY); no GOOGLE_OAUTH_ENCRYPTION_KEY alias added"
  - "exchangeCodeForTokens takes redirectUri as a REQUIRED arg (no env fallback) — advisor catch"
  - "Link requires shop OWNER role but is NOT tier-gated (matches the ungated analytics surface)"
  - "GoogleApiError mapper is NEW (gRPC code + Gaxios status + OAuth invalid_grant), not cloned from GoogleAdsFailure"
  - "GSC enumeration uses googleapis' vendored google.auth.OAuth2 (version-boundary type mismatch with the gax client)"

patterns-established:
  - "google-oauth/ is a parameterized SIBLING of google-ads/, not an edit — the Ads vertical stays byte-untouched"
  - "Two linked rows (ga4 + gsc) share ONE encrypted refresh token written as Postgres \\x<hex> bytea text"

# Metrics
duration: ~1 session (APPLY 2026-06-09)
started: 2026-06-09T11:25:00Z
completed: 2026-06-09T13:09:00Z
---

# Phase 11 Plan 01: Shared Google OAuth foundation (GA4 + GSC) Summary

**One combined-scope Google consent (analytics.readonly + webmasters.readonly) links a shop's Google account, enumerates GA4 properties (accountSummaries.list) AND Search Console sites (sites.list), and persists the chosen property + site as two google_oauth_accounts rows sharing one encrypted refresh token. Built LOCAL, ZERO prod contact. No ingest, no panels — foundation only.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 session |
| Started | 2026-06-09T11:25:00Z |
| Completed | 2026-06-09T13:09:00Z |
| Tasks | 3 / 3 completed |
| Files | 13 created, 5 modified |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Dependencies + Next.js native-package config | Pass | 4 deps pinned; serverExternalPackages [data, admin, google-gax, @grpc/grpc-js, googleapis]; 3 routes runtime=nodejs; `pnpm build` ✓ |
| AC-2: Two new tables, LOCAL-applied, RLS-correct, zero existing-schema churn | Pass | `supabase db reset` exit 0; psql-verified accounts (1 membership SELECT policy) + states (0 policies); no ALTER to snapshots/sync_runs; google_ads_* untouched |
| AC-3: Parameterized OAuth state machine (Ads flow unbroken) | Pass | state.ts clones oauth.ts generalized (scope + redirectUri injected); reuses ADS_STATE_SECRET + HMAC + atomic anti-replay; Ads suite unchanged + green |
| AC-4: Dual-source enumeration (mapped, filtered, tested) | Pass | GA4 accountSummaries.list → properties/<id>; GSC sites.list with siteUnverifiedUser EXCLUDED; no /^\d{10}$/ check copied; map/paginate/filter/error tests |
| AC-5: Combined link flow — one consent, GA4 + GSC pick, two rows, one token | Pass | callback peek→bind→exchange→enumerate both→stash→two-group picker; select per-source offered-set validation + ≥1 required; 1-2 rows share one \\x<hex> token; OWNER-gated, not tier-gated; e2e round-trip green |
| AC-6: Boundaries held — foundation only | Pass | No runReport/searchanalytics.query, no cron, no panel; ZERO prod contact; reused ADS_ENCRYPTION_KEY AES-GCM (no pgsodium, no re-key) |

## Accomplishments

- Shipped a parameterized Google OAuth foundation as a clean SIBLING of the shipped Ads vertical — `src/lib/google-oauth/` reuses the proven state-machine, crypto, and picker patterns without editing a single line of `google-ads/*`.
- One combined-scope consent yields one refresh token that links BOTH a GA4 property and a GSC site (research-confirmed), persisted as two rows sharing one encrypted token — the smallest correct model both 11-02 and 11-03 ingests consume.
- Confirmed RESEARCH UNVERIFIED #1 (gax `authClient` injection) at compile (`new AnalyticsAdminServiceClient({authClient})` tsc-green) and isolated it to ONE helper so the first live link is a one-line fix if Google's runtime behavior differs.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260609183451_google_oauth_accounts.sql` | Created | Generic linked-account table: source CHECK(ga4/gsc), encrypted_refresh_token bytea + key_version, status CHECK, UNIQUE(shop_id,source,external_account_id), FK→shops; RLS ON + 1 membership SELECT policy |
| `supabase/migrations/20260609183452_google_oauth_pending_states.sql` | Created | Mirror of google_ads_oauth_states + `source` (default 'google') + pending_accounts jsonb; NO login_customer_id; RLS ON / 0 policy (default-deny) |
| `src/lib/google-oauth/crypto.ts` | Created | Re-export of google-ads/crypto (shared ADS_ENCRYPTION_KEY; no re-key) |
| `src/lib/google-oauth/state.ts` | Created | Parameterized clone of oauth.ts: buildAuthorizeUrl({scope,redirectUri,userId,shopId}), peek/verifyAndConsume, stash/consumePendingSelection (generic accounts:{ga4,gsc}), exchangeCodeForTokens(code, redirectUri required) |
| `src/lib/google-oauth/client.ts` | Created | Single buildOAuth2Client builder + NEW GoogleApiError / mapGoogleApiError (gRPC code + Gaxios status + OAuth invalid_grant) |
| `src/lib/google-oauth/ga4-enumerate.ts` | Created | listAccountSummariesAsync → {id:'properties/..',name,account}; async-iterable seam; authClient injection isolated |
| `src/lib/google-oauth/gsc-enumerate.ts` | Created | sites.list → {id:siteUrl,name,permissionLevel}; drops siteUnverifiedUser; googleapis `auth` |
| `src/lib/google-oauth/accounts.ts` | Created | persistLinkedAccount upsert onConflict (shop_id,source,external_account_id) |
| `src/app/api/analytics/google/authorize/route.ts` | Created | POST shop_id; auth + OWNER-only, NO tier gate; combined-scope URL; new GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI; runtime=nodejs |
| `src/app/api/analytics/google/callback/route.ts` | Created | peek→bind→exchange→enumerate BOTH→if both empty error→encrypt once→stash→two-group picker; utf-8; runtime=nodejs |
| `src/app/api/analytics/google/select/route.ts` | Created | per-source offered-set validation, ≥1 required, 1-2 rows share one token, session re-bind 403, postMessage 'google-analytics-linked'; runtime=nodejs |
| `src/app/dashboard/analytics/link-google-button.tsx` | Created | Client button: POST authorize, popup, postMessage listen / popup-close |
| `e2e/google-analytics-link.spec.ts` | Created | Round-trip: 2 rows share 1 byte-identical token, upsert-not-dupe, RLS member 2 / non-member 0, pending default-deny |
| `package.json` / `pnpm-lock.yaml` | Modified | +4 deps |
| `next.config.ts` | Modified | +serverExternalPackages (native gax/gRPC) |
| `src/app/dashboard/analytics/page.tsx` | Modified | +additive owner-only "Connect more sources" card (existing sections byte-untouched) |
| `vitest.setup.ts` | Modified | Test env wiring for the new module |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Crypto via re-export of ads crypto (shared ADS_ENCRYPTION_KEY) | Single audited crypto path; the GOOGLE_OAUTH_ENCRYPTION_KEY alias was "optional" in the plan | 11-02/11-03 decrypt with the same key; no key sprawl |
| exchangeCodeForTokens redirectUri = REQUIRED arg (no env fallback) | Advisor catch — env fallback risked silent redirect_uri mismatch | Forces each flow to pass its own redirect; safer |
| GoogleApiError mapper authored NEW (not cloned from GoogleAdsFailure) | GA4/GSC raise gax ServiceError (gRPC code) + Gaxios HTTP, not GoogleAdsFailure | Correct classification for both API shapes; reusable in 11-02/11-03 |
| GSC uses googleapis' own google.auth.OAuth2 (not shared buildOAuth2Client) | googleapis vendors its own google-auth-library copy → nominal type mismatch | RESEARCH-documented; GA4 keeps the shared gax authClient path |
| OWNER-gated, NOT tier-gated | Matches the ungated analytics surface posture | Link available to shop owners regardless of tier |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 1 | page.tsx added to files_modified (additive owner-card) |
| Approach refinements | 2 | GSC client construction; crypto alias dropped |

**Total impact:** Minor, no scope creep. All three are reconciliations between plan text and the correct implementation, advisor-confirmed.

### Detail

**1. page.tsx added to files_modified**
- **Found during:** Task 3
- **Issue:** The plan listed the link button but omitted `page.tsx` in files_modified; the Output + AC-5 require the on-surface button.
- **Fix:** Added an additive owner-only "Connect more sources" card; existing sections byte-untouched.
- **Verification:** advisor-confirmed reconcile of Output vs files_modified; e2e regression green.

**2. GSC uses googleapis' own google.auth.OAuth2**
- **Issue:** googleapis vendors its own google-auth-library copy → nominal type mismatch on the shared client.
- **Fix:** GSC path constructs google.auth.OAuth2 directly; the gax GA4 path keeps buildOAuth2Client. RESEARCH documents exactly this construction.

**3. crypto = re-export only (no GOOGLE_OAUTH_ENCRYPTION_KEY alias)**
- **Issue:** The alias was an "optional" plan item.
- **Fix:** Kept a single audited crypto path (shared ADS_ENCRYPTION_KEY); no alias added.

### Deferred Items

LIVE verification deferred to the **Phase-11 operator gate batch** (recorded):
- Real GA4/GSC enumeration against a live token
- The gax `authClient` runtime smoke (compile-confirmed only)
- GSC `sc-domain:` URL-encoding probe (RESEARCH UNVERIFIED #4)
- Consent-screen sensitive-scope verification + publish-to-Production (7-day Testing-mode refresh-token death)
- GA4 Admin API enablement
- Prod migration ×2 under PROTOCOL-migration-safety.md
- Deploy

Done-state for 11-01 = built + locally gate-checked, NOT live.

## Verification Results

- `tsc` — 0 errors
- `vitest run` — 421/421 (+49 new: state 11 · ga4-enumerate 5 · gsc-enumerate 5 · map-error 17 · select route 11)
- `eslint` — 0 errors (2 pre-existing warns: sync.test `_a`, middleware `options`)
- `pnpm build` — ✓ (3 new routes ƒ runtime=nodejs; serverExternalPackages clean, no missing-.node/http2/dns errors)
- `playwright test` — 24/24 (+5 round-trip; full regression incl. analytics/lcp/google-ads/shop-switch)
- Grep — no runReport/searchanalytics.query CODE; vercel.json unchanged (only semrush + google-ads crons); no ALTER to analytics_snapshots/sync_runs; no edit to google_ads_* migrations

## Skill Audit (Phase 11)

| Expected (SPECIAL-FLOWS required) | Invoked | Notes |
|-----------------------------------|---------|-------|
| Research-first / per-plan research check | ✓ | RESEARCH.md (ultracode Workflow `wf_b732175b-025`, 17 agents, adversarially validated) covers OAuth + enumeration + libraries + reuse map for 11-01 |

All required skills invoked ✓.

## Issues Encountered

None blocking. RESEARCH UNVERIFIED #1 (gax authClient) confirmed at compile and isolated to one helper for the live smoke.

## Next Phase Readiness

**Ready:**
- `google_oauth_accounts` rows (ga4 + gsc, shared token) are the exact model 11-02 (GA4 ingest) and 11-03 (GSC ingest) read.
- The OAuth2 client builder, enumeration helpers, and error mapper are reusable by both ingests.
- Crypto path (shared ADS_ENCRYPTION_KEY) is established for token decrypt.

**Concerns:**
- The gax `authClient` injection and GSC `sc-domain:` URL handling are compile-/research-confirmed only — first live link must smoke them.
- Consent screen must reach In-Production before live use (Testing-mode kills refresh tokens at 7 days).

**Blockers for next plan (11-02):** None for LOCAL build. LIVE activation is the shared Phase-11 operator gate batch.

---
*Phase: 11-ga4-gsc, Plan: 01*
*Completed: 2026-06-09*
