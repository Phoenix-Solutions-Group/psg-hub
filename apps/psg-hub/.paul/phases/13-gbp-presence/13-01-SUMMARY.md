---
phase: 13-gbp-presence
plan: 01
subsystem: api
tags: [google-business-profile, oauth, business.manage, googleapis, rls, migration, supabase]

requires:
  - phase: 11-ga4-gsc
    provides: the parameterized google-oauth foundation (state.ts machine, client.ts OAuth2 builder + error mapper, gsc-enumerate `auth:` idiom, crypto re-export, google_oauth_accounts table, the authorize/callback/select route shape)
  - phase: 10-google-ads
    provides: the AES-256-GCM app-key crypto + the `\x<hex>` bytea round-trip convention
provides:
  - GBP OAuth link foundation — a SEPARATE Option-B `business.manage` consent + own google_oauth_accounts row (source='gbp')
  - GBP account + location enumeration (gbp-enumerate.ts) — accounts.list flatten + accounts.locations.list (readMask), googleapis `auth:` idiom
  - the widened account model: source CHECK +'gbp', nullable external_parent_id (captures accounts/{id} for 13-03 star rating + Phase-14 reviews)
affects: [13-02 daily GBP insights ingest, 13-03 monthly presence + star rating, 14-reviews-sentiment]

tech-stack:
  added: []   # NO new dependency — googleapis@173 already ships the v1 GBP clients
  patterns:
    - "Separate per-source consent (Option B): own gbp/{authorize,callback,select} routes + own google_oauth_accounts row, SAME OAuth client — small token blast radius, GA4/GSC token untouched"
    - "Auto-named-constraint resolution: a DO-block reads conname from pg_constraint by definition (not an assumed name) before drop+re-add (the 12-05a/b trap)"
    - "googleapis `auth:` injection idiom (google.auth.OAuth2) for the GBP v1 clients — NOT the gax authClient: idiom (mirrors gsc-enumerate)"

key-files:
  created:
    - supabase/migrations/20260614194040_gbp_oauth_source.sql
    - src/lib/google-oauth/gbp-enumerate.ts
    - src/app/api/analytics/google/gbp/{authorize,callback,select}/route.ts
    - src/app/dashboard/analytics/link-gbp-button.tsx
    - e2e/google-gbp-link.spec.ts
  modified:
    - src/lib/google-oauth/accounts.ts
    - src/lib/google-oauth/state.ts

key-decisions:
  - "Option B (separate GBP consent + own row), not Option A (widen the combined GA4/GSC consent) — keeps GA4/GSC token blast radius small"
  - "Capture the parent accounts/{id} now (external_parent_id), mandatory because 13-03 star rating + Phase-14 reviews key off accounts/{aid}/locations/{lid}"
  - "Context7 googleapis-surface gate satisfied via definitive node introspection of the installed googleapis@173 (stronger than query-docs for 'does the installed lib expose X')"
  - "Star rating deferred to 13-03 (its v4 reviews aggregate + the account-id form land there); presence panel/report = 13-03; insights = 13-02"

patterns-established:
  - "GBP location identity = the BARE locations/{id} (external_account_id); the parent accounts/{id} rides alongside in external_parent_id"
  - "Additive PendingAccount.parent + PendingAccounts.gbp keep the GA4/GSC combined flow byte-compatible while carrying the GBP location list"

duration: ~35min
started: 2026-06-14T19:30:00Z
completed: 2026-06-14T20:05:00Z
---

# Phase 13 Plan 01: GBP OAuth Link Foundation Summary

