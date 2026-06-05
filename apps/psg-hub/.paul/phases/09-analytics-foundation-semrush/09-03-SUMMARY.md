---
phase: 09-analytics-foundation-semrush
plan: 03
subsystem: api
tags: [semrush, ingest, cron, resilience, idempotency, supabase, csv]

requires:
  - phase: 09-01
    provides: analytics_snapshots model + upsertSnapshots idempotent writer + SemrushMetrics type
  - phase: 09-02
    provides: /dashboard/analytics surface reading period='daily' trailing-30d rows
provides:
  - SEMrush HTTP client (contract-correct, resilient, fail-loud header guard, key-redacting)
  - syncSemrushSnapshots orchestrator (daily idempotent rows, per-shop failure containment)
  - analytics_sync_runs audit ledger (migration, LOCAL-applied)
  - CRON_SECRET-gated /api/cron/semrush-sync + vercel.json daily cron 06:00 UTC
affects: [10-google-ads (sync+ledger pattern), 11-ga4-gsc, 12-psg-report]

tech-stack:
  added: []
  patterns:
    - "Ingest pattern: contract client (parse-by-returned-header + ERROR sniff + fail-loud contract guard) -> orchestrator (skip/contain/ledger) -> idempotent upsert"
    - "Cron route: timing-safe CRON_SECRET gate BEFORE client construction; unset secret = locked; 503 designed not-configured state"
    - "Secrets-in-URL mitigation: redactApiKey() on every logged/persisted error path (SEMrush is query-param-auth only)"

key-files:
  created:
    - src/lib/semrush/client.ts
    - src/lib/semrush/sync.ts
    - src/app/api/cron/semrush-sync/route.ts
    - supabase/migrations/20260605000000_analytics_sync_runs.sql
  modified:
    - vercel.json
    - vitest.config.ts

key-decisions:
  - "period='daily' rows (research said monthly) — the 09-02 surface reads daily/30d; Phase 12 derives rollups"
  - "domain_organic capped display_limit=100 + DAILY cron (not 6h canon) — cost guard: ~4.2k units/day at 4 shops vs 160k at 6h/1000"
  - "Fail-loud SemrushContractError on header mismatch / empty-200 — silent zero rows are indistinguishable from low-data shops"
  - "API key stays in query string (SEMrush has no header auth) + redactApiKey on all error/log paths"

patterns-established:
  - "analytics_sync_runs ledger: running -> success(rows_written) | error(message); ledger failure never masks/blocks the sync"

duration: ~35min
started: 2026-06-05T11:25:00Z
completed: 2026-06-05T11:45:00Z
---

# Phase 9 Plan 03: SEMrush ingest — Summary

**SEMrush ingest shipped end-to-end without the prod key: a contract-correct resilient HTTP client, a per-shop sync orchestrator writing idempotent daily `analytics_snapshots` rows that light up the 09-02 surface, an `analytics_sync_runs` audit ledger, and a secret-gated daily cron route — 322 tests, zero live API calls, zero prod contact.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35min |
| Tasks | 3 completed |
| Tests | 322 unit (295→322; 23 new semrush + cron) + 10/10 E2E regression-free |
| Files | 6 new, 2 modified |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Contract-correct client | **Pass** | 15 client tests: parse-by-returned-header, ERROR-token sniff (HTTP-200 errors), `score`-not-`ascore` ASSERTED, Po buckets from cost-capped sample, retry + breaker (open-fails-fast proven) |
| AC-2: Idempotent sync + ledger | **Pass** | 5 sync tests: daily rows on the 09-01 conflict key, url-less skipped (zero fetch), per-shop failure contained, ledger error/success accurate, ledger-open failure non-blocking |
| AC-3: Secret-gated cron route | **Pass** | 7 route tests: 401×3 with zero spend (incl. unset-secret=locked), 503 `semrush_not_configured` designed state, 200 GET+POST with counts; vercel.json crons valid |
| AC-4: Gates + zero regression | **Pass** | typecheck clean · lint 0 err · coverage exit 0 (semrush ~98% lines) · `db reset` ✓ · build ✓ `ƒ /api/cron/semrush-sync` · e2e 10/10 · fetch injected in EVERY test |

