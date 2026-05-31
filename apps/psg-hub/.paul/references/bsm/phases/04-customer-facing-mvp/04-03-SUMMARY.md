---
phase: 04-customer-facing-mvp
plan: 03
subsystem: billing-onboarding
tags: [stripe, checkout, webhook, onboarding-wizard, subscription]
requires:
  - phase: 04-customer-facing-mvp
    provides: Auth, schema, dashboard views (plans 04-01, 04-02)
provides:
  - Stripe billing with Essentials ($199/mo) and Growth ($499/mo) tiers
  - Stripe Checkout, Customer Portal, and webhook handling
  - 3-step onboarding wizard (shop name, address, website/phone)
  - Billing migration (subscriptions table)
affects: []

key-files:
  created:
    - dashboard/src/lib/stripe.ts
    - dashboard/src/app/(dashboard)/billing/page.tsx
    - dashboard/src/app/(dashboard)/onboarding/page.tsx
    - dashboard/src/components/dashboard/pricing-card.tsx
    - dashboard/src/components/dashboard/onboarding-wizard.tsx
    - dashboard/src/app/api/billing/checkout/route.ts
    - dashboard/src/app/api/billing/portal/route.ts
    - dashboard/src/app/api/webhooks/stripe/route.ts
    - supabase/migrations/002_billing.sql

key-decisions:
  - "Lazy Stripe initialization via getStripe() to avoid build-time env var errors"
  - "Stripe API version 2026-03-25.dahlia (matches installed SDK)"
  - "Webhook uses Supabase service role key (no user session context)"

duration: 15min
completed: 2026-04-13T00:00:00Z
---

# Phase 4 Plan 03: Stripe Billing + Onboarding Wizard

**Stripe subscription billing with two tiers and a 3-step onboarding wizard for new shop owners.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Stripe billing integration | Pass | Pricing page with 2 tiers, Checkout + Portal API routes |
| AC-2: Onboarding wizard | Pass | 3-step form creates shop + membership, redirects to dashboard |
| AC-3: Webhook and billing schema | Pass | Handles 3 event types, subscriptions table with RLS |

## Deviations

- Stripe API version updated from basil to dahlia (installed SDK requires it)
- Stripe client lazy-initialized to avoid build-time env var errors
- Subscription.current_period_end typed as `any` due to Stripe SDK type changes in dahlia

---
*Completed: 2026-04-12*
