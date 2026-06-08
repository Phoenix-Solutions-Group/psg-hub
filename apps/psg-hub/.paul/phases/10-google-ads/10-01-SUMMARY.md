---
phase: 10-google-ads
plan: 01
subsystem: database
tags: [google-ads, oauth, rls, bytea, supabase, migration, playwright, postgrest]

requires:
  - phase: 09-analytics-foundation-semrush
    provides: analytics_snapshots model + /dashboard/analytics shell + the migration-as-code + local-Playwright (db-reset + service-role seed) harness this plan reuses
  - phase: 06-rbac-rls-spine
    provides: shop_users membership + user_shop_ids() RLS helper + default-deny precedent
provides:
  - public.google_ads_accounts / google_ads_campaigns / google_ads_oauth_states / ads_api_call_log (the 4 tables the blind-built Google Ads code reads/writes)
  - per-table RLS (membership SELECT on accounts+campaigns; default-deny on oauth_states+call_log)
  - the bytea write/read fix that makes the OAuth-link path actually persist a usable refresh token
  - /dashboard/ads online as the real unlinked accounts/link surface
affects: [10-02 google-ads ingest, 10-03 activation gate batch, 11-ga4-gsc (inherits app-key-GCM encryption)]

tech-stack:
  added: []
  patterns:
    - "bytea over PostgREST: write the Postgres `\\x<hex>` text form, never a raw Node Buffer (Buffer JSON-serializes to {type:Buffer,data:[...]} and is stored as that literal string)"
    - "real-client schema proof: validate a blind-built migration with service-role writes + user-session RLS reads against the local DB, not mocked unit tests"

key-files:
  created:
    - supabase/migrations/20260608000000_google_ads_tables.sql
    - e2e/google-ads.spec.ts
  modified:
    - src/app/dashboard/ads/page.tsx
    - src/app/api/ads/google/callback/route.ts
    - src/lib/google-ads/client.ts

key-decisions:
  - "Token encryption = app-key AES-256-GCM (encrypted_refresh_token bytea + key_version), NOT pgsodium — recorded deviation from the PROJECT constraint; Phase 11 inherits"
  - "Campaign MUTATION out of scope (v1.2 / D52/D66) — tables provisioned, mutation code left compiling but unwired"
  - "bytea stored as `\\x<hex>` text (callback write) + decoded `\\x`hex→Buffer (client read) — fixes a blind-build token-corruption bug"

patterns-established:
  - "PostgREST bytea = `\\x<hex>` text form on write + decode on read"
  - "AC that says 'prove the blind-built schema' → a real service-role+user-session round-trip in the local Playwright harness, never mocks"

duration: ~35min
started: 2026-06-08T09:25:00Z
completed: 2026-06-08T10:00:00Z
---

# Phase 10 Plan 01: Google Ads tables provision — Summary

**Provisioned the 4 absent `google_ads_*` / `ads_api_call_log` tables + per-table RLS (LOCAL), brought `/dashboard/ads` online as the real unlinked accounts/link surface, and caught + fixed a blind-build token-corruption bug (raw-Buffer bytea write) that a real-client round-trip exposed.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min |
| Tasks | 3 completed (1 DONE_WITH_CONCERNS→PASS) |
| Files created | 2 |
| Files modified | 3 (+`.env.test.local`, gitignored) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: 4 tables exist locally with code-matching columns/constraints | Pass | `supabase db reset` exit 0; docker-psql verified rls=true ×4, both onConflict unique keys, FKs/CHECKs, ads_api_call_log composite rate-limit index, exactly the 2 membership SELECT policies |
| AC-2: real service-role + user-session round-trip (not mocked) | Pass | 5 e2e tests: bytea byte-identical readback · rate-limit COUNT on real index · MEMBER reads 1 acct + 1 campaign · NON-member reads 0/0 · transient tables default-deny for a member. Caught the bytea drift (below) |
| AC-3: unlinked accounts/link surface online, coming-soon gone, no mutation | Pass | e2e: heading + "No Google Ads account linked yet." + "Link Google Ads" CTA visible; "arrive in a later release" absent; no Create-campaign control; axe AA 0 serious/critical |

## Verification Results

- `tsc --noEmit` clean
- `eslint` 0 findings (changed + new files)
- `vitest run` **322/322** (no regression; client.ts/callback.ts changes compatible with the mocked routes test)
- `pnpm build` ✓ (Playwright webServer built + served)
- `playwright test` **16/16** (5 new schema specs + AC-3 surface; all existing auth/customer/analytics/lcp/shop-switch green)

## Accomplishments

- The Google Ads stack (OAuth lib + 7 routes + full `/dashboard/ads` UI), built blind against a schema that existed nowhere, now has its 4 backing tables with correct columns + per-table RLS, proven against the real local DB.
- Exposed and fixed a latent token-corruption bug before it could ship: the callback persisted `encrypted_refresh_token` as a raw Node Buffer, which PostgREST stores as the literal `{"type":"Buffer","data":[...]}` JSON string — so every linked account's refresh token would fail to decrypt on first use. Now stored + read as Postgres `\x<hex>` bytea text.
- `/dashboard/ads` is no longer a "coming soon" guard for performance-tier shops; it shows the real link surface.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 10-01 (all 3 tasks) | `<wip>` | feat | google_ads tables + RLS migration, ads surface flip, bytea write/read fix, e2e schema proof |

