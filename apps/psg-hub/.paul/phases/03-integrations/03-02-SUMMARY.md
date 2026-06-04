---
phase: 03-integrations
plan: 02
subsystem: infra
tags: [twilio, sms, webhook, resilience, circuit-breaker, idempotency, hmac, supabase, next16]

requires:
  - phase: 03-integrations (03-01)
    provides: shared src/lib/resilience.ts (withRetry + CircuitBreaker) + the signature-verified idempotent webhook pattern
  - phase: 01-workspace-consolidation
    provides: psg-hub anchor app (Next 16) + service-role supabase client
provides:
  - "src/lib/sms — Twilio SMS adapter (createSmsSender factory + sendSms), Twilio-correct error classification"
  - "/api/webhooks/twilio — HMAC-SHA1 signature-verified, idempotent, dual-path (status-callback + inbound) webhook"
  - "sms_events table (composite UNIQUE(message_sid,status) idempotency key) on shared Supabase project"
affects: [03-04-vercel, sms-triggers (reminders/auth-fallback downstream)]

tech-stack:
  added: ["twilio ^6.0.2"]
  patterns:
    - "Second consumer of the shared resilience util — proves CircuitBreaker.execute(withRetry(...)) generalizes across providers"
    - "Provider-specific error classification: statusOf reads error.status (Twilio) vs error.code (SendGrid)"
    - "Form-encoded webhook: validateRequest(authToken, signature, env-reconstructed URL, PARSED params) — HMAC folds params, not raw body"
    - "Composite-key webhook idempotency (UNIQUE(message_sid,status)) where the provider has no single event id"

key-files:
  created:
    - src/lib/sms/types.ts
    - src/lib/sms/twilio.ts
    - src/lib/sms/__tests__/twilio.test.ts
    - src/app/api/webhooks/twilio/route.ts
    - src/app/api/webhooks/twilio/__tests__/route.test.ts
    - scripts/send-test-sms.mjs
  modified:
    - package.json
    - pnpm-lock.yaml
    - .env.example
    - vitest.setup.ts

key-decisions:
  - "Idempotency key = composite UNIQUE(message_sid, status), both NOT NULL — UNIQUE(message_sid) alone would collapse the queued→sent→delivered lifecycle; inbound uses status='received'"
  - "Webhook verification via twilio.validateRequest over an ENV-reconstructed public URL + PARSED POST params (NOT request.url, NOT raw body) — TWILIO_AUTH_TOKEN is the HMAC secret, so no separate verification-key var"
  - "statusOf reads error.status (HTTP) — the inverse of the SendGrid adapter (which reads error.code); reusing it verbatim would misclassify every Twilio error"
  - "sms_events migration applied to shared project gylkkzmcmbdftxieyabw (additive, RLS on, no public policies); no profile_id (infra event log, mirrors email_events)"
  - "Webhook live signature verification deferred to 03-04 (needs a stable public URL — clean parallel to 03-01's deferred webhook-row verify)"

patterns-established:
  - "Provider-agnostic messaging adapter shape: createXSender factory over a lazy-singleton SDK client, resilience seams injectable for deterministic tests"
  - "Twilio webhook: env-reconstructed URL (trailing-slash normalized, query preserved) → validateRequest with parsed params → idempotent composite-key upsert → ack after persist (204 status-callback / text/xml TwiML inbound)"

duration: ~1 session (active build ~35min incl. adversarial review; operator secrets+live-send checkpoint in the middle)
started: 2026-06-01T12:35:00Z
completed: 2026-06-01T13:00:00Z
---

# Phase 3 Plan 02: Twilio Summary

