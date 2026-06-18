# Milestone Context

**Generated:** 2026-06-18
**Status:** Ready for /paul:milestone

## Features to Build

v0.4 is the **v1.0 customer launch** milestone: let a collision-repair shop see and pay everything it owes PSG — one-off invoices and the recurring platform subscription — then clear the remaining gates to launch.

- **Subscription self-serve (recurring):** Stripe Checkout + Customer Billing Portal so a shop can self-serve subscribe and upgrade/downgrade its platform tier (`essentials` / `growth` / `performance`), wired to the existing `src/lib/tier/gate.ts`; webhook keeps the shop's stored tier in sync.
- **Invoice mirror + payment links (one-off):** Surface a shop's PSG invoices (read-only from Invoiced.com — invoices + status) inside the hub, with Stripe payment links to pay. The hub does NOT create/void invoices; Invoiced.com stays the authoring system and the two coexist.
- **Billing foundation + Stripe spine:** An idempotent Stripe webhook handler that fixes the carried **S3 INSERT→UPSERT** defect (duplicate-row hardening); the billing data model (subscriptions, invoices, payment records); a **PII-at-rest retention/redaction** mechanism for billing PII; the BSM Stripe wiring refreshed into the psg-hub resilience pattern (`src/lib/resilience.ts`).
- **Launch readiness (v1.0 gate):** **M3** reproducible deploy (git auto-deploy / prebuilt build, retiring CLI-only `vercel --prod`); **S6** Gotham/Typekit license clearance (procurement/legal, not a build task); **S2** pilot onboarding playbook; a billing-surface AEGIS + PII review.

**Problem it solves:** PSG cannot launch a paid product while customers have no way, inside the hub, to see what they owe or to pay it. v0.4 closes that and the launch-readiness gaps in one milestone.

## Scope

**Suggested name:** v0.4 Invoicing + Payments
**Estimated phases:** 4 (Phases 15-18 — global numbering continues from Phase 14)
**Focus:** Let a shop see and pay everything it owes PSG (one-off invoices + recurring subscription), then clear the gates to launch v1.0.

## Phase Mapping

| Phase | Focus | Features | Research |
|-------|-------|----------|----------|
| 15 — Billing foundation + Stripe spine | The base everything gates on | Idempotent Stripe webhook handler (fixes S3 INSERT→UPSERT); billing data model (subscriptions / invoices / payment records); PII-at-rest retention/redaction; refresh BSM Stripe wiring into the resilience pattern | **Likely** — Stripe webhook idempotency + event model; PII-at-rest approach (the Phase-10 app-key AES-256-GCM precedent vs pgsodium) |
| 16 — Subscription self-serve | Recurring-revenue path | Stripe Checkout + Customer Billing Portal; tier upgrade/downgrade wired to `src/lib/tier/gate.ts`; webhook→stored-tier sync; membership-gated | **Likely** — Stripe Checkout + Billing Portal session flow; mapping Stripe products/prices → the `essentials/growth/performance` enum |
| 17 — Invoice mirror + payment links | Shop pays PSG invoices | Invoiced.com READ-ONLY ingest (invoices + status); Stripe payment links; customer-facing invoice list + pay surface | **Likely** — Invoiced.com read API surface + auth; Stripe Payment Links vs hosted invoice |
| 18 — Launch readiness (v1.0) | Close the launch gate | M3 reproducible deploy; S6 Gotham/Typekit license (procurement/legal gate, not a build); S2 pilot onboarding playbook; billing-surface AEGIS + PII review | Maybe — M3 git-auto-deploy mechanics on the current Vercel project |

Dependencies: 16 and 17 both depend on 15 and are independent of each other (parallel-eligible). 18 depends on all of 15-17.

## Constraints

**Fixed (not in question — carry into planning):**
- **Stripe** is the processor: PSG is Merchant of Record, single account, shipped in BSM. v0.4 adds the customer-facing layer + invoice mirror on top.
- Tier enum `essentials` / `growth` / `performance` — **no migration** (BSM Stripe enum honored).
- **EXTEND-not-build** ethos held milestone-wide (the Phase 9-14 norm): reuse `src/lib/resilience.ts`, `src/lib/tier/gate.ts`, the membership/RLS spine, the build-local → operator-gated activation pattern.
- **Build-local → operator-gated activation** (proven Phases 9-14): capability builds locally; prod activation is a per-phase operator gate batch.

**Ordering invariant (money-before-M3):** Billing capability BUILDS in Phases 15-17, but **live charge acceptance activates only at the Phase-18 launch gate, after M3**. No real customer money moves before reproducible deploy is in place. The roadmap ties M3 explicitly to "before v0.4 first-dollar." Phases 16/17 ship build-local; the planner must sequence live payment activation into 18.

**Carried-in defects/debt now in scope:** S3 Stripe INSERT→UPSERT (Phase 15); PII-at-rest retention/redaction (Phase 15 mechanism, Phase 18 audit).

## Assumptions (verify at plan time — research-gated)

These were inferred from doc prose, not confirmed. If wrong, phase shape changes:
- **(a) Invoiced.com is the system of record for PSG→shop invoices AND exposes a read API sufficient for a mirror.** If false, Phase 17's shape changes (different source, or Stripe-native invoicing instead).
- **(b) What BSM actually left wired in Stripe** (account, products/prices, webhook secret, any existing tables) vs what Phase 15 must build from scratch. Confirm before planning 15.

## Additional Context

- Pilot cohort for activation: Wallace (already onboarded + Google-linked), Tedesco, Tracy's. Same build-local → Wallace-pilot → fleet pattern as Phases 9-14.
- Standing security debt that should be cleared at this launch milestone: rotate the chat-exposed secrets tracked in `.paul/DEFERRED.md` (GBP client secret + the 12-04 Hetzner/AI-Gateway/SendGrid + PAGESPEED/GTMETRIX); the rotated `CRON_SECRET` (now in `~/.psg-cron-secret`).
- Deploy gotcha persists: `vercel --prod` from repo toplevel (root `.vercel` rootDirectory=`apps/psg-hub/`); prod-on-main auto-deploy currently OFF (M3 changes this).

---

*This file is temporary. It will be deleted after /paul:milestone creates the milestone.*
