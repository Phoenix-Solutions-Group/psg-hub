# PAUL Handoff

**Date:** 2026-04-19
**Status:** Phase 5 complete — paused

---

## READ THIS FIRST

You have no prior context. This document tells you everything.

**Project:** BSM (Body Shop Marketer)
**Core value:** Collision repair shops get continuous, data-driven marketing optimization without hiring agencies or learning marketing themselves.

---

## Current State

**Milestone:** v0.1 Agent Engine MVP (v0.1.0) — 100% code-complete (transition ceremony pending)
**Phase:** 5 of 7 — Reputation and ads — COMPLETE (5/5 plans)
**Plan:** 05-05 closed

**Loop Position:**
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [all Phase 5 loops closed]
```

---

## What Was Done This Session

Shipped 4 Phase 5 plans end-to-end (PLAN → AUDIT → APPLY → UNIFY):

- **05-02** AI review response drafting. Haiku 4.5 + approval gate + audit trail via DB trigger + llm_call_log. 27 tests. Migration 004.
- **05-03** Google Ads API integration. OAuth 2.0 + AES-256-GCM refresh-token encryption + key-rotation map + 7 routes + rate-limit + 3 collision-repair campaign templates + sanitize helper + docs/secrets.md. 53 tests. Migration 005.
- **05-04** Performance tier billing + ads scaffold. Stripe checkout extended w/ env guard + post-upgrade grace banner + /ads page + sidebar + tier gate + multi-shop fallback + accounts table + link-account button (popup-safe + snapshot polling). 13 tests.
- **05-05** Campaigns UI. CampaignsSection + Table + CreateCampaignModal + CampaignDetailModal (role-gated) + MetricsSummary + SyncButton (aria-live). Shared focus-trap helper. Drift-detection test. 43 tests.

**Phase 5 totals:**
- 5 migrations (003 reviews, 004 review_responses, 005 google_ads + col adds + Performance tier enum value)
- 136 vitest tests pass (all pure-function + route integration, no jsdom)
- 30+ audit upgrades applied across plans (tier gate, budget cap, shop preflight, OAuth user-auth binding, revoke-at-Google, upsert-on-reconnect, key rotation, PII sanitization, popup-blocker detection, snapshot polling, post-upgrade grace, drift test, aria-live, soft-cap pagination, etc.)
- Build + lint green throughout (1 pre-existing middleware warning unrelated)
- 2 git commits landed (parent a158537 + dashboard 31f8814)

Encryption carve-out logged as decision: Ads OAuth refresh tokens encrypt at Phase 5 (materially higher risk than simple API keys); Yelp/Places keys remain deferred to Phase 6 per prior decision.

Original 05-04 scope split into 05-04 + 05-05 for cleaner loops. ROADMAP updated.

---

## What's In Progress

Nothing — Phase 5 is code-complete and committed.

---

## What's Next

**Immediate (ops/deploy blockers before runtime verify):**
- Create Stripe Performance price ($999/mo recurring), set STRIPE_PERFORMANCE_PRICE_ID
- Create BSM Supabase project, link via `supabase link`, push migrations 001-005
- Create Google Cloud OAuth client (type Web), set GOOGLE_OAUTH_CLIENT_ID/SECRET, redirect URI matching GOOGLE_ADS_OAUTH_REDIRECT_URI
- Google Ads API Center: apply for Standard developer token, set GOOGLE_ADS_DEVELOPER_TOKEN
- Provision MCC (manager account), set GOOGLE_ADS_LOGIN_CUSTOMER_ID
- Generate ADS_ENCRYPTION_KEY (32-byte base64) + ADS_STATE_SECRET, set in env
- Paste ANTHROPIC_API_KEY, YELP_API_KEY, GOOGLE_PLACES_API_KEY
- Vercel link dashboard; push env vars; deploy
- For first test shop: fill shops.address + shops.website_url (https) + shops.service_radius_miles; ensure active Performance subscription (OR add slug to SHOP_ADS_TIER_OVERRIDE for internal PSG shops)

**After runtime verify:** Phase transition ceremony — update PROJECT.md (Phase 5 requirements → shipped), milestone completion audit (/paul:audit-milestone), then plan Phase 6 (Email/SMS via SendGrid + Twilio + BigQuery analytics pipeline per ROADMAP).

---

## Key Files

| File | Purpose |
|------|---------|
| .paul/STATE.md | Live project state (Phase 5 marked complete-pending-transition) |
| .paul/ROADMAP.md | Phase overview (05-04 + 05-05 split reflected) |
| .paul/phases/05-reputation-ads/05-0{2,3,4,5}-SUMMARY.md | Per-plan shipped records |
| .paul/phases/05-reputation-ads/05-0{2,3,4,5}-AUDIT.md | Per-plan enterprise audit findings + verdicts |
| dashboard/.env.example | 15+ env vars required for Phase 5 runtime |
| docs/secrets.md | Rotation procedures (encryption keys, OAuth, Stripe) |
| supabase/migrations/004_review_responses.sql | Phase 5 reviews schema |
| supabase/migrations/005_google_ads.sql | Phase 5 ads schema (+ billing_tier 'performance' add) |

---

## Resume Instructions

1. Read .paul/STATE.md for latest position.
2. Most likely next action: runtime verify + deploy setup (see "What's Next" above) OR plan Phase 6.
3. Commands:
   - `/paul:resume` to pick up and suggest next step
   - `/paul:discuss-milestone` to begin Phase 6 scoping
   - `/paul:audit-milestone` to audit v0.1 completeness before shipping

**Commit state:** Parent HEAD a158537, dashboard HEAD 31f8814. Both repos clean of tracked changes for Phase 5 work.

---

*Handoff created: 2026-04-19*
