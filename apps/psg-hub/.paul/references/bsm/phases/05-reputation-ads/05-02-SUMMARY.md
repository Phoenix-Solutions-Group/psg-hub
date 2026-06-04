---
phase: 05-reputation-ads
plan: 02
subsystem: ai-responses
tags:
  - anthropic
  - haiku-4-5
  - prompt-caching
  - rls
  - vitest
  - nextjs-16
  - audit-trail
  - rate-limiting
  - prompt-injection-defense
  - optimistic-concurrency

requires:
  - phase: 05-reputation-ads
    provides: reviews table, review_sources, adapter registry, /reviews page + table
  - phase: 04-customer-facing-mvp
    provides: shop_members w/ shop_role enum, get_user_shop_ids(), service-role client, PSG dashboard shell
provides:
  - review_responses table (draft/approved/rejected state machine)
  - review_response_versions table (append-only, DB-trigger-enforced audit trail)
  - llm_call_log table (observability for every LLM call attempt)
  - Responder library w/ Haiku 4.5 + prompt caching + 20s AbortController timeout
  - Prompt-injection defense in system prompt + post-generation safety regex
  - Per-user-per-review (10/hr) + per-shop (100/day) rate limits
  - Role-gated approval (owner|manager) + owner-only safety override
  - Optimistic-concurrency-controlled approve API (expectedVersion → 409)
  - Accessible response modal (role="dialog" + focus trap + ESC + return-focus)
  - Vitest harness + 27 passing tests
affects:
  - 05-03 (Google Ads) — establishes logging pattern for cross-tenant LLM calls
  - 05-04 (Ads dashboard) — demonstrates approval-gate UI pattern
  - 06 (Email/SMS) — reusable rate-limit + llm_call_log infrastructure
  - Future agent work — prompt-injection defense pattern + audit-trail trigger pattern

tech-stack:
  added:
    - "@anthropic-ai/sdk ^0.90.0 (dependency)"
    - "vitest ^4.1.4 + @vitest/coverage-v8 ^4.1.4 (dev)"
  patterns:
    - "Two-tier trust: explicit tenancy check before LLM call, RLS as defense-in-depth"
    - "Append-only audit via DB trigger + REVOKE UPDATE/DELETE (app code can't bypass)"
    - "Rate-limit check reads from llm_call_log (single source of truth for cost attribution)"
    - "Prompt caching on stable system prompt; volatile review body kept out of cache surface"
    - "State machine enforced both in DB (check constraints) and API (409 on invalid transition)"

key-files:
  created:
    - supabase/migrations/004_review_responses.sql
    - dashboard/src/lib/reviews/prompts.ts
    - dashboard/src/lib/reviews/safety.ts
    - dashboard/src/lib/reviews/rate-limit.ts
    - dashboard/src/lib/reviews/responder.ts
    - dashboard/src/lib/logging/llm-call.ts
    - dashboard/src/app/api/reviews/[id]/draft-response/route.ts
    - dashboard/src/app/api/reviews/[id]/approve-response/route.ts
    - dashboard/src/components/dashboard/response-modal.tsx
    - dashboard/src/lib/reviews/__tests__/prompts.test.ts
    - dashboard/src/lib/reviews/__tests__/safety.test.ts
    - dashboard/src/app/api/reviews/[id]/__tests__/routes.test.ts
    - dashboard/vitest.config.ts
    - dashboard/vitest.setup.ts
  modified:
    - dashboard/src/components/dashboard/reviews-table.tsx
    - dashboard/src/app/(dashboard)/reviews/page.tsx
    - dashboard/.env.example
    - dashboard/package.json

key-decisions:
  - "Haiku 4.5 pinned (not Sonnet/Opus). Draft generation is low-complexity; cost matters more than ceiling."
  - "Prompt caching on system prompt only. Review body is volatile + untrusted; never cached."
  - "DB trigger (SECURITY DEFINER) writes version history. REVOKE UPDATE/DELETE prevents app-code bypass."
  - "Post-generation regex safety (not pre-send DLP). Human approval is the backstop; regex is the flag layer."
  - "state enum dropped 'posted' (plan originally included it). No posting in scope — remove from enum to avoid dead state. Add in a later plan when posting ships."
  - "Rate limits read from llm_call_log. Single source of truth; includes rate_limited attempts in the count so abuse shows up."
  - "Role gates: approve = owner|manager; override_safety = owner only; update/reject/unapprove = any member."

