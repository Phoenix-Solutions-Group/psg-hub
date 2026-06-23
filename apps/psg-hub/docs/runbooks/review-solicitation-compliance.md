# Review solicitation (SMS + email) — compliance + QA runbook (PSG-248)

Wave 2 (G-c). Proactive review solicitation governed through the PSG-245 approval
queue. This doc is the reference for the **compliance review** and **Tess QA**, and
the **operator go-live** checklist.

## Flow (governed; nothing sends without a human approve)

1. **Draft + govern** — `enqueueSolicitation()` (`src/lib/ops/solicitation/enqueue.ts`)
   renders the copy, mints the per-recipient unsubscribe link, **refuses** any draft
   that fails the compliance check, and queues it as approval_queue `action_type =
   "review_solicitation"` (status `pending`). A daily cron / route is a thin wrapper
   that picks recipients and calls this once each.
2. **Approve** — an owner/manager approves via `POST /api/approvals/{id}/approve`.
   The decision is written to the append-only `access_audit` log (`approval.approve`).
3. **Send (ON APPROVE ONLY)** — the registered `review_solicitation` publisher
   (`publisher.ts`) re-derives the compliance decision at send time, sends over the
   consenting channels (SendGrid / Twilio), and writes one immutable audit row per
   channel. Rejecting never sends.

## Compliance posture

| Requirement | Where enforced |
|---|---|
| **TCPA** — SMS only with prior express consent | `plan.ts` skips SMS unless `consent.sms === true` (reason `no_consent`) |
| **TCPA/CTIA** — STOP / START / HELP | `optout.ts` classifies; `POST /api/sms/webhook` records opt-out/opt-in (idempotent on MessageSid) |
| **CAN-SPAM** — unsubscribe link + physical postal address in every email | `draft.ts` bakes both in; `validateDraftCompliance()` re-checks; enqueue **refuses** a non-compliant draft |
| **CAN-SPAM** — honor unsubscribe (10-day) | unsubscribe recorded immediately; publisher re-checks opt-out at send time |
| **One-click unsubscribe (RFC 8058)** | `POST /api/unsubscribe` + `List-Unsubscribe` token |
| **Suppression overlap** | publisher calls the mail suppression engine when a `householdKey` is carried — a customer who opted out of direct mail is not solicited |
| **Send audit** | `review_solicitation_sends` (append-only): one row per channel — sent / failed / **skipped (+reason)** |
| **PII-min** | contacts matched on a salted HMAC (`em_…` / `ph_…`); raw email/phone never stored in the opt-out / audit tables |

Opt-out is **provable**: `solicitation_opt_outs` is append-only (a `private`
trigger rejects UPDATE/DELETE for all roles, service_role included), so you can
always show when and how a contact opted out. Current status = latest event.

## Webhook / route security

- `/api/sms/webhook` verifies the Twilio request signature (`twilio.validateRequest`
  over the configured URL + raw params); **fails closed** (500) if `TWILIO_AUTH_TOKEN`
  is unset; 403 on a bad signature. Idempotent on `MessageSid`.
- `/api/unsubscribe` honors only an **HMAC-signed** token (forged/tampered tokens →
  400; constant-time compare). Idempotent (event_ref derived from the verified
  contact).

## Operator go-live checklist (DO NOT send live without this)

1. **Confirm the SMS vendor + spend.** Twilio is already integrated
   (`src/lib/sms/twilio.ts`); a live SMS program is a recurring cost. Confirm the
   Twilio account, Messaging Service / A2P 10DLC registration, and the monthly spend
   ceiling **before** enabling live sends.
2. Set secrets (Vercel env): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_MESSAGING_SERVICE_SID` (preferred) or `TWILIO_PHONE_NUMBER`,
   `TWILIO_SMS_WEBHOOK_URL`; `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`;
   `MAIL_HASH_SALT` (shared) or `SOLICITATION_HASH_SALT`; `UNSUBSCRIBE_TOKEN_SECRET`.
3. Point the Twilio Messaging Service inbound webhook at `/api/sms/webhook` and add
   the unsubscribe URL to the email `List-Unsubscribe` headers.
4. Apply migration `20260624140000_review_solicitation.sql` (operator-gated, per the
   v1.x migration policy).

## QA test plan (Tess)

Code-level (all green on `feat/psg-248`): `tsc` 0, `eslint` 0, full vitest 1994
pass / 4 skip; new-code coverage (perFile ≥70 gate) — solicitation 97.6%,
sms/webhook 90.3%, unsubscribe 82.8%.

Acceptance probes to confirm against the REAL modules:

1. **Draft + govern** — `enqueueSolicitation` queues a `pending` row with a
   compliant draft; an email draft with no recipient email is **refused**
   (`SolicitationComplianceError`).
2. **Send on approve only** — publisher sends email + SMS for a consenting recipient;
   a reject never sends (gate invariant, PSG-245).
3. **TCPA consent** — SMS skipped (`no_consent`) when `consent.sms !== true`; email
   still sends.
4. **STOP** — `POST /api/sms/webhook` with `Body=STOP` records `opted_out`; a later
   send to that number is skipped (`opted_out`). Multi-word "please don't stop" does
   NOT opt out. Bad signature → 403.
5. **Unsubscribe** — `/api/unsubscribe` with a valid signed token records
   `email_unsubscribe`; forged token → 400; double-click is idempotent.
6. **Suppression overlap** — with a `householdKey` on the mail opt-out list, all
   channels skip (`suppressed`).
7. **Idempotency** — a re-published approval does not re-send an already-recorded
   (approval, channel, contact); webhook replay collapses on `event_ref`.
8. **Append-only** — UPDATE/DELETE on either new table raises (trigger + REVOKE);
   RLS: `review_solicitation_sends` readable only by shop members,
   `solicitation_opt_outs` service-role only.

A live end-to-end send is **operator-gated** (Twilio spend confirmation); QA's live
smoke runs after go-live, as with the other v1.x send modules.
