# Flower Hill Auto Body — Google Ads Audit
**Date:** 2026-05-18 | **Window:** LAST_30_DAYS | **Customer ID:** 5509988313 | **MCC:** 6935795509

---

## Account Activation Status

**UNKNOWN — audit blocked at the data layer.**

All campaign, ad group, keyword, asset, conversion-action, search-term, and change-event fetches against customer `5509988313` failed with `PERMISSION_DENIED` from the Google Ads API. The MCC link is verified ACTIVE and the account is ENABLED, but the MCP server cannot retrieve any operational data. No structural or performance checks could be executed.

This is a tooling problem, not an account problem. See **G-SYS1 Diagnostic** and **Action Required to Unblock** below.

---

## Health Score

**Not computed.** Producing a health score from zero data — or fabricating one from the campaign-builder source spec (`apps/ads/ops/flower-hill/google-ads/src/data.py`) — would misrepresent the audit. The source spec describes what was *intended* to be built; it does not confirm what was deployed, whether the campaigns were ever enabled, whether they have since been edited in the UI, or what conversion tracking / negatives / assets / geo settings currently exist on the live account.

| Category | Weight | Score |
|----------|--------|-------|
| Conversion Tracking | 25% | N/A (no data) |
| Wasted Spend | 20% | N/A (no data) |
| Account Structure | 15% | N/A (no data) |
| Keywords & QS | 15% | N/A (no data) |
| Ads & Assets | 15% | N/A (no data) |
| Settings & Targeting | 10% | N/A (no data) |
| **Total** | **100%** | **N/A — blocked** |

---

## Account Snapshot

| Field | Value | Source |
|-------|-------|--------|
| Customer ID | 5509988313 | MCC `customer_client` query |
| Descriptive name | Flower Hill Auto Body | MCC `customer_client` query |
| Status | ENABLED | MCC `customer_client` query |
| Currency | USD | MCC `customer_client` query |
| Time zone | America/New_York | MCC `customer_client` query |
| Test account | false | MCC `customer_client` query |
| Manager | false (operational account) | MCC `customer_client` query |
| MCC link status | ACTIVE | `customer_client_link` query |
| Manager link ID | 6578990321 | `customer_client_link` query |
| Spend / clicks / conv (30d) | **Unavailable** | Direct query blocked |
| Locations targeted (expected) | Huntington NY, Glen Cove NY, Roslyn NY | `data.py` spec (NOT verified live) |

---

## Quick Wins

Not produced. Quick Wins require concrete findings against live account state. None are available.

---

## Findings by Category

None. All 80 checks (G01-G61, G-CT1-3, G-CTV1, G-WS1, G-KW1-2, G-AD1-2, G-PM1-6, G-AI1, G-DG1-3) are marked **N/A — DATA UNAVAILABLE**. No category was even partially auditable; the underlying GAQL fetches all returned the same error.

---

## Wasted Spend Estimate

Not computable — search-term data inaccessible.

---

## Multi-Location Audit

Per the repo source spec (`ops/flower-hill/google-ads/src/data.py`), three locations are defined:

| Location | Address | Phone | Geo radius | Monthly search budget |
|----------|---------|-------|------------|----------------------|
| Huntington | 15 W Stepar Pl, Huntington Station, NY 11746 | 631-270-0033 | 12 mi | $1,000 |
| Glen Cove | 36 Morris Ave, Glen Cove, NY 11542 | 516-759-1737 | 12 mi | $700 |
| Roslyn | 12 Middle Neck Rd, Roslyn, NY 11576 | 516-627-3913 | 12 mi | ~$580 (sum of campaign budgets) |

Expected per-location campaign mix per the builder: General, EV, Exotic, Brand (4 campaigns × 3 locations = 12 campaigns total).

**Live verification of any of the above — campaign count, geo targeting accuracy, "People in" vs "People in or interested in", per-location asset coverage, location-extension health — is blocked and cannot be reported.**

---

## PMax Findings

Cannot be evaluated. The campaign-builder source contains no PMax definitions, so PMax may or may not exist on the live account. Unverifiable.

---

## AI Max / Demand Gen

G-AI1, G-DG1, G-DG2, G-DG3: cannot be evaluated. Requires live campaign and conversion data.

---

## G-SYS1 Diagnostic

### Data fetches attempted