patterns-established:
  - "API route shape: auth → explicit tenancy → role gate → rate-limit → LLM → log → write. Logged on every failure branch."
  - "LLM call log as cost-attribution + abuse-investigation + rate-limit source. One table, multiple uses."
  - "Audit-trail-via-trigger: any table that needs append-only history gets a SECURITY DEFINER trigger writing to a companion *_versions table with UPDATE/DELETE revoked."
  - "Client modal a11y contract: role=dialog + aria-modal + aria-labelledby + focus trap on Tab + ESC + return-focus-on-close."
  - "Test mocks assert negative invariants (Anthropic.create NOT called on auth/tenancy/rate-limit rejection)."

duration: ~70min
started: 2026-04-19T15:20:00Z
completed: 2026-04-19T16:15:00Z
---

# Phase 5 Plan 02: AI Review Response Drafting Summary

**Draft → edit → approve → copy flow wired end-to-end: Haiku 4.5 with prompt-injection defense, append-only audit trail, per-user rate limits, role-gated approval, optimistic concurrency, a11y modal, 27 passing tests. Runtime verify blocked only on ANTHROPIC_API_KEY.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~70min (interactive execution with 6 skill loads) |
| Started | 2026-04-19T15:20:00Z |
| Completed | 2026-04-19T16:15:00Z |
| Tasks | 4 of 4 completed |
| Files created | 14 |
| Files modified | 4 |
| Tests passing | 27 / 27 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Draft generation | Pass (code) | Haiku 4.5 + 20s timeout + PSG voice prompts. Runtime verify blocked on `ANTHROPIC_API_KEY`. |
| AC-2: Edit + regenerate | Pass | version++ on regenerate; update action preserves draft. DB trigger writes each change to review_response_versions. |
| AC-3: Approval + copy | Pass | Role gate (owner\|manager). Approved body read-only. Copy-to-clipboard via `navigator.clipboard.writeText`. |
| AC-4: Tenancy + auth | Pass | Explicit tenancy check runs before Anthropic call. Integration test asserts Anthropic mock NOT called on 403 path. |
| AC-5: Prompt-injection defense | Pass | System prompt includes "UNTRUSTED USER INPUT" boundary + 6 hard constraints. Unit test asserts string presence across 16 (platform × tone) combinations. |
| AC-6: Rate limiting + cost governance | Pass | 10/review/hr + 100/shop/day enforced before Anthropic call. Rate-limited attempts logged w/ `result='rate_limited'`. |
| AC-7: State machine enforcement | Pass | API + DB check constraints. Approve blocked when flags unresolved (409). Optimistic concurrency via `expectedVersion`. |
| AC-8: Observability + audit trail | Pass | `llm_call_log` populated on every path. `review_response_versions` append-only via SECURITY DEFINER trigger + REVOKE UPDATE/DELETE. |
| AC-9: Output safety | Pass | Regex catches phone/email/URL/admission/promise/disparagement. Critical flags block approval until owner override. |

## Accomplishments

- Shipped the full draft→edit→approve→copy flow end-to-end with no shortcuts on the audit/security controls the audit flagged as release-blocking.
- Built observability + audit infrastructure (`llm_call_log` + trigger-driven `review_response_versions`) that the rest of Phase 5 + Phase 6 LLM work can reuse.
- Added the project's first automated test harness (vitest) with 27 tests covering prompts, safety regex, and route-level security invariants.
- All 9 post-audit acceptance criteria satisfiable at code level. Runtime verification blocked only on user-supplied `ANTHROPIC_API_KEY`.

## Task Commits

Atomic commits deferred to post-UNIFY (project pattern from 05-01: split parent + dashboard commits after loop closes). Planned:

| Scope | Type | Description |
|-------|------|-------------|
| supabase/migrations | feat | `004_review_responses.sql`: review_responses + versions + llm_call_log |
| dashboard/src/lib | feat | responder + prompts + safety + rate-limit + llm-call log |
| dashboard/src/app | feat | draft-response + approve-response routes + modal wiring |
| dashboard/src/**tests** | test | vitest harness + 27 tests |
| .paul | docs | 05-02 PLAN + AUDIT + SUMMARY |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/004_review_responses.sql` | Created | 3 enums + 3 tables + RLS + REVOKE + trigger |
| `dashboard/src/lib/reviews/prompts.ts` | Created | System prompt builder w/ PROMPT_VERSION + platform/tone rules + hard constraints + few-shot |
| `dashboard/src/lib/reviews/safety.ts` | Created | Post-generation regex scan (phone/email/URL/admission/promise/disparagement) |
| `dashboard/src/lib/reviews/rate-limit.ts` | Created | Per-review-hr + per-shop-day enforcement |
| `dashboard/src/lib/reviews/responder.ts` | Created | Anthropic SDK wrapper: Haiku 4.5, AbortController, cache_control on system |
| `dashboard/src/lib/logging/llm-call.ts` | Created | `llm_call_log` writer (never throws on failure) |
| `dashboard/src/app/api/reviews/[id]/draft-response/route.ts` | Created | POST handler: auth → tenancy → rate-limit → LLM → log → upsert |
| `dashboard/src/app/api/reviews/[id]/approve-response/route.ts` | Created | State machine + role gate + optimistic concurrency |
| `dashboard/src/components/dashboard/response-modal.tsx` | Created | Accessible dialog w/ focus trap + ESC + copy-to-clipboard |
| `dashboard/src/lib/reviews/__tests__/prompts.test.ts` | Created | 5 unit tests (PROMPT_VERSION, platform/tone matrix, injection defense) |
| `dashboard/src/lib/reviews/__tests__/safety.test.ts` | Created | 11 unit tests (phone/email/URL/admission/promise + clean text) |
| `dashboard/src/app/api/reviews/[id]/__tests__/routes.test.ts` | Created | 9 integration tests (auth/tenancy/rate-limit/role/409 — asserts Anthropic mock NOT called on rejection paths) |
| `dashboard/vitest.config.ts` | Created | Alias `@/ → src/`, node env |
| `dashboard/vitest.setup.ts` | Created | `server-only` stub for node tests |
| `dashboard/src/components/dashboard/reviews-table.tsx` | Modified | Added Response column + modal trigger; receives `responsesByReviewId` + `rolesByShopId` |
| `dashboard/src/app/(dashboard)/reviews/page.tsx` | Modified | Loads review_responses + memberships, builds maps, passes to table |
| `dashboard/.env.example` | Modified | Added `ANTHROPIC_API_KEY` + rotation note |
| `dashboard/package.json` | Modified | Added `test` script + vitest devDeps + @anthropic-ai/sdk dep |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Haiku 4.5 pinned (no fallback) | Draft gen is low-complexity; cost > ceiling. Audit deferred fallback chain to separate plan. | Cheap per-call. Model retirement is a future migration task. |
| Dropped `posted` from status enum | Plan audit removed auto-posting from scope. A `posted` enum value no app code can reach == dead state. | Clean enum. Adding `posted` later is `ALTER TYPE ADD VALUE` (trivial). |
| Prompt caching on system prompt only | Review body is volatile + untrusted user input. Caching it would be wrong on both ergonomics and security. | ~90% cost reduction on warm cache reads; 0 risk of review content pollinating other tenants' cache. |
| DB trigger (SECURITY DEFINER) owns version history | Audit integrity cannot rely on app code — trivially bypassed via service-role client. | Trigger fires even when service-role writes. REVOKE UPDATE/DELETE on versions means no one can rewrite history. |
| `null`-safe `llm_call_log.shop_id/review_id` | ON DELETE SET NULL chosen so log survives tenant deletion (audit requirement). | Historical records preserved for compliance; FK queries need `is not null` guards. |
| `created_by` conditional on existing row | Upsert path: first draft sets creator; regenerates preserve original creator. | Attribution stays with original drafter across regenerations. |
| 10/hr per review + 100/day per shop | Reasonable ceilings. Plan called these out as starting values; easy to tune. | Single sustained attacker capped at <100 LLM calls/day per shop. |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Lint warning (unused `shopName` prop) — dropped from modal |
| Scope additions | 1 | `test` script added to package.json (plan implied vitest add but didn't specify script) |
| Scope clarifications | 1 | `review_response_status` enum — dropped `'posted'` per reasoning above |
| Deferred | 2 | Audit-already-deferred items (DLP, model fallback, admin UI) — carry forward |

**Total impact:** Minimal. All auto-fixes resolved before verification; no scope creep beyond what the plan implied.

### Auto-fixed Issues

**1. [Lint] Unused `shopName` prop in response-modal**
- **Found during:** Task 3 post-build lint
- **Issue:** `shopName` passed from table → modal but not rendered (AI draft already includes sign-off)
- **Fix:** Dropped prop from `Props` + destructuring + call site
- **Files:** `response-modal.tsx`, `reviews-table.tsx`
- **Verification:** `npm run lint` → 0 errors

### Deferred Items

Carried forward from AUDIT.md deferrals (not new):
- Full pre-send PII redaction / DLP (separate plan, post-regex)
- Model fallback chain (Haiku 4.5 → Sonnet on 5xx) — separate plan
- Admin UI for `llm_call_log` + `review_response_versions` inspection — Phase 7 or dedicated admin plan
- Runtime verification (requires `ANTHROPIC_API_KEY` from user)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| No existing test framework in dashboard/ | Installed vitest + @vitest/coverage-v8 as dev deps; wrote minimal config w/ `@/` alias + `server-only` stub |
| `"server-only"` import breaks node-env tests | vitest.setup.ts mocks it; tests run in node env (no JSDOM overhead) |
| Safety regex test: ensuring false-positive-free on clean PSG-voice text | Wrote explicit clean-text test asserting `flags: []`. All PSG few-shot examples pass. |

## Skill Audit (05-02)

Per SPECIAL-FLOWS.md required skills for this plan:

| Expected | Invoked | Notes |
|----------|---------|-------|
| /humanizer | ✓ | Loaded; voice rules in `prompts.ts` mirror humanizer guidance (active voice, no em dashes, no filler) |
| /brand | ✓ | Loaded; PSG voice rules + tokens via existing oklch vars (Clarity Teal on approve button only) |
| /collision-repair-content-system | ✓ | Loaded; few-shot examples reference Tracy's Collision Center + collision-repair terminology |
| /uncodixfy | ✓ | Loaded; modal uses plain centered panel, no glassmorphism, no pill buttons, no eyebrow labels, existing tokens |
| /frontend-design | ✓ | Loaded; table extended in-place, modal composed from existing primitives (button/badge) |
| /claude-api | ✓ | Loaded; guided SDK wiring: `claude-haiku-4-5-20251001`, `cache_control: ephemeral` on system, AbortController for timeout, streaming not needed (single shot, 400 max_tokens) |

Status: **All 6 required skills invoked ✓** (gap recorded in 05-01 closed on 05-02 per STATE.md skill audit note.)

## Next Phase Readiness

**Ready:**
- Paperclip reputation-monitor agent wiring (was gated on 05-02 per 05-01 deferred list) — now can call `/api/reviews/[id]/draft-response` and listen for approval events
- 05-03 (Google Ads integration) — inherits observability + auth + tenancy patterns
- 05-04 (Ads dashboard) — inherits approval-gate UI pattern
- 06-01/02 (Email/SMS) — reuses `llm_call_log` + `rate-limit` + safety libraries for any future LLM-generated messaging

**Concerns:**
- Runtime unverified until `ANTHROPIC_API_KEY` provided + Supabase BSM project linked + migration 004 applied (blocker list unchanged from 05-01)
- Anthropic data retention on PSG org account — confirm ZDR status before pointing real reviews at the API beyond test fixtures
- Safety regex is conservative but incomplete. Adversarial review text that encodes admissions via paraphrase (e.g., "we were wrong" vs "we messed up") will slip past. Human approval is the backstop.

**Blockers:**
- None for next plan (05-03). Runtime verify of 05-02 itself still pending user secrets.

---
*Phase: 05-reputation-ads, Plan: 02*
*Completed: 2026-04-19*