**Transactional SMS wired through Twilio: a resilient SMS adapter reusing the shared retry + circuit breaker (03-01), a single signature-verified idempotent webhook handling BOTH outbound delivery status callbacks and inbound messages into a new `sms_events` table, with operator-provisioned credentials and a live send confirmed by phone receipt.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 session (operator checkpoint in the middle) |
| Tasks | 3 (2 auto + 1 human-action checkpoint) |
| Files created | 6 (+ 1 DB migration) |
| Files modified | 4 |
| Tests | +19 new (182 total, all green) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Resilient SMS send | **PASS** | `sendSms` retries 429/5xx/network with bounded backoff, does not retry permanent 4xx (typed `SmsError`), breaker trips on transient only. 7 adapter unit tests. `statusOf` reads `error.status` (Twilio-correct). |
| AC-2: Idempotent, signature-verified, dual-path webhook | **PASS** | `twilio.validateRequest` over the env-reconstructed public URL + parsed POST params (missing sig → 400, invalid → 403, missing token/base-url → 500); `upsert(onConflict "message_sid,status", ignoreDuplicates)` against `sms_events`; branch on `MessageStatus` → 204 status-callback / empty-TwiML `text/xml` inbound; 500 on persist-fail. 12 route tests. |
| AC-3: Operator provisioning + live send | **PASS (send) / DEFERRED (webhook live verify)** | Operator set TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER in `.env.local` (no Messaging Service → bare-from path). Live send `SMe1f86eae4a7ff0b20c83f2e48e695552` returned `queued` from `+19735325352`; phone receipt confirmed by operator. Webhook live signature verify → 03-04 (public URL). |

## Accomplishments

- Twilio SMS adapter (`createSmsSender` + `sendSms`) reusing `src/lib/resilience.ts` verbatim — the second consumer, proving the resilience foundation generalizes across providers.
- Correct Twilio error classification (`statusOf` reads `error.status`, not `.code`) — the highest-risk divergence from the SendGrid mirror, caught at plan time and implemented correctly.
- One dual-path `/api/webhooks/twilio` route: HMAC-SHA1 verified (env-reconstructed URL + parsed params), idempotent via a composite key, with the correct ack per event type.
- `sms_events` table on the shared Supabase project (RLS enabled, 0 public policies, `UNIQUE(message_sid, status)` with both columns NOT NULL — the load-bearing idempotency invariant).
- Verified the real send path end-to-end: live SMS queued + physically received.

## Skill audit

No `.paul/SPECIAL-FLOWS.md` configured — skill audit not applicable.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/sms/types.ts` | Created | `SmsMessage`, `SmsResult`, typed `SmsError` |
| `src/lib/sms/twilio.ts` | Created | `createSmsSender` + `sendSms` (retry + breaker wrap); Twilio-correct `statusOf`/`isRetryableTwilioError` |
| `src/lib/sms/__tests__/twilio.test.ts` | Created | 7 unit tests (success, retry, no-retry, circuit-open, missing-sender, predicate) |
| `src/app/api/webhooks/twilio/route.ts` | Created | Signature-verified, idempotent, dual-path webhook |
| `src/app/api/webhooks/twilio/__tests__/route.test.ts` | Created | 12 route tests (verify, idempotency, dual-path, fail-closed, URL-recon) |
| `scripts/send-test-sms.mjs` | Created | One-off live-send verifier (no secrets; loads `.env.local`) |
| `package.json` / `pnpm-lock.yaml` | Modified | `twilio ^6.0.2` |
| `.env.example` | Modified | Documented TWILIO_* vars (+ TWILIO_WEBHOOK_BASE_URL carry-over) |
| `vitest.setup.ts` | Modified | Deterministic TWILIO_* test env |
| (DB) `sms_events` | Created | Migration `create_sms_events` on `gylkkzmcmbdftxieyabw` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Composite `UNIQUE(message_sid, status)`, both NOT NULL | Twilio has no single event id; status callbacks fire once per lifecycle transition (distinct rows), retries of one transition dedupe; Postgres treats NULLs in a unique index as distinct (silent dedup failure) so both columns must be NOT NULL | Idempotency holds across status callbacks + inbound without collapsing the lifecycle |
| `validateRequest` over env-reconstructed URL + parsed params | `request.url` is the internal proxy URL on Vercel; forwarded headers are attacker-mutable; Twilio folds parsed POST params into the HMAC (not the raw body) | Robust verification; auth token doubles as the secret (no separate var) |
| `statusOf` reads `error.status` | Twilio puts HTTP status in `.status` and the vendor code in `.code` — inverse of SendGrid | Correct transient/permanent classification |
| Migration on shared project, no `profile_id` | `sms_events` is an infra event log (like `email_events`), not a profile-tied table | Zero blast radius; mirrors email_events posture |
| Webhook live verify deferred → 03-04 | Needs a stable public URL (none until the Vercel re-link) | Tracked carry-over, not a defect |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (review findings) | 2 | Hardening; no behavior regression |
| Scope additions | 1 | `scripts/send-test-sms.mjs` dev verifier (no secrets) |
| Minor (impl detail) | 1 | Dropped unused `RestException` import |
| Deferred | 1 | Webhook live signature verify → 03-04 |

**Total impact:** No scope creep in shipped behavior; the two auto-fixes hardened the highest-risk path (URL reconstruction) before the deferred live verify.

### Auto-fixed (adversarial review, real twilio@6)

1. **Trailing-slash in `TWILIO_WEBHOOK_BASE_URL` → 100% signature rejection** — A pasted `https://host/` would build `https://host//api/...`, whose HMAC mismatches every legitimate request (fails CLOSED — availability bug, not a bypass). Fixed: `base.replace(/\/+$/, "")` before concatenation. Empirically proven against the real twilio package.
2. **Query-string preservation untested** — Dropping `${requestUrl.search}` would silently break query-bearing webhook URLs (the query is part of the HMAC) with no test catching it. Fixed: added a query-preservation test + a trailing-slash-tolerance test.

