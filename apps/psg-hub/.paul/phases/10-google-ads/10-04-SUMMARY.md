---
phase: 10-google-ads
plan: 04
subsystem: auth
tags: [google-ads, oauth, mcc, customer_client, account-picker]
requires:
  - phase: 10-01
    provides: google_ads_accounts + oauth_states tables, crypto, callback
provides:
  - MCC account-selection at OAuth link (callback enumeration + picker + /select)
  - listManagedAccounts (customer_client enumeration under the manager)
affects: [11-ga4-gsc]
tech-stack:
  added: []
  patterns: ["two-step OAuth link with encrypted-token carry on the state row", "customer_client enumeration for MCC children"]
key-files:
  created:
    - src/lib/google-ads/customers.ts
    - src/lib/google-ads/link.ts
    - src/app/api/ads/google/select/route.ts
    - supabase/migrations/20260609000000_google_ads_oauth_pending.sql
  modified:
    - src/lib/google-ads/oauth.ts
    - src/app/api/ads/google/callback/route.ts
key-decisions:
  - "Enumerate via customer_client (NOT listAccessibleCustomers, which returns only the manager) — verified"
  - "Single account per shop (multi-per-shop collides on snapshot key) — deferred"
  - "Carry the AES-GCM-encrypted refresh token transiently on the default-deny oauth_states row"
patterns-established:
  - "peekState (verify, no consume) + stash/consumePendingSelection for two-step OAuth"
duration: ~2h
started: 2026-06-09
completed: 2026-06-09
---

# Phase 10 Plan 04: MCC Account-Selection Summary

**Added manager-account (MCC) support to the Google Ads link: the callback enumerates the MCC's client accounts via a `customer_client` query and, when several are reachable, renders an account picker; a new `/api/ads/google/select` route persists the chosen account. Proven live — Wallace linked, real paid numbers flowing.**

## Why (scope addition from 10-03 Stage B)

The 10-01/10-02 callback hard-errored on `listAccessibleCustomers` returning >1 customer. PSG's Google account is an MCC, so it always sees many → no real PSG client could ever link. Operator directed: "add MCC support; let the user choose which account, at authentication."

## Research finding (research-first gate)

`listAccessibleCustomers` returns only the accounts directly accessible to the OAuth user — for an MCC login, the **manager**, not the children. Children are enumerated via a `customer_client` GAQL query under `login-customer-id=<MCC>`. Verified against Google Ads API docs before building (`10-04-MCC-RESEARCH.md`). The original picker-from-listAccessibleCustomers design would have failed.

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Enumerate MCC children, exclude manager rows | Pass | `listManagedAccounts` filters `manager=false`, bare-10-digit, de-duped |
| Picker on >1, auto-link on exactly 1 | Pass | callback branches; unit-tested |
| `/select` persists only an offered account, session-bound | Pass | re-binds user==state.userId, validates pick ∈ offered set, atomic state consume |
| Encrypted token carried securely across two requests | Pass | AES-GCM ciphertext stashed as `\x<hex>` on default-deny state row, cleared on consume |
| Live: Wallace links + real numbers | Pass | customer_id 6048611995, login_customer_id 6935795509; cron synced:7; real paid metrics |

## Verification Results

- tsc clean · eslint 0 err · vitest **372/372** (+22: customers, oauth-pending, select route, callback branching) · build ✓ (both routes compiled).
- Migration `20260609000000_google_ads_oauth_pending` applied to prod under PROTOCOL — advisor diff **zero change** (5 nullable columns on an existing default-deny table).
- utf-8 charset fix on the picker/result HTML (curly-apostrophe names rendered as mojibake without it).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `supabase/migrations/20260609000000_google_ads_oauth_pending.sql` | Created | transient `pending_*` columns on `google_ads_oauth_states` |
| `src/lib/google-ads/customers.ts` | Created | `listManagedAccounts` via `customer_client` |
| `src/lib/google-ads/link.ts` | Created | shared `persistLinkedAccount` |
| `src/app/api/ads/google/select/route.ts` | Created | picker POST target; persists the chosen account |
| `src/lib/google-ads/oauth.ts` | Modified | `peekState` + `stash`/`consumePendingSelection` |
| `src/app/api/ads/google/callback/route.ts` | Modified | peek→exchange→enumerate→auto-link 1 / picker >1; utf-8 |
| `src/.../__tests__/*` (×4) | Created | +22 tests |

## Task Commits

| Task | Commit | Type |
|------|--------|------|
| MCC account-selection | `b23b9de` | feat |
| utf-8 charset fix | `df4bf21` | fix |

## Next Phase Readiness

**Ready:** The OAuth two-step + MCC pattern generalizes to every PSG client and to Phase 11 (GA4/GSC) per-account auth.
**Concerns:** Single account per shop. Picker lists all MCC clients (no search/pagination yet) — fine at current client count.
**Blockers:** None.

---
*Phase: 10-google-ads, Plan: 04 (scope addition under Phase 10)*
*Completed: 2026-06-09*
