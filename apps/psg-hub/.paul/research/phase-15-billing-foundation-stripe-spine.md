# RESEARCH — Phase 15: Billing foundation + Stripe spine

**Date:** 2026-06-18
**Milestone:** v0.4 Invoicing + Payments
**Method:** 3 parallel agents — codebase audit (Explore) + Stripe-spine best practice (web) + PII-at-rest (web). Sources cited inline below.
**Status:** Findings for review. Informs /paul:plan — does NOT auto-integrate.

---

## ⭐ HEADLINE — this reshapes v0.4

**Stripe is already substantially wired in psg-hub** (inherited from BSM, on prod). The original v0.4 framing ("Invoiced.com mirror + Stripe coexistence") under-described what exists. Reality:

**ALREADY BUILT (REUSE):**
| Asset | Path | Note |
|-------|------|------|
| Stripe client singleton | `src/lib/stripe.ts` | SDK v22.0.1, apiVersion pinned `2026-05-27.dahlia` |
| Subscription checkout | `src/app/api/billing/checkout/route.ts` | `checkout.sessions` mode=subscription; `user_id`+`tier` in metadata |
| Billing Portal | `src/app/api/billing/portal/route.ts` | hosted customer portal (update/cancel) |
| Stripe webhook | `src/app/api/webhooks/stripe/route.ts` | sig-verified; handles checkout.session.completed + customer.subscription.updated/deleted |
| Billing UI | `src/app/dashboard/billing/page.tsx` | 3 tiers essentials/growth/performance ($199/$499/$999) |
| `subscriptions` table + RLS | migrations | shop_id UNIQUE, stripe_subscription_id UNIQUE; SELECT=membership, writes=service-role |
| Price IDs | `.env.example` | `STRIPE_{ESSENTIALS,GROWTH,PERFORMANCE}_PRICE_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

**Consequence for the milestone (VERIFIED by direct file reads, not just the audit):** the subscription scaffolding **EXISTS but is UNVERIFIED on psg-hub prod and carries ≥3 known defects** — (1) the S3 `.insert()` (route.ts:56), (2) the Basil `current_period_end` read (route.ts:71), (3) vestigial `shops.subscription_tier` + the `multi_location` enum mismatch. "Existing ≠ working." So Phase 16 (Subscription self-serve) is better framed as **harden + reconcile + validate-on-prod**, not greenfield — but it is NOT "done." The genuinely greenfield work is **Phase 17 (invoices/payments mirror)** + the **Phase 15 foundation** (webhook-event idempotency table, invoice/payment data model, PII-at-rest). Phase-16 sizing is a separate question from the Invoiced.com decision (below) — do NOT conflate.

---

## 1. The S3 INSERT→UPSERT defect — CONFIRMED, exact location

- **File:** `src/app/api/webhooks/stripe/route.ts` ~line 56, `checkout.session.completed` handler.
- **Bug:** `.insert()` with no `.select()` / no error check. On webhook **redelivery** (Stripe is at-least-once) or a re-subscribe, the `subscriptions.shop_id UNIQUE` constraint raises duplicate-key — silently swallowed. Row keeps the **stale tier**; `tier/gate.ts` then gates on the wrong tier.
- **Fix (research-backed):** two parts —
  1. **Inbound idempotency table** (NEW): `stripe_webhook_events(event_id text PRIMARY KEY, type, api_version, created timestamptz, payload jsonb, received_at, processed_at)`. Gate every webhook on `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id` — empty result = duplicate → skip (nets zero rows, re-runs no side effects). This is the same pattern Phase 3 already uses for `email_events.sg_event_id UNIQUE` / `sms_events UNIQUE(message_sid,status)`.
  2. **Subscription upsert:** change the `.insert()` to `.upsert(..., { onConflict: 'stripe_subscription_id' })` + error handling, so a tier change updates in place.
- Source: Stripe webhooks best-practice; Postgres `INSERT ... ON CONFLICT`. NOTE the agent's nuance — for the **event dedupe** table use `DO NOTHING` (not `DO UPDATE`); for the **subscription state** row use upsert/`DO UPDATE` (you DO want the new tier to win).

## 2. ⚠️ Basil API field relocations — LATENT BUG in the existing webhook

Every 2026 Stripe API version inherits `2025-03-31.basil`, which **moved three fields** the code depends on. Pre-Basil paths now read `undefined` at runtime under the pinned `2026-05-27.dahlia`:

| Need | Pre-Basil (WRONG now) | Post-Basil (correct) |
|------|----------------------|----------------------|
| Sub period end (drives access expiry) | `subscription.current_period_end` | `subscription.items.data[].current_period_end` |
| Invoice→subscription link | `invoice.subscription` | `invoice.parent.subscription_details.subscription` |
| Invoice→payment link | `invoice.payment_intent`/`charge` | `invoice.payments.data[].payment.payment_intent` (list; partial payments) |

**The existing `customer.subscription.updated` handler reads `current_period_end` at the subscription level** (audit, ~line 68) → under the pinned version this is likely already storing wrong/empty period ends. Phase 15 must fix this when it touches the webhook. Source: Stripe Basil changelog + Invoice object ref (cited in the web report).

## 3. Stripe spine — confirmed conventions (reuse, don't reinvent)

- **App Router raw body:** `await req.text()` then `stripe.webhooks.constructEvent` — NO `bodyParser` config (stale Pages-Router pattern). `runtime='nodejs'`, `dynamic='force-dynamic'`. Exclude the route from any auth middleware. (Existing route already verifies signature — confirm raw-body handling.)
- **Fast 2xx, async processing:** return 200 fast, do work async; Stripe retries on timeout/5xx, NOT on 4xx. Ack `invoice.created` fast (auto-collection waits up to 72h on it).
- **Out-of-order delivery:** events are not ordered. Make handlers idempotent + order-independent; for stale-prone payloads re-fetch via `stripe.subscriptions.retrieve(id)` rather than trusting the embedded snapshot; optionally guard on `event.created`.
- **Outbound idempotency keys** on every mutating POST; derive the key from the logical operation (e.g. `charge:order_<id>`), not a fresh `randomUUID()` at the call site, so cross-restart retries dedupe.
- **Secret rotation:** support dual-secret verification (`STRIPE_WEBHOOK_SECRET` + `_OLD`) for the 24h grace window.
- **SDK:** exact-pin the npm package (`--save-exact`); keep `apiVersion` on a STABLE dated version (never `.preview`). v22 current.
- **MoR / single account = NO Stripe Connect** — never send `Stripe-Account`, never `application_fee_amount`. One Stripe Customer ↔ one shop.
- Events to subscribe (foundation): `customer.subscription.{created,updated,deleted}`, `invoice.{created,finalized,paid,payment_failed}`, `payment_intent.{succeeded,payment_failed}`. Use `invoice.paid` (not the older `invoice.payment_succeeded`).

## 4. Data model to BUILD (minimal mirror)

Reuse the proven service-role-write + membership-SELECT RLS pattern (`subscriptions`/`google_oauth_accounts`/`email_events`).

- `stripe_webhook_events` — idempotency/audit (above).
- `invoices(stripe_invoice_id PK, shop_id fk, stripe_subscription_id, status, amount_due bigint, amount_paid bigint, currency, number, hosted_invoice_url, period_start/end, created_at)`.
- `payments(stripe_payment_intent_id PK, shop_id/customer fk, stripe_invoice_id nullable, status, amount bigint, currency, created_at)`.
- (`invoice_line_items` optional — omit until a UI phase needs it; keep line items in Stripe, fetch on demand.)
- **Reconcile tier source-of-truth:** `shops.subscription_tier` (4-value CHECK incl. `multi_location`) is **vestigial/unused** — gate + webhook both use `subscriptions.tier` (3-value TS enum, missing `multi_location`). Phase 15 should remove `shops.subscription_tier` (recommended) OR sync it, and reconcile the `multi_location` mismatch.

## 5. PII-at-rest — REUSE existing precedent

- **Reuse the existing app-key AES-256-GCM util** (`src/lib/google-ads/crypto.ts`, already re-exported by `google-oauth/crypto.ts`; versioned key map, `bytea` + `key_version`). **Reject pgsodium** (Supabase "does not recommend"; pending deprecation) and **Supabase Vault** (secrets store, not per-row column PII).
- **Existing internal precedent to mirror:** `psg-advantage-portal/supabase/migrations/` has a private `sensitive` schema (RLS-locked, service-role-only, `pii_access_log` + `SECURITY DEFINER log_pii_access` + a batch-redaction `LOOP ... LIMIT 25000` migration). Phase 15 mirrors this exactly → minimal + buildable.
- **3-way data taxonomy** (drives encryption + retention):
  - **Encrypt** (column-level, AES-256-GCM): billing name, email, address.
  - **Cleartext + retained + queryable** (the financial record): amounts, currency, dates, `last4`, `brand`, `exp_*`, status. (Stripe confirms last4/brand/exp are non-CHD, storable.)
  - **Cleartext join keys:** Stripe customer/subscription/invoice/payment_intent ids.
- **NEVER store the PAN.** Tokenize via Stripe. Prefer Stripe **Checkout** to stay cleanly in **PCI SAQ A** (the SAQ letter does NOT change the storable field set either way).
- **Retention = 7 years (IRS basis** — PSG is US MOR; 3yr base / 6yr if >25% underreport / 7yr bad-debt → 7yr default). **Redact-don't-delete** on erasure: null the encrypted identity fields, keep the financial record + keys until the 7yr clock, then hard-delete. GDPR Art.17(3)(b) + CCPA legal-obligation exception are the erasure carve-outs.
- **Non-goals (anti-gold-plating):** no envelope/KMS/per-row DEK, no pgsodium, no Vault-for-columns, no HMAC blind index, no mandatory cron (post-retention sweep = on-demand migration). Random-IV util ⇒ encrypted fields non-searchable by design; Stripe customer id is the lookup key.

## 6. Migration protocol (binding)

- `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md`. Shared prod `gylkkzmcmbdftxieyabw` (~314k PII rows / 142 shops).
- Apply via **MCP `apply_migration`** (the 12-05/13-04/14-04 precedent), NOT `db push`; one idempotent reversible transaction; **advisor security baseline + diff** after each, no new ERROR/WARN; per-table RLS review.
- New billing tables: RLS-on, authenticated SELECT = membership-scoped, ALL mutations via `createServiceClient()`.

## 7. Resilience

Wrap all outbound Stripe API calls in `withRetry()` + a shared module-level `StripeCircuitBreaker` (`src/lib/resilience.ts`), mirroring the SendGrid/Twilio/Google adapters. NOT a per-call breaker.

---

## Open questions / scope (gate /paul:plan)

1. **✅ RESOLVED 2026-06-18 (operator call): invoicing is STRIPE-NATIVE; Invoiced.com dropped.** Phase 17 surfaces/mirrors Stripe Invoices — no external invoice integration. Original framing below for the record: a BUSINESS decision, surfaced because the COST shifted — No Invoiced.com integration exists in the repo — but that is *expected* (Phase 17 is unbuilt future work), so it is NOT evidence against the operator's earlier "read-only mirror" choice. The legitimate reason to revisit: Stripe is already wired here, so **Stripe-native invoicing is now cheaper than when the choice was made** (one already-half-built integration vs standing up a new Invoiced.com read client). The decision itself is the operator's business call: is Invoiced.com PSG's invoice system-of-record, and is there intent to consolidate billing onto Stripe (with the AR / invoice-history implications that carries)? Surface the cost shift + ask; do not steer. (Minor: one incidental `invoiced` string match in the schema dump `20260602105554_remote_schema.sql` — no integration code; treat as noise unless it proves otherwise.)
2. **Phase 16 sizing (SEPARATE from #1)** — subscriptions further along than the roadmap implied, but unverified + defect-carrying. Recommend the planner treat 16 as "harden + reconcile + prod-validate," not greenfield and not "done." Possibly fold the 15/16 hardening together. This affects Phase-16 scope only.
3. **`shops.subscription_tier` vestigial** — confirm remove vs sync; reconcile the `multi_location` 4th tier (in DB CHECK, absent from the TS enum).
4. **Basil latent bug** — fix the existing `current_period_end` read as part of 15.

---

*Sources: Stripe docs (webhooks, subscriptions/webhooks, idempotent requests, Basil changelog, Invoice object, SDK versioning), Supabase pgsodium/Vault docs, IRS record-retention, GDPR Art.17, PCI SAQ A guidance — full URLs in the agent returns. context7 resolve-library-id failed (env wrapper bug); web agents sourced official docs directly.*
