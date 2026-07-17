# PSG-1717 QA Notes

## What Changed

BSM content approvals now have a shared visibility model for approval-related records:

- `shop` means the record is visible to the customer group for that content item's shop.
- `psg_internal` means PSG/admin-only and hidden from shop/account users.

The database migration adds row-level access rules for these approval record types:

- Files
- Comments
- Decisions
- Version history
- Restore requests
- Approved archive records

## Customer Isolation Checks

Tess should verify:

1. A user assigned to Shop A can see `shop` visibility comments and approval records for Shop A.
2. The same Shop A user cannot see Shop B approval records.
3. The Shop A user cannot see any `psg_internal` comments or approval records, even when those records belong to Shop A.
4. A PSG internal or superadmin user can see both `shop` and `psg_internal` records.
5. The customer-facing visibility choices read as:
   - Visible to customer
   - Private PSG note

## Focused Automated Coverage Added

`src/lib/bsm/__tests__/content-approval-visibility.test.ts` checks the two labels and confirms the migration applies the shared read rule to all six approval record tables.