**A separate `business.manage` consent (Option B) that enumerates a shop's Google Business Profile accounts + locations and persists the chosen `locations/{id}` (with its parent `accounts/{id}`) as a `source='gbp'` row on the shared google_oauth_accounts model — the foundation 13-02 (insights) and 13-03 (presence + star rating) consume. Build-local, ZERO prod, fully verified against the local migrated DB + e2e.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min (build + full local verification) |
| Started | 2026-06-14T19:30:00Z |
| Completed | 2026-06-14T20:05:00Z |
| Tasks | 3 completed (all DONE) |
| Files created | 8 |
| Files modified | 4 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: No new dependency; GBP v1 clients ship in googleapis@173; build green | Pass | `node` introspection confirmed `mybusinessaccountmanagement.accounts.list`, `mybusinessbusinessinformation.accounts.locations.list`, `businessprofileperformance.locations.fetchMultiDailyMetricsTimeSeries`, `mybusinessverifications.locations.getVoiceOfMerchantState` all present. NO new dep; `serverExternalPackages` unchanged; 3 GBP routes compiled `runtime=nodejs`; `next build` ✓ |
| AC-2: One migration, LOCAL-applied, additive; existing schema + RLS intact | Pass | `supabase db reset` exit 0 (migration applied last, no error). psql: `google_oauth_accounts_source_check = CHECK (source = ANY (ARRAY['ga4','gsc','gbp']))`, a bogus source rejected, `external_parent_id text` nullable=YES, membership SELECT RLS policy unchanged. NO ALTER to analytics_snapshots/sync_runs; google_ads_* + ga4/gsc rows untouched |
| AC-3: GoogleOAuthSource union widened; GA4/GSC paths typecheck-unchanged | Pass | `GoogleOAuthSource = "ga4"\|"gsc"\|"gbp"`; `persistLinkedAccount` gains optional `externalParentId`; tsc 0 across all existing GA4/GSC ingest + select paths |
| AC-4: GBP account+location enumeration — 2-API, readMask, OAuth2 idiom, VoM, tested | Pass | `gbp-enumerate.ts`: accounts.list flatten + accounts.locations.list (readMask `name,title,storefrontAddress,metadata,openInfo`), bare `locations/{id}` + parent + `hasVoiceOfMerchant`, `google.auth.OAuth2` + `auth:` idiom; 10 unit tests (flatten/map/paginate/VoM/error/non-fatal) green |
| AC-5: Separate Option-B GBP link flow — one consent, pick a location, one row + parent id | Pass | `gbp/{authorize,callback,select}` (business.manage, owner-only no tier gate, peek→bind→exchange→enumerate→stash→picker w/ VoM badge→consume+anti-tamper→persist source='gbp'). e2e 11/11: gbp row stores bare location + parent, bytea byte-identical, RLS member/non-member, sibling ga4 untouched |
| AC-6: Boundaries held — foundation only; the two Google gates kicked off | Pass | NO Performance API call / panel / cron; ZERO prod contact; the 13-01 output names the 3 day-1 operator actions (Gate A quota, Gate B classification, key revoke) |

## Verification Results

- **tsc:** 0 errors
- **eslint:** 0 errors (5 pre-existing warnings, none in new files)
- **vitest:** 598 passed (588 prior + 10 new gbp-enumerate)
- **next build:** ✓ Compiled successfully; 3 GBP routes as Node dynamic functions; NO new dep
- **supabase db reset:** exit 0; migration `20260614194040_gbp_oauth_source` applied clean; psql structural verify ✓ (CHECK admits gbp + rejects bogus, column nullable, RLS intact)
- **pnpm test:e2e:** 11/11 green (5 GBP + 5 GA4/GSC sibling + setup)

## Accomplishments

- Shipped the GBP link foundation without a new dependency — googleapis@173 already carries the typed v1 GBP clients (confirmed by introspection, not assumption).
- Honored the SPECIAL-FLOWS "no blind build" rule (the 10-01 lesson): the migration + persist path were verified against a REAL local Postgres (`db reset` + psql) and a REAL e2e round-trip, not just mocked unit tests.
- Captured the parent `accounts/{id}` now, removing a future re-enumeration for 13-03 star rating + Phase-14 reviews.

## Task Commits

Not committed per-plan — this project commits at phase boundaries (the transition does `feat(13-gbp-presence): ...`). 13-01 changes are staged-on-disk, uncommitted, to accumulate with 13-02/13-03/13-04.

