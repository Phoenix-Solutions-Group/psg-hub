---
phase: 03-integrations
plan: 01
subsystem: infra
tags: [sendgrid, email, webhook, resilience, circuit-breaker, idempotency, supabase, next16]

requires:
  - phase: 01-workspace-consolidation
    provides: psg-hub anchor app (Next 16) + service-role supabase client
  - phase: 02-design-system
    provides: branded app shell (unaffected; no UI in this plan)
provides:
  - "src/lib/resilience.ts — shared withRetry + CircuitBreaker (reused by 03-02 Twilio)"
  - "src/lib/mail — SendGrid mail adapter (createMailSender factory + sendEmail)"
  - "/api/webhooks/sendgrid — signature-verified, idempotent event webhook"
  - "email_events table (UNIQUE sg_event_id idempotency key) on shared Supabase project"
affects: [03-02-twilio, 03-04-vercel, email-triggers (auth/receipts downstream)]

tech-stack:
  added: ["@sendgrid/mail ^8.1.6", "@sendgrid/eventwebhook ^8.0.0"]
  patterns:
    - "Shared resilience util (retry + circuit breaker) for all external calls"
    - "Lazy-singleton SDK client (mirror getStripe)"
    - "Webhook idempotency via DB UNIQUE constraint + upsert ignoreDuplicates"

key-files:
  created:
    - src/lib/resilience.ts
    - src/lib/mail/types.ts
    - src/lib/mail/sendgrid.ts
    - src/app/api/webhooks/sendgrid/route.ts
    - scripts/send-test-email.mjs
  modified:
    - package.json
    - .env.example
    - vitest.setup.ts

key-decisions:
  - "email_events migration applied to shared project gylkkzmcmbdftxieyabw (additive, RLS on, no public policies)"
  - "createMailSender factory so breaker/retry are injectable for fast deterministic tests (no test-only public API)"
  - "Circuit breaker trips on transient errors only (429/5xx) — a permanent 4xx is a caller bug, not a provider outage"
  - "Webhook event-row live verification deferred to 03-04 (needs public URL; operator chose option a)"

patterns-established:
  - "External-call resilience: wrap SDK call in CircuitBreaker.execute(withRetry(...))"
  - "Webhook: raw body → signature verify → idempotent service-role upsert → 200 only after persist"

duration: ~1 session (active build ~30min; total incl. operator domain-auth checkpoint)
started: 2026-06-01T11:15:00Z
completed: 2026-06-01T16:10:00Z
---

# Phase 3 Plan 01: SendGrid Summary

**Transactional email wired through SendGrid: a resilient mail adapter (shared retry + circuit breaker), a signature-verified idempotent Event Webhook persisting to a new `email_events` table, with operator domain authentication on `psgweb.me` confirmed by a live 202 send + inbox receipt.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 session (operator checkpoint in the middle) |
| Tasks | 3 (2 auto + 1 human-action checkpoint) |
| Files created | 5 (+ 1 DB migration) |
| Files modified | 3 |
| Tests | +27 new (163 total, all green) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Resilient mail send | **PASS** | `sendEmail` retries 429/5xx with bounded backoff, does not retry permanent 4xx (typed `MailError`), breaker short-circuits after threshold. 12 resilience + 8 mail unit tests. |
| AC-2: Idempotent verified webhook | **PASS** | ECDSA signature verify (invalid/missing → 400), `upsert(onConflict sg_event_id, ignoreDuplicates)` against `email_events` (UNIQUE), 200 only after persist, 500 on failure for safe retry. 7 route tests. |
| AC-3: Domain auth + live delivery | **PASS (send) / DEFERRED (webhook-row)** | Operator completed API key + SPF/DKIM domain auth + Event Webhook + `.env.local`. Live send returned 202 from `setup@psgweb.me`; inbox receipt confirmed. The `delivered`-event-row half needs a public URL → deferred to 03-04 (operator chose option a). |

## Accomplishments

- Shared `src/lib/resilience.ts` (`withRetry` + `CircuitBreaker`, injectable clock/sleep/jitter) — the resilience foundation 03-02 (Twilio) will reuse.
- SendGrid mail adapter with a `createMailSender` factory + default `sendEmail`; transient-only breaker tripping; typed `MailError`.
- Idempotent, signature-verified `/api/webhooks/sendgrid` mirroring the proven Stripe webhook pattern.
- `email_events` table on the shared Supabase project (RLS enabled, no public policies, `sg_event_id` UNIQUE = idempotency key).
- Verified the real path end-to-end on the send side: domain-authenticated 202 + inbox delivery.

## Skill audit

