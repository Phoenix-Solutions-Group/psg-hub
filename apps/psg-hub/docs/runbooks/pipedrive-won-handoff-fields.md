# Pipedrive Won Handoff Fields

Source: PSG-1337, "SOP: Deal-Won Readiness and Provisioning Handoff"; PSG-1554 duplicate-field correction.

Purpose: before a sales deal can be marked Won, Sales, Finance, and Production need the same handoff packet. The PSG Sales Won gate blocks an incomplete sales-to-delivery handoff in Pipedrive's web UI.

## Existing Field Coverage

These core sales fields already existed before the won-handoff work:

| SOP requirement | Existing Pipedrive field |
| --- | --- |
| Client organization | Organization |
| Primary person/contact | Contact person |
| Deal value / final price | Value |
| Service line | Service Line |
| Revenue type | Revenue Type |
| Proposal or sales document link | Proposal Link |

## Canonical Fields Required At Won

These are the only fields required when a deal in the PSG Sales pipeline is marked Won. The API verification source is `GET /api/v2/dealFields?include_fields=ui_visibility,required_fields`; the expected rule is `required_fields.statuses: { "8": ["won"] }`.

| Field ID | SOP requirement | Pipedrive field | Type / options |
| --- | --- | --- | --- |
| 12533 | Signed contract, PandaDoc completion, or written approval | Signed Contract / Approval Link | Text link |
| 12534 | Contract start date | Contract Start Date | Date |
| 12540 | Payer model | Billing Model | Not applicable / single location; Parent-paid; Location-paid; Split billing |
| 12541 | Consolidated invoicing need | Consolidated Invoicing Required | No; Yes; N/A |
| 12545 | Legal customer name | Legal Customer Name | Short text |
| 12567 | Billing contact | Billing Contact | Linked person |
| 12543 | Billing email | Billing Email | Short text |
| 12548 | One-time setup fees | One-Time Setup Fees | Money |
| 12549 | Monthly recurring fees | Monthly Recurring Fees | Money |
| 12551 | First invoice date | First Invoice Date | Date |
| 12572 | Payment terms | Payment Terms (deal) | Due on Receipt; NET 7; NET 14; NET 15 (standard); NET 30; Payment Plan - see Special Terms |
| 12554 | Delivery template selected | Delivery Template | Standard Onboarding (fallback); Web - New Website Build; Custom - approved |
| 12555 | Needed, received, and missing access | Missing Access List | Long text |
| 12556 | Required client assets | Asset Request List | Long text |

## Optional Fields

These fields remain available but must not block the Won gate:

| Field ID | Pipedrive field |
| --- | --- |
| 12536 | Custom Promises / Exclusions / Deadlines |
| 12570 | Discount Type |
| 12571 | Discount Value |

## Delivery Handoff Fields

These five fields are the Gate 2 handoff packet for work after the sale:

| Field ID | Pipedrive field |
| --- | --- |
| 12553 | Invoiced Customer / Billing Link |
| 12557 | Google Shared Drive Folder Link |
| 12558 | Delivery Owner |
| 12559 | Backup Delivery Owner |
| 12560 | Pipedrive Delivery Project Link |

The final readiness flag is field 12563, `Handoff Complete`.

Current API limitation: Pipedrive's deal-field `required_fields` API supports stage-based and won/lost-status requirements, but it does not expose a field-to-field rule such as "require these five fields before Handoff Complete can be changed to Yes." Do not put these five fields on Delivery pipeline 9 / stage 63 as a substitute; that pipeline has no active deal flow. Tess must verify any Handoff Complete behavior in the browser.

## Retired Duplicate Fields

PSG-1554 retired these duplicates with Pipedrive's field-delete endpoint. Pipedrive removes retired fields from the normal `GET /api/v1/dealFields` response.

| Retired ID | Replaced by |
| --- | --- |
| 12542 Billing Contact Name | 12567 Billing Contact |
| 12550 Discounts / Credits | 12570 Discount Type and 12571 Discount Value |
| 12552 Payment Terms | 12572 Payment Terms (deal) |
| 12564 Signed Contract Link | 12533 Signed Contract / Approval Link |
| 12565 Special Terms / Exclusions | 12536 Custom Promises / Exclusions / Deadlines |
| 12566 Payer Model | 12540 Billing Model |
| 12568 One-Time Setup Fee | 12548 One-Time Setup Fees |
| 12569 Monthly Recurring Fee | 12549 Monthly Recurring Fees |
| 12573 Delivery Template Selected | 12554 Delivery Template |
| 12574 Invoiced Customer / Subscription Link | 12553 Invoiced Customer / Billing Link |
| 12575 Delivery Project Link | 12560 Pipedrive Delivery Project Link |

## Apply Path

1. Run the PSG-1554 fix script in dry-run mode first:
   `node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-gate-fix.mjs`
2. Confirm `errors: []` and `verification.openDealNonBlankTargetValues: []`.
3. Confirm `remainingActions` is empty after apply, or exactly matches the intended metadata-only changes before apply.
4. Apply only when the dry-run is clean:
   `node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-gate-fix.mjs --apply`
5. Re-run dry-run and confirm `plannedActions: 0`.

## Tess QA Checklist

Before any future live Pipedrive change is applied:

1. Run the focused Vitest file for the cleanup plan and confirm it passes.
2. Review the dry-run JSON and confirm no customer data or API token prints.
3. Confirm the 14 canonical Won fields are required through `GET /api/v2/dealFields?include_fields=ui_visibility,required_fields`.
4. Confirm the 11 retired field IDs do not appear as active fields.
5. Confirm the 7 open deals still have no values in the affected fields.
6. Browser-test the Pipedrive UI: an incomplete deal should be blocked when marked Won. If it is not blocked, PSG's Pipedrive plan likely does not include Required Fields and Nick must decide whether to upgrade or accept manual enforcement.
7. Browser-test the Handoff Complete flow separately; the API cannot prove field-to-field gating.

## Known Limit

Pipedrive required fields apply to web UI interactions. They do not reliably protect deals changed through API scripts, imports, bulk edits, or automations. PSG Hub code that writes `status: "won"` must either validate this packet before the write or treat the gap as an explicit operational limit.
