# 10-04 Research — MCC support + account selection at link time

**Date:** 2026-06-09 · **Status:** research complete, build not started · **Trigger:** 10-03 live link blocked — PSG's Google account is an MCC; the callback hard-errors on `listAccessibleCustomers` returning >1 customer ("single-customer link only in this release").

**Operator decision (Nick):** add MCC support; the user chooses which account is visible, at authentication. Build as a researched unit (not inline).

---

## Verified API finding (the design pivot)

`CustomerService.listAccessibleCustomers` returns ONLY the accounts **directly accessible to the OAuth credentials** — for a manager (MCC) login that is the **manager account itself (+ any directly-shared accounts), NOT the child hierarchy.** This is intended behavior, confirmed against Google's docs and the ads-api forum.

→ **A picker fed by `listAccessibleCustomers` is wrong for the MCC case.** To list the linkable client accounts under the MCC, query the **`customer_client`** resource against the manager:

```
GAQL (run with login-customer-id = <MCC>, customer_id = <MCC>):
SELECT customer_client.id,
       customer_client.descriptive_name,
       customer_client.manager,
       customer_client.level,
       customer_client.status
FROM customer_client
WHERE customer_client.status = 'ENABLED'
```
- Returns the full hierarchy reachable from the MCC. Filter `customer_client.manager = false` for selectable (non-manager) shop accounts.
- `customer_client.id` is the bare 10-digit id to store as `customer_id`. Store `login_customer_id = <MCC>` so subsequent metric calls resolve (RESEARCH.md:97 — null login_customer_id on an MCC account → USER_PERMISSION_DENIED).

Sources:
- https://developers.google.com/google-ads/api/docs/account-management/listing-accounts
- https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy

---

## Corrected design (single account per shop)

> One account per shop. Multiple accounts per shop collide on the `analytics_snapshots (shop_id, source, date, period)` key (10-02 ingest) — that is a separate, larger ingest change (sum across accounts before upsert). Out of scope for 10-04.

1. **Env:** `GOOGLE_ADS_LOGIN_CUSTOMER_ID = <PSG MCC id>` (bare 10-digit). Needed to run the `customer_client` query AND stored per linked account.
2. **Migration:** transient `pending_*` columns on `google_ads_oauth_states` (default-deny table, service-role only) to carry the link across two requests: `pending_encrypted_token text` (the `\x<hex>` bytea text), `pending_key_version int`, `pending_scope text`, `pending_login_customer_id text`, `pending_customers jsonb` (the enumerated `{id, name}` list to validate the pick).
3. **`callback`:** exchange code → tokens. Then:
   - Enumerate selectable accounts via the `customer_client` query under the MCC (NOT listAccessibleCustomers).
   - 0 → error. 1 → persist directly (current behavior, but customer_id from the query). >1 → encrypt token, stash `pending_*` on the state row (do NOT consume), render the account-picker page (radio list of `{id — name}`), form POSTs to `/api/ads/google/select` with the state token.
4. **New `POST /api/ads/google/select`:** re-bind session (user == state.userId), atomically consume the state, validate the chosen `customer_id ∈ pending_customers`, persist `google_ads_accounts {customer_id=chosen, login_customer_id=MCC, encrypted_refresh_token=pending, key_version, scope, status='linked', linked_by}`, log, return success HTML (postMessage `google-ads-linked` + close). The existing link button already detects completion by polling `/api/ads/google/accounts` + the postMessage.
5. **Tests:** oauth stash/consume (idempotent, validation); callback multi → picker + stash, no account row; select → valid pick persists, invalid pick 400, session mismatch 403, replay errors. Mock the `customer_client` fetch.
6. **Gates:** tsc · eslint · vitest · build · playwright. Then prod migration under PROTOCOL (advisor baseline→diff) + redeploy.

`client.ts:204` already passes `login_customer_id` as the operating header, so the metrics sync works for MCC children once the account row stores it.

---

## Still needed from operator
- **PSG MCC / manager customer id** (bare 10-digit) for `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. Confirm Wallace `604-861-1995` (→ `6048611995`) is a child of it.
- Dev-token tier ≥ Explorer + OAuth consent In Production (Stage 0) — operator reported done 2026-06-09; re-verify the `customer_client` query returns rows (Test-tier dev tokens can read only test accounts).

## Open / deferred
- Multiple accounts per shop (aggregate ingest) — deferred.
- Distinguishing/hiding manager rows in the picker — filter `manager=false`.
- If the OAuth user is on the MCC but the dev token can't traverse it, the `customer_client` query returns the manager only — verify at build/activation with the real MCC id.