| Query | Result |
|-------|--------|
| `list_accessible_customers` | OK — 16 customers returned; Flower Hill (5509988313) is **NOT** in the list |
| `customer_client` on 6935795509 with filter `id = 5509988313` | OK — confirms Flower Hill is ENABLED, USD, America/New_York, MCC link active |
| `customer_client_link` on 6935795509 with filter `client_customer = 'customers/5509988313'` | OK — link status ACTIVE, manager_link_id 6578990321, not hidden |
| `customer` on 5509988313 | **FAIL** — `User doesn't have permission to access customer. Note: If you're accessing a client customer, the manager's customer id must be set in the 'login-customer-id' header.` |
| `campaign` on 5509988313 (30d) | **FAIL** — same error |
| `campaign` on 5509988313 (no segments) | **FAIL** — same error |

### Root cause

The OAuth user authenticating the MCP server (`688156607585-...apps.googleusercontent.com`) does not have a direct user-level grant on Flower Hill (5509988313). The user does have direct access on Wallace (6048611995) and Tedesco (7763526490), which is why their audits succeeded — both appear in `list_accessible_customers`.

The MCP server is configured with `GOOGLE_ADS_MANAGER_ACCOUNT_ID=6935795509`, but for this specific call path it is **not** propagating the `login-customer-id: 6935795509` HTTP header onto the upstream Google Ads API request. The API therefore treats the call as a direct-access attempt by the OAuth user and rejects it.

The standalone `ops/flower-hill/google-ads/config/google-ads.yaml` config file in this repo uses the **same** OAuth client ID and the **same** `login_customer_id: 6935795509`, so the Python SDK path would face the same constraint unless the underlying user is granted direct access.

### Checks skipped (all 80)

Every check in the 80-check Google Ads audit was skipped because no live data could be fetched. Listing them individually would be noise; treat the entire audit as N/A pending unblock.

---

## Action Required to Unblock

Pick either path:

1. **Grant the OAuth user direct access to Flower Hill** (fastest).
   - In the Google Ads UI: log in as 5509988313 admin → Tools → Access and Security → Users → Add `nick@phoenixsolutionsgroup.net` (or whichever Google account the refresh token belongs to) with Admin or Standard access.
   - After the grant, re-run `list_accessible_customers`; 5509988313 should appear. Re-run this audit.

2. **Fix the MCP server to send `login-customer-id` for MCC-only children** (correct long-term fix).
   - When `GOOGLE_ADS_MANAGER_ACCOUNT_ID` is set and the requested `customer_id` is not in `list_accessible_customers`, the server must inject `login-customer-id: <manager_id>` into the gRPC metadata before calling `GoogleAdsService.Search`.
   - This is the path the official Google Ads Python client takes when `login_customer_id` is set in `google-ads.yaml`. Mirroring that behavior in the MCP fixes Flower Hill and any future MCC-only child accounts in one shot.

Path 1 unblocks Flower Hill today; path 2 prevents this from recurring on every new client onboarded to the PSG MCC without a per-user grant.

---

## Pre-Launch / Action Plan

**Before this audit can be delivered:** unblock data access per the section above.

**Once unblocked, re-run the full 80-check audit.** Expected initial focus areas based on the campaign-builder spec (these are hypotheses, not findings):

| Phase | Item |
|-------|------|
| Before enabling | Verify conversion tracking exists (the builder does not configure it). Verify Enhanced Conversions and Consent Mode v2. Verify all 12 campaigns (4 tiers × 3 locations) were created paused as intended. Verify geo targeting is set to "People in" (not "People in or interested in") given the 12-mile radius around three Long Island locations. Confirm Search Partners and Display Network settings on each campaign. |
| First 30 days post-enable | Daily search-term reviews on Phrase-match keywords (which dominate the spec). Negative-list coverage check against the 16-term starter list in `data.py`. RSA Ad Strength validation (specs include ~15 headlines / 4 descriptions per campaign — should grade Good/Excellent). Brand-vs-non-brand separation check (the spec already separates Brand campaigns, so this should pass cleanly). |
| Beyond | PMax evaluation (none in spec; collision repair with multi-location and conversion data is a reasonable PMax candidate). AI Max for Search evaluation once conversion volume passes 50/month. Demand Gen evaluation once tracking is mature. |

Do not enable the campaigns until conversion tracking is confirmed live and Enhanced Conversions + Consent Mode v2 are in place. Per repo CLAUDE.md the campaigns were intentionally created paused for this reason.

---

*End of report. Audit blocked; no health score issued; resubmit after unblock.*