No `.paul/SPECIAL-FLOWS.md` configured — skill audit not applicable.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/resilience.ts` | Created | Shared `withRetry` + `CircuitBreaker` (pure, injectable seams) |
| `src/lib/__tests__/resilience.test.ts` | Created | 12 unit tests (retry, backoff cap, breaker states) |
| `src/lib/mail/types.ts` | Created | `MailMessage`, `MailResult`, typed `MailError` |
| `src/lib/mail/sendgrid.ts` | Created | `createMailSender` + `sendEmail` (retry + breaker wrap) |
| `src/lib/mail/__tests__/sendgrid.test.ts` | Created | 8 unit tests (success, retry, no-retry, circuit-open, no-from) |
| `src/app/api/webhooks/sendgrid/route.ts` | Created | Signature-verified, idempotent event webhook |
| `src/app/api/webhooks/sendgrid/__tests__/route.test.ts` | Created | 7 route tests (verify, idempotency, 400/500 paths) |
| `scripts/send-test-email.mjs` | Created | One-off live-send verifier (no secrets; loads `.env.local`) |
| `package.json` / `pnpm-lock.yaml` | Modified | `@sendgrid/mail`, `@sendgrid/eventwebhook` |
| `.env.example` | Modified | Documented SENDGRID_* vars |
| `vitest.setup.ts` | Modified | Deterministic SENDGRID_* test env |
| (DB) `email_events` | Created | Migration `create_email_events` on `gylkkzmcmbdftxieyabw` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Migration applied to shared project `gylkkzmcmbdftxieyabw` | Additive table, RLS on + no public policies → zero blast radius to existing tenants | `email_events` available to all hub envs |
| `createMailSender` factory pattern | Lets tests inject a fast-tripping breaker / zero-delay retry without polluting the public API | Fast, deterministic unit tests |
| Breaker trips on transient errors only (429/5xx) | A permanent 4xx is a caller bug, not a provider outage | Circuit won't open on bad-request loops |
| Webhook event-row verify deferred to 03-04 | SendGrid needs a public URL to POST events; none exists until the Vercel deploy | Tracked carry-over, not a defect |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (test-only) | 2 | None on shipped code |
| Scope additions | 1 | `scripts/send-test-email.mjs` dev verifier (no secrets) |
| Deferred | 1 | Webhook event-row verify → 03-04 |

**Total impact:** No scope creep in shipped code; one deferred verification with a clear owner (03-04).

### Auto-fixed (test-only)

1. **vitest mock hoisting (TDZ)** — Found during Task 1 qualify. `vi.mock` factory referenced top-level mock fns before init → switched to `vi.hoisted`. Shipped code unaffected.
2. **Constructable `EventWebhook` mock** — Found during Task 2 qualify. Arrow-fn `mockImplementation` isn't a constructor; the route correctly caught the thrown error and failed closed (400). Fixed the mock to use a `function`. This actually validated the route's fail-closed behavior.

### Deferred Items

- Webhook `delivered`-event-row live verification → **03-04** (after Vercel deploy provides a public webhook URL). Code + table are unit-proven now.

### Notes

- Next 16 docs bundle (`node_modules/next/dist/docs`) is not present in this install; mirrored the in-repo Stripe webhook (the proven Next 16 route-handler pattern) instead.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Test mocks failing (hoisting + non-constructable mock) | Fixed in qualify loop (`vi.hoisted` + `function` mock); all 163 tests green |
| Live webhook receipt not verifiable locally | Deferred to 03-04 (public URL); send half fully verified via 202 + inbox |

## Verification Results

- `pnpm typecheck` → clean
- `pnpm test` → 163/163 (17 files; +27 new)
- `pnpm lint` → 0 errors (1 pre-existing warning in `src/lib/supabase/middleware.ts`, a boundary file, not introduced here)
- `email_events` confirmed via `list_tables`: RLS enabled, `sg_event_id` UNIQUE, 8 columns + comment
- Live: `node --env-file=.env.local scripts/send-test-email.mjs` → status 202, inbox receipt confirmed

## Next Phase Readiness

**Ready:**
- `src/lib/resilience.ts` ready for 03-02 (Twilio SMS adapter) to reuse verbatim.
- Webhook + idempotency pattern reusable for the Twilio webhook.
- SendGrid send path operational in dev (`.env.local`).

**Concerns:**
- Webhook event-row verification still owed at 03-04 (public URL).
- Production env vars (SENDGRID_*) must be added to Vercel in 03-04 (currently dev `.env.local` only).

**Blockers:** None for 03-02 (independent, wave 1).

---
*Phase: 03-integrations, Plan: 01*
*Completed: 2026-06-01*
