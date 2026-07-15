# Pipedrive Won Handoff Fields

Source: PSG-1337, "SOP: Deal-Won Readiness and Provisioning Handoff".

Purpose: before a sales deal can be marked Won, Sales, Finance, and Production need the same handoff packet. The cleanup script plans these Pipedrive deal fields so the Won gate can block missing handoff details once the live Pipedrive execution path is approved.

## Existing Field Coverage

These fields already existed in the PSG-1468 cleanup plan and remain unchanged:

| SOP requirement | Existing Pipedrive field |
| --- | --- |
| Client organization | Organization |
| Primary person/contact | Contact person |
| Deal value / final price | Value |
| Service line | Service Line |
| Revenue type | Revenue Type |
| Proposal or sales document link | Proposal Link |

## Fields To Create Or Require At Won

The script creates a missing field with the listed type, or requires the matching existing field when marking a deal Won in the PSG sales pipeline.

| SOP requirement | Pipedrive field | Type / options |
| --- | --- | --- |
| Signed contract, PandaDoc completion, or written approval | Signed Contract / Approval Link | Text link |
| Contract start date | Contract Start Date | Date |
| Expected delivery start date | Expected Delivery Start Date | Date |
| Custom promises, exclusions, or special deadlines | Custom Promises / Exclusions / Deadlines | Long text |
| Sold products, services, SKU/code, quantity, tier, frequency | Sold Products / SKU Notes | Long text |
| Multi-shop parent company | MSO Parent Company | Short text |
| Shop/location list | Client Location List | Long text |
| Payer model | Billing Model | Not applicable / single location; Parent-paid; Location-paid; Split billing |
| Consolidated invoicing need | Consolidated Invoicing Required | No; Yes; Not applicable |
| Billing contact name | Billing Contact Name | Short text |
| Billing email | Billing Email | Short text |
| Billing address | Billing Address | Address |
| Legal customer name | Legal Customer Name | Short text |
| Purchase-order requirement | Purchase Order Requirement | Long text |
| Tax-exempt status | Tax Exempt Status | No; Yes; Unknown / needs Finance |
| One-time setup fees | One-Time Setup Fees | Money |
| Monthly recurring fees | Monthly Recurring Fees | Money |
| Discounts, credits, waived fees, expiration dates | Discounts / Credits | Long text |
| First invoice date | First Invoice Date | Date |
| Payment terms | Payment Terms | Due on receipt; Net 15; Net 30; Custom - see notes |
| Invoiced setup evidence | Invoiced Customer / Billing Link | Text link |
| Delivery template selected | Delivery Template | New-client onboarding; New Website Build; Custom Delivery Project; Needs Production decision |
| Needed, received, and missing access | Missing Access List | Long text |
| Required client assets | Asset Request List | Long text |
| Client file home | Google Shared Drive Folder Link | Text link |
| Accountable delivery owner | Delivery Owner | Pipedrive user |
| Backup delivery owner | Backup Delivery Owner | Pipedrive user |
| Created delivery project | Pipedrive Delivery Project Link | Text link |
| Finance readiness confirmation | Finance Handoff Sign-Off | Not ready; Ready; Blocked - see notes |
| Production readiness confirmation | Production Handoff Sign-Off | Not ready; Ready; Blocked - see notes |
| Final readiness flag | Handoff Complete | No; Yes; Exception approved |

## Apply Path

1. Run the script in dry-run mode first:
   `node --env-file=.env.local apps/psg-hub/scripts/pipedrive-field-cleanup.mjs --json`
2. Confirm the planned `createDealField` operations match this document and do not duplicate live fields with slightly different names.
3. Confirm the planned `updateDealFieldRequired` operations keep the PSG sales pipeline only and require Won-stage handoff fields only when the deal is marked Won.
4. Do not run `--apply` until the live Pipedrive execution-path issue is approved.

## Tess QA Checklist

Before any live Pipedrive change is applied:

1. Run the focused Vitest file for the cleanup plan and confirm it passes.
2. Review the dry-run JSON and confirm no customer data or API token prints.
3. Confirm missing PSG-1337 fields are planned as `createDealField` operations with the types/options above.
4. Confirm already-existing PSG-1337 fields are planned as `updateDealFieldRequired`, not duplicated.
5. Confirm all Won handoff required-field operations use `statuses: { "8": ["won"] }`, so the gate applies only when marking a deal Won in the PSG sales pipeline.
6. Confirm the early PSG-1468 stage gates still exist for New Lead, Discovery, Qualified, Proposal Sent, Negotiation, and Lost.