Committed as one wip on `feature/09-analytics` (mid-phase; the Phase-10 commit lands at the phase transition after 10-03, mirroring Phase 9).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260608000000_google_ads_tables.sql` | Created | 4 tables + indexes + per-table RLS (LOCAL-applied; prod = 10-03 gate batch) |
| `e2e/google-ads.spec.ts` | Created | AC-2 real-client schema round-trip + RLS proofs; AC-3 unlinked-surface UI |
| `src/app/dashboard/ads/page.tsx` | Modified | Coming-soon guard → real `<AccountsTable>` surface (user-session RLS read; mutation excluded) |
| `src/app/api/ads/google/callback/route.ts` | Modified | bytea write fix: `\x<hex>` instead of a raw Buffer |
| `src/lib/google-ads/client.ts` | Modified | bytea read fix: decode `\x`hex → Buffer |
| `.env.test.local` | Modified (gitignored) | `SHOP_ADS_TIER_OVERRIDE` (e2e tier gate) + throwaway `ADS_ENCRYPTION_KEY` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Token encryption = app-key AES-256-GCM, not pgsodium | The inherited crypto is built + unit-tested; re-doing as pgsodium is pure risk for no security gain. Genuine encryption-at-rest. | Recorded deviation from PROJECT's pgsodium constraint; **Phase 11 inherits the same choice** for refresh-token consistency |
| Campaign mutation out of scope | v1.2 Ads Mutation Studio; D52/D66 route Google Ads writes through Python on Vercel Sandbox — the inherited JS `createCampaign` contradicts that | Tables provisioned (shared schema), mutation code left compiling/unwired; v1.2 reconcile flagged |
| bytea as `\x<hex>` text on write + decode on read | A raw Node Buffer over PostgREST is stored as `{type:Buffer,...}` JSON, not bytes — proven empirically | Fixes a token-corruption bug; establishes the project's PostgREST bytea pattern |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential — a real token-corruption bug the plan anticipated (AC-2's purpose) |
| Scope additions | 0 | — |
| Test-infra | 1 | Round-trip used a raw `\x`hex blob, not the server-only `encryptRefreshToken` import |
| Config | 1 | Two keys added to gitignored `.env.test.local` |

**Total impact:** No scope creep. The one substantive deviation is a code fix the plan explicitly authorized ("fix code only if Task 2 proves it demonstrably wrong").

### Auto-fixed Issues

**1. [Data integrity] Raw-Buffer bytea write corrupts the OAuth refresh token**
- **Found during:** Task 2 (real-client schema round-trip) — empirical probe against the local DB.
- **Issue:** `callback/route.ts` upserted `encrypted_refresh_token: ciphertext` (a Node Buffer). supabase-js JSON-serializes a Buffer to `{"type":"Buffer","data":[...]}`, which PostgREST stores as that literal string in the bytea column, NOT the bytes. `client.ts` then read it as a string and `Buffer.from(...)` on the wrong content → `decryptRefreshToken` always fails → every linked account broken on first API call.
- **Fix:** callback writes `\\x${ciphertext.toString("hex")}` (Postgres bytea text form); `client.ts` decodes a `\x`-prefixed hex string back to a Buffer (Buffer/ArrayBuffer fallbacks retained).
- **Files:** `src/app/api/ads/google/callback/route.ts`, `src/lib/google-ads/client.ts`.
- **Verification:** e2e "bytea stores the bytes ... reads back byte-identical" (decode `\x`hex == original plaintext); vitest 322/322 unaffected (mocked routes test passes a Buffer → still hits the Buffer branch).

### Test-infra deviation

- The AC-2 round-trip inserts a raw `\x`hex blob rather than importing the real `encryptRefreshToken` — `crypto.ts` does `import "server-only"`, which throws under the Playwright runtime. Crypto encrypt/decrypt correctness is already covered by `crypto.test.ts` (unit); this test validates the bytea storage format + RLS, which a raw blob exercises fully.

### Deferred Items

- None new. (Standing: campaign mutation → v1.2; Phase-9 gate batch + merge still operator-owed.)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `psql` not on host PATH | Used `docker exec supabase_db_psg-hub psql` for schema inspection |
| `next lint` mis-invoked | Project lint script is `eslint`; ran it directly |
| `server-only` blocks importing crypto into Playwright | Round-trip uses a raw `\x`hex blob; crypto correctness stays unit-tested |

## Next Phase Readiness

**Ready:**
- The 4 tables + RLS exist locally; the OAuth-link/accounts/log read path is schema-proven; the bytea persistence bug is fixed → the link→use path will actually work once activated.
- `analytics_snapshots` already accepts `source='google_ads'` (Phase-9 type union) → 10-02 ingest can write straight to it.

**Concerns:**
- 10-02 ingest must NOT reuse `fetchCampaignMetrics` (per-campaign, LAST_30_DAYS); it needs an account-level, date-windowed GAQL summed across campaigns to produce one daily `analytics_snapshots` row, and only for shops with a `status='linked'` account (asymmetric with SEMrush's every-url-bearing-shop).
- All of this is LOCAL/unactivated. The OAuth app credentials + secrets + prod migration + pilot link + first-live-run are the 10-03 operator gate batch — and ride on top of the still-deferred Phase-9 gate batch (analytics not on prod, `feature/09-analytics` not merged).

**Blockers:** None for 10-02 (autonomous, local). 10-03 is operator-gated.

---
*Phase: 10-google-ads, Plan: 01*
*Completed: 2026-06-08*