### Minor

- Dropped the `RestException` import — `statusOf` is structural (`"status" in error`), mirroring the mail adapter's structural `statusOf`. Avoids an unused import; no shipped-behavior change. Within the plan's "OR structural fallback" spec.

### Deferred Items

- Webhook live signature verification (status-callback delivered-row + inbound) → **03-04** (after the Vercel re-link provides a stable public URL). Code + table are unit-proven now.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Unit mocks can't catch a wrong `validateRequest` arg order / SDK-shape mismatch (mock would pass while live fails) | Ran an adversarial review workflow against the real `twilio@6` on disk before the live-send checkpoint; confirmed arg order + error shape; the 2 medium findings it surfaced were fixed + re-qualified |
| No Messaging Service SID provisioned | Adapter + script support the bare `from` (TWILIO_PHONE_NUMBER) path; live send verified via the bare number; Messaging Service remains the production default when configured |

## Verification Results

- `pnpm typecheck` → clean
- `pnpm test` → 182/182 (19 files; +19 new)
- `pnpm lint` → 0 errors (1 pre-existing warning in `src/lib/supabase/middleware.ts`, not introduced here)
- `sms_events` confirmed via `execute_sql`: RLS enabled, 0 policies, `UNIQUE(message_sid, status)`, `message_sid` + `status` NOT NULL
- Live: `node --env-file=.env.local scripts/send-test-sms.mjs <operator-mobile>` → `OK status=queued sid=SMe1f86eae…`, phone receipt confirmed

## Next Phase Readiness

**Ready:**
- SMS send path operational in dev (`.env.local`, bare-from).
- Webhook + composite-key idempotency pattern reusable; resilience util now proven across two providers.
- `sms_events` live on the shared project.

**Concerns:**
- Webhook live signature verification still owed at 03-04 (public URL + `TWILIO_WEBHOOK_BASE_URL` wired to the real host).
- Production env vars (TWILIO_*) must be added to Vercel in 03-04 (currently dev `.env.local` only).
- No Messaging Service SID yet — production should configure one (sender pool, failover, STOP/START compliance) and set `TWILIO_MESSAGING_SERVICE_SID`.

**Blockers:** None for 03-03 (Sanity — independent, wave 1).

---
*Phase: 03-integrations, Plan: 02*
*Completed: 2026-06-01*
