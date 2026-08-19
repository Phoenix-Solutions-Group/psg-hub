# PSG-2069 Deal Billing Auto-Fill Proof

## Before

Sample webhook deal linked to organization `9`:

| Deal field | Before value |
| --- | --- |
| Legal Customer Name | blank |
| Billing Address | blank |
| Billing Email | blank |
| Payment Terms (deal) | blank |
| Billing Contact Name | blank |

Linked organization values used by the test:

| Organization field | Value |
| --- | --- |
| Display Name | Wallace Collision LLC |
| Address | 123 Main St, Phoenix, AZ 85001 |
| General Email | billing@wallace.example |
| Payment Terms | Net 15 |
| Linked person name | Pat Owner |

## After

The webhook writes only the blank deal fields:

| Deal field | After value |
| --- | --- |
| Legal Customer Name | Wallace Collision LLC |
| Billing Address | 123 Main St, Phoenix, AZ 85001 |
| Billing Email | billing@wallace.example |
| Payment Terms (deal) | NET 15 (standard) |
| Billing Contact Name | Pat Owner |

Existing values are skipped. Payment terms are skipped when the organization text does not map cleanly to a known deal option.

## Group B Organization-Field Proposal

No live Pipedrive fields were created in this ticket. Under the PSG-1538 safe-write contract, these customer-level defaults should be proposed, dry-run reviewed, and approved before any live field creation:

| Proposed organization field | Type | Deal field it would later fill |
| --- | --- | --- |
| Billing Model | single choice | Billing Model |
| Consolidated Invoicing Required | single choice | Consolidated Invoicing Required |
| Purchase Order Requirement | text | Purchase Order Requirement |
| Tax Exempt Status | single choice | Tax Exempt Status |
| Default Delivery Template | single choice | Delivery Template |

Dry-run rule: every proposed field must be reported with field name, type, options, reason, and whether it requires Nick approval before any live Pipedrive change.

