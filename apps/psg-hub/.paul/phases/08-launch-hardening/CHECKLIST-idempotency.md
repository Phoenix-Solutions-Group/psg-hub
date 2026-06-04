# CHECKLIST: Webhook & Import Idempotency (S4)

**Status:** Binding for every new webhook handler and bulk import on psg-hub.
**Established:** Phase 3 (SendGrid + Twilio webhooks), consolidated Phase 8 / 08-02b.
**Companion to:** `.paul/phases/06-rbac-rls-spine/CHECKLIST-rls-review.md` (S1/RLS), `PROTOCOL-migration-safety.md` (S1/migrations).

Idempotency is a PROJECT.md constraint: *"Idempotency on every webhook + import."* External providers (SendGrid, Twilio, Stripe) deliver **at-least-once** — the same event WILL be delivered more than once (retries, network replays, dashboard re-sends). A handler that is not idempotent double-writes, double-charges, or double-notifies. This checklist is the one mechanism every handler reuses.

---

## The canonical mechanism

Five steps, in this order:

1. **Verify the signature/auth FIRST — before any parse or DB write.** Fail closed (reject) if the secret is unconfigured or the signature is missing/invalid. An unverified payload never reaches the database.
2. **Derive a stable idempotency key** from provider-supplied fields — never a value you generate at receive time (a fresh UUID or timestamp defeats dedup). The key must be identical across redeliveries of the same logical event.
3. **Anchor the key in a DB `UNIQUE` constraint** declared in a migration (migrations-as-code, per `PROTOCOL-migration-safety.md`). The database is the source of truth for "have I seen this." App-level "check then insert" is a race; the constraint is not.
4. **Write via `upsert(..., { onConflict: <key>, ignoreDuplicates: true })`** on the service-role client — a replayed key is a no-op, not an error and not a duplicate row.
5. **Ack 2xx after a successful persist** so the provider stops retrying. Return the failure status (4xx/5xx) only when verification or persistence genuinely failed.

The **UNIQUE constraint is the real anchor** — the upsert is how the app cooperates with it. Both are required; neither alone is sufficient.

---

## Live examples (shipped — source the pattern from these)

| Handler | Idempotency key | Constraint | Write | File |
|---------|-----------------|------------|-------|------|
| SendGrid events | `sg_event_id` (provider-supplied, single column) | `email_events` UNIQUE(`sg_event_id`) | `.upsert(rows, { onConflict: "sg_event_id", ignoreDuplicates: true })` | `src/app/api/webhooks/sendgrid/route.ts` |
| Twilio status + inbound | composite `(message_sid, status)` — one `message_sid` legitimately spans `queued`/`sent`/`delivered` rows; a replayed `(sid, status)` dedupes | `sms_events` UNIQUE(`message_sid, status`) | `.upsert([row], { onConflict: "message_sid,status", ignoreDuplicates: true })` | `src/app/api/webhooks/twilio/route.ts` |

**DB-side precedents (same UNIQUE-anchor discipline, non-webhook):**
- `review_responses` UNIQUE(`review_item_id`) — one governed draft per review (06-04).
- `llm_call_log` — append-only audit table, service-role only (06-05).

**Signature-verification note:** the verify step is provider-specific — SendGrid = ECDSA over the raw body (verify before JSON parse); Twilio = HMAC-SHA1 over the public request URL + alphabetically-sorted POST params (use the configured public base URL, never proxy-mutable `X-Forwarded-*`). Both fail closed.

---

## Pre-merge checklist (every new webhook or import)

- [ ] **Signature / auth verified before any DB write.** Fails closed when the secret is unset or the signature is invalid.
- [ ] **Idempotency key is provider-supplied and stable** across redeliveries (NOT a value generated at receive time).
- [ ] **A `UNIQUE` constraint on the key exists in a migration** (not just an app-level dedup check). Migration follows `PROTOCOL-migration-safety.md` (migrations-as-code, advisor-diff gated).
- [ ] **Write path is `upsert` with `ignoreDuplicates: true`** (or `ON CONFLICT DO NOTHING`/`DO UPDATE` as the semantics require) — never a bare `INSERT` on a path that can be replayed.
- [ ] **Service-role client for the persist** (webhooks have no user session; RLS would otherwise block or mis-scope the write).
- [ ] **Replay test exists:** the same payload delivered twice results in exactly one row (and no error on the second). Mirror the existing webhook route tests.
- [ ] **Ack semantics correct:** 2xx only after a successful persist; 4xx/5xx on verification or persistence failure so the provider retries.
- [ ] **Imports:** bulk imports carry the same discipline — a per-row natural key with a UNIQUE constraint + upsert, so a re-run of the import is a no-op on already-imported rows.

---

## Known gaps / carries

- **Stripe webhook — INSERT-not-UPSERT (S3, inherited defect).** `src/app/api/webhooks/stripe/route.ts` verifies the signature (`stripe.webhooks.constructEvent`) but persists with `.from("subscriptions").insert({...})` — a replayed `customer.subscription.*` event double-inserts. **Fix in the v0.4 Invoicing + Payments path** (the billing milestone that owns the subscriptions table): add a UNIQUE anchor (e.g. on the Stripe event id or subscription id) + switch to upsert. Tracked here, NOT fixed in Phase 8 (out of the launch-hardening scope; billing is v0.4).
- **Onboarding (`POST /api/onboarding`, 07-01)** is not a webhook — it is a multi-step service-role write ladder (client → shop → first-owner `shop_users` → `app_user_roles`) with **compensating cleanup** on failure rather than an upsert. Idempotency there is "no-downgrade on the role write + cleanup on partial failure," not a UNIQUE-anchored replay dedup. A double-submit currently creates a second client/shop pair; if onboarding ever becomes externally retryable, give it a natural-key UNIQUE (e.g. per-owner or per-shop-name) under this same checklist.

---
*S4 idempotency consolidation — Phase 8 / 08-02b, 2026-06-04*