## Accomplishments

- Phase 9's promise is complete in code: after the gate batch, one cron tick populates /dashboard/analytics for the 4 url-bearing shops with zero further changes.
- The ingest PATTERN (client → orchestrator → ledger → idempotent upsert) is the template Phases 10/11 copy for Google Ads and GA4/GSC.
- Two hardening passes beyond plan: fail-loud contract guard (advisor) + API-key log redaction (security review).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/semrush/client.ts` | Created | Contract client: normalizeDomain, parseSemrushCsv (ERROR sniff), fetchShopMetrics (3 calls), SemrushContractError fail-loud guard, redactApiKey, retry+breaker |
| `src/lib/semrush/sync.ts` | Created | syncSemrushSnapshots: shops → metrics → upsert; skip/contain/ledger; key-redacted logging |
| `src/app/api/cron/semrush-sync/route.ts` | Created | Timing-safe CRON_SECRET gate (GET+POST); 503 not-configured; counts response |
| `supabase/migrations/20260605000000_analytics_sync_runs.sql` | Created | Ledger table (09-01 type, never migrated — grounding catch); RLS on, 0 policies (service-only) |
| `vercel.json` | Modified | + daily cron 06:00 UTC |
| `vitest.config.ts` | Modified | + 3 semrush modules in the coverage include |
| `src/lib/semrush/__tests__/{client,sync}.test.ts`, `route.test.ts` | Created | 27 tests, all fetch-injected |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Daily `period='daily'` rows | 09-02 page reads daily/30d; research's monthly would leave the surface dark | Phase 12 derives monthly rollups from daily rows |
| display_limit=100 + daily cron | 6h × limit-1000 ≈ 160k units/day — unaffordable; daily × 100 ≈ 4.2k | Position distribution = top-100 sample (documented; widen if the report needs it) |
| Fail-loud contract guard | Only "Organic Keywords" header was live-verified; a renamed header would silently zero every metric | Header mismatch / empty-200 now throws → failed count + ledger record |
| Key stays in query string + redaction | SEMrush has no header auth (contract) | `redactApiKey()` on every logged/persisted error path; rotation = operator item |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Test assertion counted retry calls wrong (2 not 1) — test bug, not code |
| Post-gate hardening | 2 | Advisor contract guard + security-review key redaction (both test-covered) |
| Deferred | 0 | — |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Automated security review: API key in URLs | SEMrush is query-param-auth only (no header option) → key redaction on all error/log paths + in-code security note + operator rotation item |

## Next Phase Readiness

**Ready:** Phase 9 = 3/3 plans loop-closed. The full vertical (model → surface → ingest) exists and is gate-checked locally.

**⚠️ GATE BATCH (operator, the single Phase-9 pause — everything below is outward-facing and waits for you):**
1. Review the whole-phase diff (09-01 wip `9f2f266` + uncommitted 09-02/09-03)
2. Prod migrations ×2 under PROTOCOL (advisor baseline+diff each): `20260604000000` (incl. the 09-02 `location_id drop not null` amendment) + `20260605000000` (sync ledger)
3. Prod secrets ×2: `SEMRUSH_API_KEY` + `CRON_SECRET` (cron is locked without it)
4. `.vercel` link resolution (links exist at BOTH psg-internal root and the psg-hub repo) → deploy
5. **First-live-run verification: REAL numbers on /dashboard/analytics for the 4 url-bearing shops — NOT "cron returned 200."** If any metric reads 0 unexpectedly, log the raw response header lines (contract guard will catch full mismatches; partial renames could still zero a single metric)
6. Visual/brand human-verify of the analytics surface
7. Commit + push to psg-hub.git

**Concerns:** SEMrush→snapshot→page has never run against the real API (by design — no key in build). The first cron tick is that test. LCP hard-budget promotion for /dashboard/analytics (80-104ms medians vs 2000ms) also lands whenever next touched.

**Blockers:** None for the transition; the gate batch gates prod.

---
*Phase: 09-analytics-foundation-semrush, Plan: 03*
*Completed: 2026-06-05*