| Task | Status | Description |
|------|--------|-------------|
| Task 1: Migration + union widen | DONE | source CHECK +'gbp' (real-name DO-block) + nullable external_parent_id; accounts.ts union + parent-id persist |
| Task 2: gbp-enumerate + state additive + tests | DONE | accounts/locations enumeration (readMask, `auth:` idiom, VoM) + 10 tests; PendingAccount.parent/PendingAccounts.gbp additive |
| Task 3: GBP routes + button + e2e | DONE | gbp/{authorize,callback,select} + link-gbp-button + analytics card + e2e round-trip |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260614194040_gbp_oauth_source.sql` | Created | Widen source CHECK +'gbp' (DO-block resolves the auto-named constraint) + nullable external_parent_id |
| `src/lib/google-oauth/gbp-enumerate.ts` | Created | accounts.list flatten + accounts.locations.list (readMask) + VoM; `google.auth.OAuth2` `auth:` idiom |
| `src/lib/google-oauth/__tests__/gbp-enumerate.test.ts` | Created | 10 unit tests (flatten/map/paginate/VoM/error/non-fatal) |
| `src/app/api/analytics/google/gbp/authorize/route.ts` | Created | business.manage consent (owner-only, no tier gate, separate redirect) |
| `src/app/api/analytics/google/gbp/callback/route.ts` | Created | exchange → enumerate → stash → location picker (VoM badge + address) |
| `src/app/api/analytics/google/gbp/select/route.ts` | Created | consume + anti-tamper → persist source='gbp' (bare location + parent + shared token) |
| `src/app/dashboard/analytics/link-gbp-button.tsx` | Created | "Connect Google Business Profile" popup button (postMessage google-gbp-linked) |
| `e2e/google-gbp-link.spec.ts` | Created | schema round-trip (gbp row + parent id + bytea + RLS + sibling untouched) |
| `src/lib/google-oauth/accounts.ts` | Modified | `GoogleOAuthSource` +'gbp'; persist `external_parent_id` |
| `src/lib/google-oauth/state.ts` | Modified | additive `PendingAccount.parent` + `PendingAccounts.gbp` + consume passthrough |
| `src/lib/google-oauth/__tests__/state.test.ts` | Modified | 1 assertion updated for the additive gbp slot |
| `src/app/dashboard/analytics/page.tsx` | Modified | second "Connect more sources" card for GBP |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Option B (separate GBP consent + own row), not Option A | A broken GBP re-consent must never invalidate a working GA4/GSC token; matches the per-source row design | GBP token blast radius is isolated; GA4/GSC untouched |
| Capture parent `accounts/{id}` in external_parent_id NOW | 13-03 star rating + Phase-14 reviews key off `accounts/{aid}/locations/{lid}`; re-enumeration later is the expensive path | One additive column; pre-stages 13-03 + Phase 14 |
| Context7 googleapis-surface gate satisfied via `node` introspection | Definitive for "does the installed lib expose X"; googleapis sub-APIs are discovery-generated + thinly covered by Context7 | Skill gate met with stronger evidence than query-docs |
| `google.auth.OAuth2` + `auth:` idiom (mirror gsc-enumerate), NOT gax `authClient:` | The googleapis GBP clients vendor their own OAuth2; mixing idioms fails at request time (the Phase-11 documented trap) | Live-link is a one-line fix if Google differs; isolated to gbp-enumerate |
| Star rating deferred to 13-03 | Its v4 reviews aggregate + the account-id form belong with the presence row | Clean 13-01 boundary; external_parent_id makes the 13-03 call cheap |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Test assertion updated for the additive shape — no behavior change |
| Scope additions | 0 | — |
| Deferred | 0 | All AC verified this session |
| Process | 2 | Started Docker Desktop to run the live-DB gates; Context7 gate met via introspection |

**Total impact:** No scope creep. The build matched the plan; the only code-side adjustment was a test-assertion update forced by the intended additive change.

### Auto-fixed Issues

**1. [test] state.test.ts assertion updated for the additive gbp slot**
- **Found during:** Task 2 (the `consumePendingSelection` gbp passthrough)
- **Issue:** an existing test asserted `accounts` deep-equals `{ ga4: [], gsc: [] }`; consume now also normalizes `gbp: []`
- **Fix:** updated the assertion to `{ ga4: [], gsc: [], gbp: [] }` (the intended new shape)
- **Files:** `src/lib/google-oauth/__tests__/state.test.ts`
- **Verification:** vitest 598 green

### Process notes (not code deviations)

- **Docker daemon was down at APPLY time.** Per advisor guidance (Phases 9-11 ran the LOCAL db reset + e2e before closing, deferring only the PROD apply), this was surfaced as a checkpoint rather than silently deferred; the operator chose "run now," Docker Desktop was started, and both live-DB gates then PASSED. No standing deferral remains for 13-01.
- **No per-route unit test for `/gbp/select`** — the mirrored shipped GA4/GSC select ships without one and the repo has no route-unit-test harness for these OAuth routes; its offered-set / session-mismatch / missing-pick guards are covered by the e2e spec + `state.test`. Precedent-matching, recorded — not a gap.

### Deferred Items

None for 13-01. Phase-level activation gates (not 13-01 deliverables): Gate A (Business Profile API access 0→300 QPM) + Gate B (`business.manage` OAuth verification) + the live prod migration = the 13-04 gate batch.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `node` `Object.keys` undercounted the googleapis resource methods (prototype methods) | Re-introspected via `typeof client.accounts.list` etc. — all GBP method functions confirmed present |
| `psql` not on PATH for the structural verify | Ran psql inside the `supabase_db_psg-hub` container via `docker exec` |
| Two test seams typed `unknown[]` failed tsc against the typed page fns | Typed the page records with the exported `GbpAccountLike`/`GbpLocationLike` |

## Next Phase Readiness

**Ready:**
- 13-02 (daily GBP insights): reads `google_oauth_accounts where source='gbp' status='linked'`, decrypts the shared token, calls `businessprofileperformance.locations.fetchMultiDailyMetricsTimeSeries` keyed off the stored bare `locations/{id}`. The `'gbp'` union promotion + the analytics_snapshots/sync_runs CHECK widen are 13-02's work.
- 13-03 (monthly presence + star rating): uses `external_parent_id` (`accounts/{id}`) for the v4 reviews star-rating aggregate + Business-Info location state.

**Concerns:**
- The live `business.manage` consent + the Performance/enumeration response shapes are unverified against real Google (only against typed clients + mocked seams) — the 13-04 live-smoke + the empirical 7-day token pass-gate confirm them. The `auth:` idiom is isolated to gbp-enumerate, so a live difference is a one-line fix.

**Blockers:**
- None for the build. Activation is gated on Google Gate A + Gate B (operator, started in parallel; cleared at the 13-04 gate batch).

---
*Phase: 13-gbp-presence, Plan: 01*
*Completed: 2026-06-14*
